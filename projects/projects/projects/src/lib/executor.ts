import { listSkills } from "./skills-registry";
import { runTool, type ToolId, getToolCatalog } from "./tools";
import { detectHandoffSignals } from "./handoff-rules";
import { readPlannerConfig, type Plan, type PlanStep } from "./planner";
import { callLLM } from "./llm";
import type { StepRecord } from "./store";
void getToolCatalog;

export interface StepTrace {
  step: number;
  type: "skill" | "tool";
  ref: string;
  refName: string;
  description: string;
  status: "pending" | "running" | "success" | "error" | "skipped" | "degraded";
  input: Record<string, unknown>;
  output?: unknown;
  raw?: string;
  error?: string;
  thinking?: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  retryCount?: number;
  explanation?: string;
}

export interface ExecutorCallbacks {
  onStepStart?: (step: number, input: Record<string, unknown>, thinking?: string, meta?: { type?: string; ref?: string }) => void;
  onStepComplete?: (step: number, output: unknown, thinking?: string, meta?: { type?: string; ref?: string }) => void;
  onStepError?: (step: number, error: Error | string) => void;
  onStepDuration?: (step: number, durationMs: number) => void;
  onStepStream?: (step: number, delta: string) => void;
  onStepRecord?: (step: number, rec: StepRecord) => void;
}

export interface ExecutePlanInput {
  plan: Plan;
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
  /** 跨会话长期记忆上下文（注入 globals.memory，供 {{memory}} 占位符引用） */
  memoryContext?: string;
  availableSkills: string[];
  availableTools: string[];
}

/** 非关键 Tool 失败时的兜底空结果，避免整条链路因数据查询失败直接挂掉 */
function buildToolFallback(ref: string): unknown {
  switch (ref) {
    case "query_products":
      return { totalMatched: 0, products: [], _fallback: true };
    case "query_coupons":
      return { totalMatched: 0, coupons: [], autoPicked: null, _fallback: true };
    case "query_activities":
      return { totalMatched: 0, activities: [], _fallback: true };
    case "query_order":
      return { order: null, _fallback: true };
    case "query_return_policy":
      return { policies: [], _fallback: true };
    default:
      return { _fallback: true };
  }
}

export interface ExecutionResult {
  plan: Plan;
  steps: StepTrace[];
  finalReply: string;
  riskResult: { passed: boolean; issues: { type: string; detail: string; severity?: string }[]; riskLevel: string } | null;
  needsClarification?: boolean;
  clarificationQuestion?: string | null;
  handoffToHuman?: boolean;
  handoffMessage?: string | null;
  /** 转人工原因（来自 human-handoff-decision 的输出，供坐席工作台展示） */
  handoffReason?: string | null;
  error?: string;
}

// Resolve {{step_N}} / {{step_N.xxx}} / {{step_N.xxx.yyy}} / {{question}} / {{history}} placeholders.
// step_N 是 1-based，与 plan.step 编号一致。
function resolvePlaceholder(
  input: unknown,
  stepsOut: Record<number, unknown>,
  globals: Record<string, unknown>
): unknown {
  const getByPath = (root: unknown, path: string): unknown => {
    if (root == null) return "";
    if (!path) return root;
    const parts = path.split(".");
    let cur: any = root;
    for (const p of parts) {
      if (cur == null) return "";
      if (Array.isArray(cur) && /^\d+$/.test(p)) {
        cur = cur[Number(p)];
      } else if (typeof cur === "object" && p in cur) {
        cur = cur[p];
      } else {
        return "";
      }
    }
    return cur;
  };
  const lookupVar = (name: string, path: string): unknown => {
    // step_N(.path)?
    const m = name.match(/^step_(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      let root: unknown = stepsOut[n];
      if (root === undefined || root === null) root = stepsOut[n - 1];
      return getByPath(root, path);
    }
    // global: question / history
    if (name in globals) return getByPath(globals[name], path);
    return "";
  };
  const resolveString = (s: string): unknown => {
    // 完整字符串被单个占位符包围：保留原始类型
    const fullMatch = s.match(/^\{\{([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_.]+))?\}\}$/);
    if (fullMatch) return lookupVar(fullMatch[1], fullMatch[2] ?? "");
    // 片段替换
    return s.replace(/\{\{([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_.]+))?\}\}/g, (_m, name, path) => {
      const v = lookupVar(name, path ?? "");
      if (v == null || v === "") return "";
      return typeof v === "object" ? JSON.stringify(v) : String(v);
    });
  };
  if (typeof input === "string") return resolveString(input);
  if (Array.isArray(input)) return input.map((x) => resolvePlaceholder(x, stepsOut, globals));
  if (input && typeof input === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) out[k] = resolvePlaceholder(v, stepsOut, globals);
    return out;
  }
  return input;
}

