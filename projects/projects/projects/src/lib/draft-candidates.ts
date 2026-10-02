/**
 * 坐席代笔（draft-candidates）
 *
 * 定位：转人工之后，为人工坐席起草 3 条**差异化**候选话术，供坐席点选。
 * 「只填不发」红线：本模块只**起草**，不提供任何发送能力；发出与否由坐席决定。
 *
 * 设计：
 * - 优先用 LLM（skills/draft-candidates/SKILL.md 的正文作为 systemPrompt）
 * - LLM 失败、返回非法内容或 classroom-fixture 模式下，用**规则模板兜底**（按转人工原因分支），
 *   保证课堂无模型也能演示，且结果确定
 * - 落库前复用 memory.ts 的 redactPII：候选文本与输入文本都不带手机号/地址等敏感信息
 */
import { getSkill } from "./skills-registry";
import { callLLM, isFixtureMode } from "./llm";
import { containsRedaction, redactPII } from "./memory";
import type { DraftCandidate, RunRecord } from "./store";

export interface DraftResult {
  candidates: DraftCandidate[];
  /** 是否走了规则模板兜底（UI 必须如实标注，不冒充模型生成） */
  usedFallback: boolean;
  notes: string;
}

interface DraftContext {
  question: string;
  handoffReason: string;
  /** 风控 issues 文本，供候选标注风险 */
  riskIssues: string[];
  finalReply: string;
  /** 需求结构化输出里的场景线索（可缺省） */
  scenario?: string;
}

const MAX_CANDIDATES = 3;
const MAX_CONTENT = 200;

/** 从运行记录里提取起草所需的上下文 */
export function buildDraftContext(run: RunRecord): DraftContext {
  const needExtraction = (run.steps ?? []).find((s) => s.ref === "need-extraction")?.output as
    | Record<string, unknown>
    | undefined;
  const issues = (run.risk?.issues ?? run.riskResult?.issues ?? []).map((i) =>
    typeof i === "string" ? i : [i.type, i.detail].filter(Boolean).join("："),
  );
  return {
    question: run.question ?? run.userQuestion ?? "",
    handoffReason: run.handoffReason ?? "用户要求人工介入",
    riskIssues: issues,
    finalReply: run.finalReply ?? "",
    scenario: typeof needExtraction?.scenario === "string" ? needExtraction.scenario : undefined,
  };
}

/** 归一化模型返回：只接受长度合规、脱敏后仍可用的条目；含敏感信息的整条丢弃，id 统一重排保证唯一 */
export function normalizeCandidates(raw: unknown): DraftCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: DraftCandidate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const content = typeof o.content === "string" ? redactPII(o.content).trim() : "";
    if (content.length < 8 || content.length > MAX_CONTENT) continue;
    // 含脱敏标记说明这条候选触及了敏感信息（如手机号）：整条丢弃，不做"脱敏后照发"
    if (containsRedaction(content)) continue;
    const level = o.riskLevel === "high" || o.riskLevel === "medium" ? o.riskLevel : "low";
    out.push({
      id: `c${out.length + 1}`,
      style: typeof o.style === "string" && o.style ? o.style : "候选",
      content,
      riskNote: typeof o.riskNote === "string" ? redactPII(o.riskNote).trim() : "发送前请人工确认",
      riskLevel: level,
    });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/** 按转人工原因分支，判断场景类型（用于模板兜底与话术侧重） */
function pickScene(ctx: DraftContext): "complaint" | "refund" | "logistics" | "allergy" | "other" {
  const text = `${ctx.handoffReason} ${ctx.question} ${ctx.riskIssues.join(" ")}`;
  if (/过敏|孕妇|小孩|食品安全|不适|吃坏/.test(text)) return "allergy";
  if (/投诉|曝光|差评|315|举报|态度/.test(text)) return "complaint";
  if (/退款|退货|换货|补发|赔付|赔偿/.test(text)) return "refund";
  if (/物流|快递|发货|到货|运单/.test(text)) return "logistics";
  return "other";
}

const SCENE_LABEL: Record<ReturnType<typeof pickScene>, string> = {
  complaint: "投诉安抚",
  refund: "退款退货",
  logistics: "物流异常",
  allergy: "过敏/食品安全",
  other: "其他",
};

/**
 * 规则模板兜底：三条差异化候选（稳妥说明 / 共情安抚 / 简短推进）。
 * fixture 模式与模型失败时使用——确定性输出，课堂可复现。
 */
