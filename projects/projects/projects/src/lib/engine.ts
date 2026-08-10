/**
 * Agent 执行主链路统一入口 (lib/engine.ts)
 *
 * 编排顺序：
 *   1. 读取已启用 Skill/Tool/Planner 配置
 *   2. 调用 generatePlan() 产出 plan
 *   3. 校验 Plan（硬规则：未启用能力/缺风控/价格 Tool 缺失）
 *   4. 调用 executePlan() 执行，回调中记录 TraceItem
 *   5. 持久化 RunRecord（saveRun）
 */

import { generatePlan, fallbackPlan } from "./planner";
import { executePlan, type ExecutionResult } from "./executor";
import { listEnabledSkills } from "./skills-registry";
import { getToolCatalog } from "./tools";
import { saveRun, getRun, type RunRecord, type StepRecord, type RiskResult } from "./store";
import { randomId } from "./utils";
import type {
  RunSource,
  TraceItem,
  RiskCheckResult,
  PlannerDecisionEvent,
  ConversationTurn,
} from "./types";

export interface RunOptions {
  question: string;
  source?: RunSource;
  history?: ConversationTurn[];
  evalCaseId?: string;
  evalBatchId?: string;
  onDecision?: (e: PlannerDecisionEvent) => void;
  onStepStart?: (step: TraceItem) => void;
  onStepOutput?: (step: TraceItem) => void;
  onStepError?: (step: TraceItem) => void;
  onFinal?: (reply: string, risk: RiskCheckResult | null) => void;
}

/**
 * 校验 Plan 是否合规：
 *  1. 只能使用启用的 Skill/Tool
 *  2. 涉及价格/活动/券时必须存在 calculate_price Tool（若存在 response-generator）
 *  3. 最后一步必须是 risk-check
 */
export function validatePlanForRuntime(
  plan: { steps: { type: "skill" | "tool"; ref: string }[] },
  enabledSkillIds: Set<string>,
  enabledToolIds: Set<string>,
): { valid: boolean; issues: string[]; needRiskCheck: boolean } {
  const issues: string[] = [];
  for (const s of plan.steps) {
    if (s.type === "skill" && !enabledSkillIds.has(s.ref)) {
      issues.push(`Skill [${s.ref}] 未启用或不存在`);
    }
    if (s.type === "tool" && !enabledToolIds.has(s.ref)) {
      issues.push(`Tool [${s.ref}] 未启用或不存在`);
    }
  }
  const last = plan.steps[plan.steps.length - 1];
  const needRiskCheck = !(last && last.type === "skill" && last.ref === "risk-check");
  const hasCalculatePrice = enabledToolIds.has("calculate_price");
  if (plan.steps.some((s) => s.type === "skill" && s.ref === "response-generator") && !hasCalculatePrice) {
    issues.push("response-generator 依赖 calculate_price Tool，但该 Tool 未启用");
  }
  if (needRiskCheck) issues.push("最终回复必须经过 risk-check 风控审核");
  return { valid: issues.length === 0, issues, needRiskCheck };
}

function buildTraceItem(
  stepIndex: number,
  type: "skill" | "tool",
  target: string,
  description: string,
  input: unknown,
  output: unknown,
  status: TraceItem["status"],
  startedAt: string,
  finishedAt: string,
  durationMs: number,
  error?: string | null,
): TraceItem {
  return {
    stepIndex,
    type,
    target,
    description,
    input,
    output,
    status,
    startedAt,
    finishedAt,
    durationMs,
    error: error ?? undefined,
  };
}

function traceToStepRecord(t: TraceItem, planSteps: { type?: string; ref?: string; description?: string }[]): StepRecord {
  const ps = planSteps[t.stepIndex] ?? {};
  return {
    stepIndex: t.stepIndex,
    type: (t.type ?? ps.type ?? "skill") as "skill" | "tool",
    ref: t.target ?? ps.ref ?? "",
    refName: t.target ?? ps.ref ?? "",
    description: t.description ?? ps.description ?? "",
    input: (t.input ?? {}) as Record<string, unknown>,
    output: t.output ?? null,
    status: t.status === "error" ? "failed" : t.status === "success" ? "success" : t.status === "skipped" ? "skipped" : "running",
    error: t.error ?? null,
    durationMs: t.durationMs ?? 0,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt,
  };
}