function extractJson(raw: string): unknown {
  // Try direct parse
  try { return JSON.parse(raw); } catch { /* ignore */ }
  // Extract ```json ... ```
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch { /* ignore */ }
  }
  // Try to find the first { ... } block
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = raw.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(slice); } catch { /* ignore */ }
  }
  // Fallback: return raw as { reply }
  return { reply: raw.trim() };
}

async function executeSkillStep(
  skillId: string,
  input: Record<string, unknown>,
): Promise<{ output: unknown; raw: string }> {
  const allSkills = listSkills();
  const skill = allSkills.find((s) => s.id === skillId);
  if (!skill) throw new Error(`Skill 不存在: ${skillId}`);

  const prompt = buildSkillPrompt(skill.body, input);
  const isJsonSkill = skillId !== "response-generator";
  const raw = await callLLM({
    model: skill.model,
    temperature: skill.temperature,
    maxTokens: skill.maxTokens,
    systemPrompt: skill.body,
    userPrompt: prompt,
    jsonMode: isJsonSkill,
  });

  let output: unknown;
  // Response generator returns plain text, not JSON
  // response-generator 可能返回 {reply} 结构或纯字符串，统一规范化
  if (skillId === "response-generator") {
    const trimmed = raw.trim();
    const maybeJson = extractJson(trimmed);
    if (maybeJson && typeof maybeJson === "object" && "reply" in (maybeJson as any)) {
      output = { reply: String((maybeJson as any).reply ?? trimmed) };
    } else {
      output = { reply: trimmed };
    }
  } else {
    output = extractJson(raw);
  }

  return { output, raw };
}