export function templateCandidates(ctx: DraftContext): DraftCandidate[] {
  const scene = pickScene(ctx);
  const label = SCENE_LABEL[scene];
  const issue = ctx.riskIssues[0] ?? "";
  const issueLine = issue ? `（本次系统判定：${issue}）` : "";

  const byScene: Record<ReturnType<typeof pickScene>, [string, string, string]> = {
    complaint: [
      `非常抱歉给您带来了不好的体验，您说的情况我们已经记录${issueLine}。这条我先反馈给门店负责人核实，稍后由专员跟您对接处理，不会让您一直等。`,
      `先跟您说声抱歉，换作是我遇到这种情况也会着急。您方便把具体情况再跟我说一下吗？我这边马上按投诉流程升级处理，全程有记录可以追溯。`,
      `收到，我按投诉升级处理，专员会在今天内联系您。`,
    ],
    refund: [
      `您的诉求我收到了${issueLine}。我先帮您核对订单状态，退款/退换的适用规则我会按实际政策跟您说明，不会含糊。`,
      `理解您的心情，钱的事儿确实要弄清楚才安心。我先核实一下订单，再一步步陪您走完流程，有卡点我随时跟您说。`,
      `我先核实订单，核实后立刻告诉您能不能退、怎么退。`,
    ],
    logistics: [
      `帮您看了，物流这块我来跟进${issueLine}。我先核实当前节点与预计送达时间，有异常我直接帮您催件，结果第一时间同步您。`,
      `等快递确实挺熬人的，我跟您一样着急。我先去核实件到哪了，有消息马上回您。`,
      `我这就去催件，核实完马上回您。`,
    ],
    allergy: [
      `食品安全这块我们非常重视${issueLine}。我先记录您反馈的情况并升级给质控，同时建议您暂停食用；后续由专员跟您对接核实。`,
      `谢谢您告诉我们这件事，身体最重要。您先别吃了，我马上把情况升级给质控同事，今天内跟您联系核实。`,
      `已升级质控处理，请先暂停食用，专员会今天内联系您。`,
    ],
    other: [
      `您的情况我记下了${issueLine}。我先帮您核实，核实清楚后再跟您说明下一步怎么处理，不耽误您时间。`,
      `明白您的意思，我这边马上帮您跟进。有结果第一时间回您，不让您反复催。`,
      `我这就帮您核实，稍后回复您。`,
    ],
  };

  const [稳妥, 共情, 简短] = byScene[scene];
  const entries: DraftCandidate[] = [
    { id: "c1", style: "稳妥说明", content: 稳妥, riskNote: "涉及处理时效与责任判定，发送前请确认口径", riskLevel: "medium" },
    { id: "c2", style: "共情安抚", content: 共情, riskNote: "仅安抚与承诺跟进，未承诺赔偿", riskLevel: "low" },
    { id: "c3", style: "简短推进", content: 简短, riskNote: "最短话术，未说明细节，适合快速响应", riskLevel: "low" },
  ];
  return entries.map((c) => ({ ...c, style: `${c.style}（${label}）` }));
}

/** 生成候选：优先 LLM，失败或 fixture 走模板兜底 */
export async function draftCandidates(run: RunRecord): Promise<DraftResult> {
  const ctx = buildDraftContext(run);
  const skill = getSkill("draft-candidates");

  if (isFixtureMode() || !skill) {
    return {
      candidates: templateCandidates(ctx),
      usedFallback: true,
      notes: isFixtureMode() ? "演示稳定模式：使用规则模板候选（未调用模型）" : "未找到 draft-candidates 技能，使用规则模板候选",
    };
  }

  try {
    const raw = await callLLM({
      model: skill.model,
      systemPrompt: skill.body,
      userPrompt: [
        `## 用户问题\n${redactPII(ctx.question)}`,
        `## 转人工原因\n${redactPII(ctx.handoffReason)}`,
        `## 系统已判定的问题（风控/流程）\n${ctx.riskIssues.length ? ctx.riskIssues.join("；") : "无"}`,
        `## 系统已给用户的接管话术（供你参考语气，不要照抄）\n${redactPII(ctx.finalReply).slice(0, 300)}`,
        ctx.scenario ? `## 场景线索\n${ctx.scenario}` : "",
        `\n请输出严格 JSON：{"candidates":[{"id":"c1","style":"...","content":"...","riskNote":"...","riskLevel":"low|medium|high"}],"notes":"..."}，共 3 条，策略必须不同。`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      temperature: skill.temperature,
      maxTokens: skill.maxTokens,
      jsonMode: true,
    });
    const parsed = extractJson(raw);
    const candidates = parsed ? normalizeCandidates((parsed as { candidates?: unknown }).candidates) : [];
    if (candidates.length === MAX_CANDIDATES) {
      return {
        candidates,
        usedFallback: false,
        notes: typeof (parsed as { notes?: unknown })?.notes === "string" ? String((parsed as { notes: string }).notes).slice(0, 120) : "",
      };
    }
    return { candidates: templateCandidates(ctx), usedFallback: true, notes: "模型返回的候选不完整，已用规则模板兜底" };
  } catch (e) {
    return {
      candidates: templateCandidates(ctx),
      usedFallback: true,
      notes: `模型调用失败（${(e as Error)?.message?.slice(0, 60) ?? "未知错误"}），已用规则模板兜底`,
    };
  }
}

function extractJson(raw: string): unknown | null {
  const t = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(t.slice(s, e + 1));
  } catch {
    return null;
  }
}