function toCheckResult(r: ExecutionResult["riskResult"]): RiskResult | null {
  if (!r) return null;
  const issues = (r.issues ?? []).map((i: any) =>
    typeof i === "string"
      ? { type: "general", detail: i, severity: "warning" as const }
      : { type: i.type ?? "general", detail: i.detail ?? String(i), severity: (i.severity as "warning" | "blocker") ?? "warning" },
  );
  return { passed: r.passed, riskLevel: r.riskLevel as RiskResult["riskLevel"], issues };
}

/** 统一 Agent 执行入口（非 SSE；SSE 由 /api/agent/run 直接处理） */
export async function runAgent(options: RunOptions): Promise<RunRecord> {
  const {
    question,
    source = "user",
    history = [],
    evalCaseId,
    evalBatchId,
    onDecision,
    onStepStart,
    onStepOutput,
    onStepError,
    onFinal,
  } = options;

  const startedAt = new Date().toISOString();
  const runId = randomId("run");
  const enabledSkills = await listEnabledSkills();
  const allTools = await getToolCatalog();
  const enabledTools = allTools.filter((t) => t.enabled);
  const skillIds = new Set(enabledSkills.map((s) => s.id));
  const toolIds = new Set(enabledTools.map((t) => t.id));

  onDecision?.({ phase: "context", message: `加载完成：${enabledSkills.length} 个 Skill，${enabledTools.length} 个 Tool`, ts: Date.now() });

  let plan: any;
  try {
    plan = await generatePlan({ question, history });
    onDecision?.({ phase: "select", message: "Planner 已生成计划", detail: plan, ts: Date.now() });
  } catch (e) {
    onDecision?.({ phase: "fallback", message: `Planner 失败，启用兜底计划: ${(e as Error).message}`, ts: Date.now() });
    plan = fallbackPlan();
  }

  const validation = validatePlanForRuntime(plan, skillIds, toolIds);
  if (!validation.valid) {
    onDecision?.({ phase: "validate", message: `计划校验提示：${validation.issues.join("; ")}`, ts: Date.now() });
    if (validation.issues.some((i) => i.includes("未启用") || i.includes("不存在") || i.includes("calculate_price"))) {
      plan = fallbackPlan();
    }
    if (validation.needRiskCheck && skillIds.has("risk-check")) {
      plan.steps.push({ step: plan.steps.length, type: "skill", ref: "risk-check", description: "风控审核（自动追加）", input: {} });
    }
  } else {
    onDecision?.({ phase: "validate", message: `计划校验通过，共 ${plan.steps.length} 步`, ts: Date.now() });
  }

  const traces: TraceItem[] = [];
  const stepRecords: StepRecord[] = [];
  let finalReply = "";
  let riskResult: RiskResult | null = null;

  const result: ExecutionResult = await executePlan({
    plan,
    question,
    history,
    availableSkills: Array.from(skillIds),
    availableTools: Array.from(toolIds),
    onStepStart: (idx: number, input: Record<string, unknown>) => {
      const ps = plan.steps[idx] ?? {};
      const t = buildTraceItem(
        idx,
        ps.type ?? "skill",
        ps.ref ?? "",
        ps.description ?? "",
        input,
        null,
        "running",
        new Date().toISOString(),
        new Date().toISOString(),
        0,
      );
      traces[idx] = t;
      stepRecords[idx] = traceToStepRecord(t, plan.steps);
      onStepStart?.(t);
    },
    onStepComplete: (idx: number, output: unknown) => {
      const ps = plan.steps[idx] ?? {};
      const prev = traces[idx];
      const finishedAt = new Date().toISOString();
      const durationMs = prev ? new Date(finishedAt).getTime() - new Date(prev.startedAt).getTime() : 0;
      const isSkipped = typeof output === "object" && output && "skipped" in (output as Record<string, unknown>);
      const t = buildTraceItem(
        idx,
        ps.type ?? prev?.type ?? "skill",
        ps.ref ?? prev?.target ?? "",
        ps.description ?? prev?.description ?? "",
        prev?.input ?? {},
        output,
        isSkipped ? "skipped" : "success",
        prev?.startedAt ?? finishedAt,
        finishedAt,
        durationMs,
      );
      traces[idx] = t;
      stepRecords[idx] = traceToStepRecord(t, plan.steps);
      if (t.type === "skill" && t.target === "risk-check" && typeof output === "object" && output && !isSkipped) {
        const r = (result as any).riskResult;
        if (r) riskResult = toCheckResult(r);
      }
      if (t.type === "skill" && t.target === "response-generator" && typeof output === "object" && output && !isSkipped) {
        const o = output as Record<string, unknown>;
        if (typeof o.reply === "string") finalReply = o.reply;
      }
      onStepOutput?.(t);
    },
    onStepError: (idx: number, err: Error | string) => {
      const ps = plan.steps[idx] ?? {};
      const prev = traces[idx];
      const finishedAt = new Date().toISOString();
      const durationMs = prev ? new Date(finishedAt).getTime() - new Date(prev.startedAt).getTime() : 0;
      const t = buildTraceItem(
        idx,
        ps.type ?? prev?.type ?? "skill",
        ps.ref ?? prev?.target ?? "",
        ps.description ?? prev?.description ?? "",
        prev?.input ?? {},
        prev?.output ?? null,
        "error",
        prev?.startedAt ?? finishedAt,
        finishedAt,
        durationMs,
        String((err as Error)?.message ?? err),
      );
      traces[idx] = t;
      stepRecords[idx] = traceToStepRecord(t, plan.steps);
      onStepError?.(t);
    },
  });

  finalReply = finalReply || result.finalReply || "";
  riskResult = riskResult ?? toCheckResult(result.riskResult);

  const finishedAtTs = new Date().toISOString();
  const runRecord: RunRecord = {
    runId,
    id: runId,
    source,
    evalCaseId,
    evalBatchId,
    userQuestion: question,
    question,
    plan: plan as unknown,
    steps: stepRecords.filter(Boolean),
    finalReply,
    reasoning: plan.reasoning ?? "",
    riskResult,
    status: result.error ? "failed" : riskResult && !riskResult.passed ? "risk_blocked" : "success",
    startedAt,
    finishedAt: finishedAtTs,
    durationMs: new Date(finishedAtTs).getTime() - new Date(startedAt).getTime(),
    skillsUsed: plan.steps.filter((s: any) => s.type === "skill").map((s: any) => s.ref),
    toolsUsed: plan.steps.filter((s: any) => s.type === "tool").map((s: any) => s.ref),
  };
  await saveRun(runRecord);
  onFinal?.(finalReply, riskResult as unknown as RiskCheckResult | null);
  return runRecord;
}

export async function replayRun(runId: string): Promise<RunRecord> {
  const original = await getRun(runId);
  if (!original) throw new Error(`Run ${runId} not found`);
  return runAgent({
    question: original.question ?? original.userQuestion ?? "",
    source: "replay",
    history: (original as any).conversationHistory ?? [],
  });
}

/** 解释一次 Run 的产物（可审计的结构化说明） */
export function explainArtifact(_params: {
  artifact: "plan" | "step" | "risk" | "reply";
  stepIndex?: number;
  context?: string;
}): string {
  return "Trace 中记录了每一步的输入、输出、耗时与状态；Plan 列出 Planner 决策序列；Risk 字段给出风控结论与 issues；最终 Reply 即发送给用户的话术。";
}
