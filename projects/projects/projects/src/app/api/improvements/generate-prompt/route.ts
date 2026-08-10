import { NextResponse } from "next/server";
import { listSkills, readSkillFile, type SkillManifest } from "@/lib/skills-registry";
import { readRuns } from "@/lib/store";
import { callLLM } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

interface PatchRequest {
  clusterName?: string; // 聚类名（如"禁词/过度承诺"）
  skillId?: string; // 手动指定 skill
  issue?: string; // 自定义问题描述
  sampleRunIds?: string[]; // 可选示例 runId 列表
}

interface PatchSegment {
  kind: "keep" | "replace" | "insert_after";
  anchor?: string; // 锚点行（模糊匹配原 Prompt 中相邻行的子串）
  oldText?: string; // 原片段（replace 时需要）
  newText: string; // 新片段
  reason: string; // 为什么要改
}

interface PatchPreview {
  skillId: string;
  skillName: string;
  clusterName: string;
  rationale: string; // 整体改进逻辑
  segments: PatchSegment[];
  originalBody: string;
  patchedBodyPreview: string; // 应用 segments 后的预览
  sampleRuns: Array<{ runId: string; question: string; reply?: string; issue?: string }>;
  createdAt: string;
}

// cluster -> 推荐要修改的 skillId
const CLUSTER_TO_SKILL: Record<string, string> = {
  "价格/优惠不一致": "risk-check",
  "禁词/过度承诺": "risk-check",
  "新人身份判断错误": "need-extraction",
  "Tool 调用失败": "recommendation-decision",
  "数据缺失降级": "recommendation-decision",
  "用户主观不满意": "response-generator",
};

const CLUSTER_TO_GOAL: Record<string, string> = {
  "价格/优惠不一致": "加强价格一致性校验：务必引用 calculate_price 的 finalPrice，禁止模型编造价格、满减、折扣金额；回复中出现的每一笔价格都必须来自 Tool 输出",
  "禁词/过度承诺": "加强禁词审核：最/第一/绝对/100%/包退/包赔/根治/特效/保证效果/一定满意 等极限词和过度承诺必须拦截；语气类问题放 warning，承诺类一律 blocker",
  "新人身份判断错误": "明确 isNewUser 识别规则：用户主动说'第一次来/新用户/没买过/新人'才判为新客；'再来买/回购/上次'一律老客；不确定时置为 false 并走澄清",
  "Tool 调用失败": "降低 Tool 参数构造错误：输出前确认必填字段（budget/category/flavor）格式，缺参走 clarification-question 而不是瞎猜",
  "数据缺失降级": "扩大覆盖并显式告知：当过滤后无商品时不要硬推，应提示用户放宽条件并给出具体可选品类/口味",
  "用户主观不满意": "语气更亲切、更像小店常客：避免客服腔/模板化句子；回答先接住用户情绪再给推荐；给推荐时说清楚为什么（口味/场景/价格）",
};

function fuzzyFindLine(body: string, anchor?: string): number {
  if (!anchor) return -1;
  const lines = body.split("\n");
  const tryKeys = anchor.split("|").map((s) => s.trim()).filter(Boolean);
  for (const k of tryKeys) {
    const idx = lines.findIndex((l) => l.includes(k));
    if (idx >= 0) return idx;
  }
  return -1;
}

