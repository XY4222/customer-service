import { NextRequest } from "next/server";
import { generatePlan } from "@/lib/planner";
import { executePlan } from "@/lib/executor";
import { listEnabledSkills } from "@/lib/skills-registry";
import { listToolConfigs, saveRun, type RunRecord, type StepRecord } from "@/lib/store";
import { randomId } from "@/lib/utils";
import type { Plan } from "@/lib/planner";
import { readProfile, buildMemoryContext, updateMemoryAfterRun, sanitizeVisitorId } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Message { role: "user" | "assistant"; content: string; }
interface AgentBody {
  question?: string;
  history?: Message[];
  conversationHistory?: Message[]; // 前端实际发送的字段名（兼容）
  visitorId?: string;
  source?: "user" | "eval" | "demo" | "replay";
  evalCaseId?: string;
  evalBatchId?: string;
}

function stepToRecord(step: any, idx: number, planSteps: Plan["steps"]): StepRecord {
  const ps = planSteps[idx] ?? ({} as any);
  return {
    stepIndex: step.step ?? idx + 1,
    type: (ps as any).type ?? step.type ?? "skill",
    ref: (ps as any).ref ?? step.ref ?? "",
    refName: (ps as any).refName ?? step.ref ?? "",
    description: (ps as any).description ?? step.description ?? "",
    input: step.input ?? {},
    output: step.output ?? null,
    status: step.status === "error" ? "failed" : (step.status ?? "success"),
    error: step.error ?? null,
    durationMs: step.durationMs ?? 0,
    startedAt: step.startedAt ? new Date(step.startedAt).toISOString() : new Date().toISOString(),
    finishedAt: step.endedAt ? new Date(step.endedAt).toISOString() : new Date().toISOString(),
    thinking: step.thinking,
  };
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as AgentBody;
  const {
    question = "",
    history: historyField,
    conversationHistory,
    visitorId: rawVisitorId,
    source = "user",
    evalCaseId,
    evalBatchId,
  } = body;
  // 前端发送 conversationHistory；老字段 history 兼容保留
  const history = conversationHistory ?? historyField ?? [];
  const visitorId = sanitizeVisitorId(rawVisitorId);

  if (!question.trim()) {
    return new Response(JSON.stringify({ error: "question is required" }), { status: 400 });
  }

  const runId = randomId("run");
  const startedAt = new Date().toISOString();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const fullHistory = [...history, { role: "user" as const, content: question }];
      const steps: StepRecord[] = [];
      let plan: Plan | null = null;
      let finalReply = "";
      let riskResult: RunRecord["riskResult"] | null = null;
      let errorMsg = "";
      let reasoning = "";
      let needsClarification = false;
      let clarificationQuestion: string | null = null;
      let handoffToHuman = false;
      let handoffMessage: string | null = null;
      let handoffReason: string | null = null;
      const skillsUsed: string[] = [];
      const toolsUsed: string[] = [];

      try {
        send("run_started", { runId });

        // ---- 长期记忆召回（跨会话画像） ----
        let memoryProfile: Awaited<ReturnType<typeof readProfile>> = null;
        let memoryContext = "";
        try {
          memoryProfile = visitorId ? await readProfile(visitorId) : null;
          memoryContext = buildMemoryContext(memoryProfile);
        } catch {
          memoryContext = "";
        }
        if (visitorId) {
          send("memory_recalled", {
            visitorId,
            hasProfile: !!memoryProfile,
            interactionCount: memoryProfile?.interactionCount ?? 0,
            isNewUser: memoryProfile?.isNewUser ?? true,
            facts: (memoryProfile?.facts ?? []).slice(0, 10).map((f) => ({ kind: f.kind, content: f.content })),
            recentEpisodes: (memoryProfile?.episodes ?? []).slice(0, 3).map((e) => ({ summary: e.summary, ts: e.ts })),
          });
        }

        // Step 0: Planner
        send("planner_thinking", { thought: "Planner 正在分析可用能力..." });
        plan = await generatePlan({ question, history: fullHistory, memoryContext });
        reasoning = plan.reasoning ?? "";
        send("plan_ready", { plan });
        send("plan_done", { plan });

        const planSteps = plan.steps;

        // Execute（用 ref 对象承载逐步累积的 steps，避免回调里提前引用 result 触发 TDZ）
        const execRef: { steps: StepRecord[] } = { steps: [] };
        const result = await executePlan({
          plan,
          question,
          history: fullHistory,
          memoryContext,
          availableSkills: listEnabledSkills().map((s) => s.id),
          availableTools: (await listToolConfigs()).filter((t) => t.enabled).map((t) => t.id),
          onStepStart: (idx, input, _thinking, meta) => {
            send("step_started", { stepIndex: idx, step: idx, type: meta?.type, ref: meta?.ref, input });
          },
          onStepStream: (_idx, _delta) => {
            // MVP: no per-token stream; placeholder for future
          },
          onStepComplete: (idx, output, _thinking, meta) => {
            const t = execRef.steps[idx];
            const status = t?.status === "degraded" ? "degraded" : "success";
            send("step_output", { stepIndex: idx, step: idx, type: meta?.type, ref: meta?.ref, output, status });
            send("step_completed", { stepIndex: idx, step: idx, type: meta?.type, ref: meta?.ref, output, status });
          },
          onStepError: (idx, err) => {
            send("step_error", { stepIndex: idx, step: idx, error: String((err as any)?.message ?? err) });
          },
          onStepDuration: (idx, durationMs) => {
            send("step_duration", { stepIndex: idx, step: idx, durationMs });
          },
          onStepRecord: (idx, rec) => {
            execRef.steps[idx] = rec as StepRecord;
          },
        });

        // Convert result.steps (from executor) to StepRecord[]
        result.steps.forEach((s: any, i: number) => {
          const rec = stepToRecord(s, i, planSteps);
          steps.push(rec);
          if (rec.type === "skill") skillsUsed.push(rec.ref);
          else toolsUsed.push(rec.ref);
        });

        finalReply = result.finalReply ?? "";
        riskResult = (result.riskResult as RunRecord["riskResult"]) ?? null;
        errorMsg = result.error ?? "";
        needsClarification = !!(result as any).needsClarification;
        clarificationQuestion = (result as any).clarificationQuestion ?? null;
        handoffToHuman = !!(result as any).handoffToHuman;
        handoffMessage = (result as any).handoffMessage ?? null;
        handoffReason = (result as any).handoffReason ?? null;

        send("final_reply", {
          finalReply,
          reply: finalReply,
          risk: riskResult,
          needsClarification,
          clarificationQuestion,
          handoffToHuman,
          handoffMessage,
        });
      } catch (err: any) {
        errorMsg = err?.message ?? String(err);
        send("error", { message: errorMsg });
      }

      const finishedAt = new Date().toISOString();
      const totalDuration = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
      const finalStatus = errorMsg ? "error" : (riskResult?.passed === false ? "risk_failed" : "success");

      const runRecord: RunRecord = {
        runId,
        source,
        evalCaseId,
        evalBatchId,
        userQuestion: question,
        question,
        plan: plan as unknown,
        steps,
        finalReply,
        reasoning,
        riskResult,
        error: errorMsg || undefined,
        status: finalStatus === "error" ? "failed" : (finalStatus === "risk_failed" ? "risk_blocked" : "success"),
        skillsUsed,
        toolsUsed,
        startedAt,
        finishedAt,
        durationMs: totalDuration,
        handoffToHuman,
        handoffReason: handoffReason ?? undefined,
        needsClarification,
        createdAt: startedAt,
        updatedAt: finishedAt,
      };
      await saveRun(runRecord);
      send("run_saved", { runId });

      // ---- 长期记忆提取（异步、不阻塞 SSE 收尾；失败静默） ----
      // user = Agent 控制台；demo = 聊天 Demo 页（同一个真实访客，都应写记忆）
      // eval / replay 是评测与复跑，不写记忆避免污染画像
      if (visitorId && finalReply && (source === "user" || source === "demo")) {
        void updateMemoryAfterRun({
          visitorId,
          runId,
          input: {
            question,
            finalReply,
            needExtraction: steps.find((s) => s.ref === "need-extraction")?.output as Record<string, unknown> | undefined,
            products: collectProductNames(steps),
          },
        }).catch(() => {});
      }

      send("done", { runId, status: finalStatus, durationMs: totalDuration });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** 从执行轨迹的 query_products / calculate_price 步骤里收集本次涉及的商品名 */
function collectProductNames(steps: StepRecord[]): string[] {
  const names = new Set<string>();
  for (const s of steps) {
    if (s.status !== "success" && s.status !== "degraded") continue;
    const out = s.output as any;
    if (!out || typeof out !== "object") continue;
    if (Array.isArray(out.products)) {
      for (const p of out.products as any[]) {
        if (p?.name) names.add(String(p.name));
      }
    }
    if (Array.isArray(out.items)) {
      for (const it of out.items as any[]) {
        if (it?.productName) names.add(String(it.productName));
      }
    }
  }
  return [...names].slice(0, 8);
}