function buildSkillPrompt(promptTemplate: string, input: Record<string, unknown>): string {
  const inputStr = Object.entries(input)
    .filter(([k]) => !k.startsWith("__"))
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`)
    .join("\n");
  return `以下是本轮输入：\n\n${inputStr}\n\n请严格按照 System Prompt 的输出格式返回结果。`;
}

// compat export
export const buildSkillUserPrompt = buildSkillPrompt;

function executeToolStep(toolId: string, input: Record<string, unknown>): unknown {
  return runTool(toolId as ToolId, input);
}

/**
 * 兜底：planner (LLM) 生成的 plan 有时会漏掉 response-generator 步骤，
 * 导致 executor 拿不到 finalReply。这里在执行前自动补上。
 *
 * 规则：
 * 1. 如果 plan 已经包含 response-generator → 原样返回
 * 2. 否则在 risk-check 之前插入一个 response-generator 步骤
 * 3. 找不到 risk-check 就追加到末尾
 * 4. input 给 LLM 喂足上下文：need-extraction、recommendation-decision、
 *    recommendation-reason、clarification-question 全部合并进 context
 *    （避免 LLM 因为信息不足而给出 "好的您请说" 这种敷衍回复）
 */
function ensureResponseGenerator(plan: PlanShape): PlanShape {
  const hasResponseGen = plan.steps.some((s) => s.ref === "response-generator");
  if (hasResponseGen) return plan;

  // 把所有能产生内容文本的步骤都列出来，喂给 response-generator
  const contentRefs = [
    "clarification-question",
    "recommendation-reason",
    "recommendation-decision",
    "need-extraction",
  ];
  const contentIdxs = plan.steps
    .map((s, i) => (contentRefs.includes(s.ref) ? i : -1))
    .filter((i) => i >= 0);

  // 构造一个聚合的 context 字段（LLM 看到的字段名清晰明确）
  const contextObj: Record<string, string> = {};
  for (const idx of contentIdxs) {
    const ref = plan.steps[idx].ref;
    // 占位符 step_{idx+1} 会在执行时被 resolvePlaceholder 解析
    contextObj[ref] = `{{step_${idx + 1}}}`;
  }

  const newStep: PlanStep = {
    step: (plan.steps[plan.steps.length - 1]?.step ?? 0) + 1,
    type: "skill" as const,
    ref: "response-generator",
    description:
      contentIdxs.length > 0
        ? `自动补全：基于 ${contentIdxs.length} 个内容步骤结果生成回复（planner 漏掉了该步骤）`
        : "自动补全：生成最终回复（planner 漏掉了该步骤）",
    input: {
      question: "{{question}}",
      user_needs: "{{step_1}}", // 约定第 1 步是 need-extraction
      context: JSON.stringify(contextObj),
    },
  };

  // 在 risk-check 之前插入；如果没有 risk-check 就追加到末尾
  const riskIdx = plan.steps.findIndex((s) => s.ref === "risk-check");
  const newSteps: PlanStep[] = [...plan.steps];
  if (riskIdx >= 0) {
    newSteps.splice(riskIdx, 0, newStep);
  } else {
    newSteps.push(newStep);
  }
  // 修正后续 step 编号
  newSteps.forEach((s, i) => (s.step = i + 1));

  return { ...plan, steps: newSteps };
}

type PlanShape = ExecutePlanInput["plan"];

export async function executePlan(
  opts: ExecutePlanInput & ExecutorCallbacks,
): Promise<ExecutionResult> {
  const { plan: rawPlan, question, history = [], memoryContext = "", availableSkills, availableTools } = opts;
  const plannerCfg = readPlannerConfig();

  // 兜底：planner (LLM) 有时漏掉 response-generator 步骤，补上以保证有 finalReply
  const plan = ensureResponseGenerator(rawPlan);

  const traces: StepTrace[] = plan.steps.map((s, idx) => ({
    step: idx + 1,
    type: s.type,
    ref: s.ref,
    refName: s.ref,
    description: s.description,
    status: "pending" as const,
    input: s.input ?? {},
    retryCount: 0,
  }));

  // Pre-flight checks
  const missing = (plannerCfg.mandatorySkills || []).filter((id: string) => !availableSkills.includes(id));
  if (missing.length > 0) {
    return {
      plan,
      steps: traces,
      finalReply: `当前已停用必选 Skill：${missing.join(", ")}。前台不能生成未经风控的最终回复，请联系运营启用。`,
      riskResult: { passed: false, issues: missing.map((m) => ({ type: "config", detail: `必选 Skill ${m} 未启用` })), riskLevel: "high" },
      error: "mandatory skill disabled",
    };
  }

  const stepsOut: Record<number, any> = {};
  const globals: Record<string, unknown> = { question, history, memory: memoryContext || "（暂无历史记忆）" };
  let finalReply = "";
  let riskResult: ExecutionResult["riskResult"] = null;
  let needsClarification = false;
  let clarificationQuestion: string | null = null;
  let handoffToHuman = false;
  let handoffMessage: string | null = null;
  let handoffReason: string | null = null;
  let execError = "";

  // 判定一段文本是否是 LLM 自己"瞎编的 meta 报错"（非真实客服回复）
  const isMetaErrorText = (s: unknown): boolean => {
    if (typeof s !== "string") return false;
    const t = s.trim();
    if (!t) return true;
    if (t.length < 6) return true;
    // 典型的模型异常文案模式（不是客服会说的话）
    const metaPatterns = [
      /模型响应异常/i,
      /请重试或更换模型/i,
      /模型(服务|接口|调用|返回).*异常/i,
      /系统(繁忙|错误|异常)/i,
      /(服务器|接口).*(异常|错误|繁忙|失败)/i,
      /^error[:：]/i,
      /^sorry[,，]/i,
      /api key.*(invalid|missing|error)/i,
      /调用(失败|出错|异常)/i,
    ];
    return metaPatterns.some((re) => re.test(t));
  };

  // 找 response-generator / risk-check 步骤的索引
  const responseStepIdx = traces.findIndex(
    (t) => t.type === "skill" && t.ref === "response-generator"
  );
  const riskStepIdx = traces.findIndex(
    (t) => t.type === "skill" && t.ref === "risk-check"
  );

  for (let i = 0; i < traces.length; i++) {
    const t = traces[i];
    const stepNum = i + 1; // 1-based for placeholder {{step_N}}
    t.status = "running";
    t.startedAt = Date.now();

    // Validate step ref is available
    const refAvailable = t.type === "skill"
      ? availableSkills.includes(t.ref)
      : availableTools.includes(t.ref);
    if (!refAvailable) {
      t.status = "skipped";
      t.error = `${t.type} ${t.ref} 未启用，跳过`;
      stepsOut[stepNum] = { skipped: true, reason: t.error };
      opts.onStepComplete?.(i, { skipped: true }, t.error);
      continue;
    }

    const resolvedInput = resolvePlaceholder({ ...t.input }, stepsOut, globals) as Record<string, unknown>;
    // 长期记忆自动注入：需求结构化与最终话术两个关键 skill 感知用户画像
    if (memoryContext && t.type === "skill" && (t.ref === "need-extraction" || t.ref === "response-generator")) {
      if (!("memory" in resolvedInput)) {
        resolvedInput.memory = memoryContext;
      }
    }
    t.input = resolvedInput;
    opts.onStepStart?.(i, resolvedInput, undefined, { type: t.type, ref: t.ref });

    const maxAttempts = 2;
    let success = false;
    while (t.retryCount! < maxAttempts && !success) {
      try {
        if (t.type === "skill") {
          const { output, raw } = await executeSkillStep(t.ref, resolvedInput);
          t.raw = raw;
          t.output = output;
          stepsOut[stepNum] = output;
          if (t.ref === "clarification-question" && (output as any).question) {
            needsClarification = true;
            clarificationQuestion = (output as any).question;
          }
          if (t.ref === "human-handoff-decision" && (output as any).needsHuman) {
            handoffToHuman = true;
            handoffMessage = (output as any).handoffMessage || "已为您转接人工客服，请稍候。";
            handoffReason = (output as any).reason || "AI 判定需要人工介入";
          }
          if (t.ref === "risk-check") {
            riskResult = {
              passed: !!(output as any).passed,
              issues: (output as any).issues ?? [],
              riskLevel: (output as any).riskLevel ?? "low",
            };
          }
          if (t.ref === "response-generator") {
            const reply = (output as any).reply || raw;
            // 校验：如果回复是 meta 异常文案，抛错触发重试
            if (isMetaErrorText(reply)) {
              throw new Error(`response-generator 返回异常文案: ${reply.slice(0, 80)}`);
            }
            finalReply = reply;
          }
        } else {
          const out = await executeToolStep(t.ref, resolvedInput);
          t.output = out;
          stepsOut[stepNum] = out;
        }
        t.status = "success";
        t.endedAt = Date.now();
        t.durationMs = t.endedAt - (t.startedAt ?? t.endedAt);
        opts.onStepComplete?.(i, t.output, undefined, { type: t.type, ref: t.ref });
        opts.onStepDuration?.(i, t.durationMs);
        opts.onStepRecord?.(i, t as unknown as StepRecord);
        success = true;
      } catch (err: any) {
        t.retryCount! += 1;
        t.error = err?.message ?? String(err);
        if (t.retryCount! >= maxAttempts) {
          t.status = "error";
          t.endedAt = Date.now();
          t.durationMs = t.endedAt - (t.startedAt ?? t.endedAt);
          opts.onStepError?.(i, err);
        }
      }
    }

    if (t.status === "error") {
      // Tool 失败降级：非关键 Tool 标记为 degraded 继续；关键 Tool（risk-check/response-generator/calculate_price）中断
      const critical =
        t.type === "skill" ||
        ["calculate_price"].includes(t.ref);
      if (critical) {
        execError = `步骤 ${stepNum} (${t.ref}) 失败: ${t.error}`;
        break;
      }
      // 非关键 Tool：写入空兜底结果继续执行
      const fallback = buildToolFallback(t.ref);
      t.output = fallback;
      stepsOut[stepNum] = fallback;
      t.status = "degraded";
      t.error = (t.error || "") + "（已降级为空结果继续执行）";
      opts.onStepComplete?.(i, fallback, undefined, { type: t.type, ref: t.ref });
      opts.onStepRecord?.(i, t as unknown as StepRecord);
    }
  }

  // 风控打回时，用 suggestedFix 重试 response-generator 一次
  if (
    riskResult &&
    !riskResult.passed &&
    responseStepIdx >= 0 &&
    riskStepIdx >= 0 &&
    riskStepIdx > responseStepIdx &&
    finalReply
  ) {
    const blockers = riskResult.issues
      .filter((i) => i.severity === "blocker" || i.severity === "high");
    if (blockers.length > 0) {
      const suggestedFix = blockers.map((b) => b.detail || b.type).join("；");
      const retryTrace: any = traces[responseStepIdx];
      const retryInput = {
        ...(retryTrace.input || {}),
        _riskRejectReason: suggestedFix,
        _previousReply: finalReply,
        _instruction:
          "上一版客服回复被风控打回，请基于以下风控反馈重写一版。要求：" +
          "1) 去掉虚构的优惠/新人券/折扣等内容，必须严格基于 products/activities/coupons 输入里的真实信息；" +
          "2) 如果有活动或折扣，只能引用 activities/coupons 里明确给出的内容；" +
          "3) 不要加没有依据的承诺；" +
          "4) 回复风格保持亲切自然。",
      };
      try {
        opts.onStepStart?.(
          responseStepIdx,
          { ...retryInput, _retry: true },
          undefined,
          { type: "skill", ref: "response-generator" }
        );
        const { output: retryOut, raw: retryRaw } = await executeSkillStep(
          "response-generator",
          retryInput
        );
        const retryReply = (retryOut as any)?.reply || retryRaw;
        if (
          !isMetaErrorText(retryReply) &&
          retryReply.trim().length >= 6
        ) {
          finalReply = retryReply;
          retryTrace.output = retryOut;
          retryTrace.raw = retryRaw;
          (retryTrace as any).retried = true;
          // 重新跑一次 risk-check
          const riskTrace: any = traces[riskStepIdx];
          const riskRetryInput = { response: finalReply };
          opts.onStepStart?.(
            riskStepIdx,
            riskRetryInput,
            undefined,
            { type: "skill", ref: "risk-check" }
          );
          const { output: riskRetryOut } = await executeSkillStep(
            "risk-check",
            riskRetryInput
          );
          riskTrace.output = riskRetryOut;
          riskResult = {
            passed: !!(riskRetryOut as any).passed,
            issues: (riskRetryOut as any).issues ?? [],
            riskLevel: (riskRetryOut as any).riskLevel ?? "low",
          };
          (riskTrace as any).retried = true;
        }
      } catch (err: any) {
        console.warn("[executor] risk-retry failed:", err?.message);
      }
    }
  }

  // 确定性转人工：命中关键词即标记「待人工」，不依赖模型自觉规划 human-handoff-decision。
  // 不改动计划、也不覆盖 AI 已生成的回复（只在没有对外回复时才用接管话术），
  // 因此不影响 Eval 口径；坐席工作台据此把会话列为待处理。
  if (!handoffToHuman) {
    const hits = detectHandoffSignals(question);
    if (hits.length > 0) {
      handoffToHuman = true;
      handoffReason = `命中转人工关键词：${hits.join("、")}`;
      handoffMessage = "已经帮您转接人工客服，稍后由专员跟进处理，请您稍等。";
    }
  }

  // Final reply fallback
  if (!finalReply) {
    if (needsClarification && clarificationQuestion) {
      finalReply = clarificationQuestion;
    } else if (handoffToHuman && handoffMessage) {
      finalReply = handoffMessage;
    } else if (execError) {
      finalReply = "抱歉，服务暂时出了点小问题，我们正在处理。";
    } else {
      // 兜底：只在 response-generator / clarification-question / human-handoff-decision
      // 这三个明确"产出对外话术"的 step 里取回复，**不**从任意 step 的 reply 字段瞎抓，
      // 避免把中间结果（如 LLM 误把 risk-check step 标成 response-generator）当成 finalReply。
      const finalRefSet = new Set([
        "response-generator",
        "clarification-question",
        "human-handoff-decision",
      ]);
      for (let i = traces.length - 1; i >= 0; i--) {
        const tr = traces[i];
        if (tr.type !== "skill") continue;
        if (!finalRefSet.has(tr.ref)) continue;
        const out = (tr as any).output;
        if (!out || typeof out !== "object") continue;
        const candidate =
          (typeof out.reply === "string" && out.reply) ||
          (typeof out.question === "string" && out.question) ||
          (typeof out.handoffMessage === "string" && out.handoffMessage) ||
          (typeof (tr as any).raw === "string" && (tr as any).raw);
        if (typeof candidate === "string" && candidate.trim().length >= 4) {
          finalReply = candidate.trim();
          break;
        }
      }
      if (!finalReply) {
        finalReply = "抱歉，本次没能生成回复。可能是模型响应异常，请点击「重跑」或换个问法再试。";
      }
    }
  }

  return {
    plan,
    steps: traces,
    finalReply,
    riskResult,
    needsClarification,
    clarificationQuestion,
    handoffToHuman,
    handoffMessage,
    handoffReason,
    error: execError || undefined,
  };
}