function applyPatch(body: string, segments: PatchSegment[]): string {
  const lines = body.split("\n");
  // 从后向前插入/替换，避免索引偏移
  const ops = segments
    .map((seg, i) => {
      const idx = fuzzyFindLine(body, seg.anchor);
      return { seg, idx, order: i };
    })
    .sort((a, b) => b.idx - a.idx);

  for (const { seg, idx } of ops) {
    if (seg.kind === "replace" && seg.oldText && idx >= 0) {
      // 从 idx 往下找 oldText 所在块，替换为 newText
      const blockLines = seg.oldText.split("\n");
      let start = -1;
      for (let i = Math.max(0, idx - 5); i < lines.length; i++) {
        if (lines[i].includes(blockLines[0].trim())) {
          start = i;
          break;
        }
      }
      if (start >= 0) {
        const newLines = seg.newText.split("\n");
        lines.splice(start, blockLines.length, ...newLines);
      }
    } else if (seg.kind === "insert_after" && idx >= 0) {
      lines.splice(idx + 1, 0, ...seg.newText.split("\n"));
    }
    // keep 不处理
  }
  return lines.join("\n");
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as PatchRequest;
  const clusterName = body.clusterName || "";
  const skillId = body.skillId || CLUSTER_TO_SKILL[clusterName] || "response-generator";
  const skills = listSkills();
  const targetSkill: SkillManifest | undefined = skills.find((s) => s.id === skillId);
  if (!targetSkill) {
    return NextResponse.json({ error: `Skill ${skillId} 不存在` }, { status: 400 });
  }
  const originalBody = readSkillFile(skillId) || "";
  if (!originalBody) {
    return NextResponse.json({ error: `Skill ${skillId} 文件无法读取` }, { status: 500 });
  }

  // 取 3 条示例 run
  const { runs } = await readRuns();
  const matchesIssue = (r: any, predicate: (i: string) => boolean) =>
    Array.isArray(r.riskIssues) ? (r.riskIssues as string[]).some(predicate) :
    Array.isArray(r.riskResult?.issues) ? (r.riskResult!.issues as any[]).some((i) => predicate(typeof i === "string" ? i : i?.detail || i?.type || "")) :
    false;

  const sampleRunIds =
    body.sampleRunIds && body.sampleRunIds.length > 0
      ? body.sampleRunIds
      : runs
          .filter((r: any) => {
            if (clusterName === "价格/优惠不一致") return matchesIssue(r, (i) => i.includes("价格") || i.includes("优惠"));
            if (clusterName === "禁词/过度承诺") return matchesIssue(r, (i) => i.includes("禁词") || i.includes("承诺") || i.includes("极限词"));
            if (clusterName === "新人身份判断错误") return matchesIssue(r, (i) => i.includes("新客") || i.includes("新人"));
            if (clusterName === "Tool 调用失败") return (r.steps || []).some((s: any) => s.status === "error");
            if (clusterName === "数据缺失降级") return (r.steps || []).some((s: any) => s.status === "degraded");
            if (clusterName === "用户主观不满意") return r.isBadCase || ((r as any).ratings || []).some((x: any) => x.score <= 2);
            return r.isBadCase;
          })
          .slice(0, 3)
          .map((r: any) => r.runId);

  const sampleRuns = sampleRunIds
    .map((id: string) => runs.find((r: any) => r.runId === id))
    .filter(Boolean)
    .map((r: any) => ({
      runId: r.runId,
      question: r.question,
      reply: r.finalReply || r.finalAnswer || "",
      issue: Array.isArray(r.riskIssues)
        ? (r.riskIssues as string[]).slice(0, 2).join("；")
        : Array.isArray(r.riskResult?.issues)
        ? (r.riskResult.issues as any[])
            .slice(0, 2)
            .map((i) => (typeof i === "string" ? i : i?.detail || i?.type || ""))
            .join("；")
        : "",
    }));

  const goal = body.issue || CLUSTER_TO_GOAL[clusterName] || "提升回答质量与合规性";

  // 调 LLM 生成 segments
  const prompt = `你是一个客服 Skill Prompt 优化助手。当前要修改的 Skill 如下（YAML frontmatter 之后是 system prompt 正文）：

--- 当前 Skill（${targetSkill.name} / ${targetSkill.id}） ---
${originalBody}
--- end ---

改进目标（问题聚类：${clusterName || "自定义"}）：
${goal}

参考样例（出问题的运行）：
${sampleRuns
  .map(
    (s, i) =>
      `样例${i + 1} [${s.runId}]\n用户：${s.question}\n回复：${(s.reply || "").slice(0, 300)}\n命中问题：${s.issue || "无"}`,
  )
  .join("\n\n")}

请输出严格 JSON（不要加 \`\`\`json 包裹、不要输出解释文字），结构：
{
  "rationale": "整体改进逻辑（50 字以内）",
  "segments": [
    {
      "kind": "insert_after" | "replace" | "keep",
      "anchor": "用来在原文中定位的相邻行子串；多个候选用 | 分隔，优先匹配第一个",
      "oldText": "当 kind=replace 时，要被替换掉的原文本片段（必须是原文中连续的一段）",
      "newText": "新的文本片段（要插入或替换后的内容）",
      "reason": "本条修改的具体原因"
    }
  ]
}

约束：
- 只做与改进目标相关的最小改动，不要大段重写。
- 优先使用 insert_after（在某个章节后追加注意点），其次 replace（替换旧规则）。
- 不要修改 YAML frontmatter（--- 包裹部分）。
- anchor 必须能在原文正文中找到（挑选一个稳定、具有唯一性的短句）。
- 不要添加空的 keep 段。segments 总数 ≤ 4。`;

  let segments: PatchSegment[] = [];
  let rationale = "";
  try {
    const raw = await callLLM({
      userPrompt: prompt,
      model: targetSkill.model,
      temperature: 0.2,
    });
    const jsonText = (raw || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(jsonText);
    rationale = parsed.rationale || "";
    segments = Array.isArray(parsed.segments) ? parsed.segments : [];
    // 兜底：过滤非法 segment
    segments = segments.filter(
      (s) => s && s.newText && (s.kind === "keep" || s.kind === "replace" || s.kind === "insert_after"),
    );
  } catch (e) {
    return NextResponse.json(
      { error: "LLM 生成补丁失败，请重试", detail: String(e) },
      { status: 500 },
    );
  }

  const patchedBodyPreview = applyPatch(originalBody, segments);

  const preview: PatchPreview = {
    skillId,
    skillName: targetSkill.name,
    clusterName,
    rationale,
    segments,
    originalBody,
    patchedBodyPreview,
    sampleRuns,
    createdAt: new Date().toISOString(),
  };

  return NextResponse.json(preview);
}
