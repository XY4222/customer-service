import { NextRequest } from "next/server";
import { generatePlan } from "@/lib/planner";
import { executePlan } from "@/lib/executor";
import { listEnabledSkills } from "@/lib/skills-registry";
import { listToolConfigs, saveRun, type RunRecord, type StepRecord } from "@/lib/store";
import { randomId } from "@/lib/utils";
import type { Plan } from "@/lib/planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Message { role: "user" | "assistant"; content: string; }
interface AgentBody {
  question?: string;
  history?: Message[];
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
  const { question = "", history = [], source = "user", evalCaseId, evalBatchId } = body;

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
      const skillsUsed: string[] = [];
      const toolsUsed: string[] = [];

      try {
        send("run_started", { runId });

        // Step 0: Planner
        send("planner_thinking", { thought: "Planner 正在分析可用能力..." });
        plan = await generatePlan({ question, history: fullHistory });
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
        needsClarification,
        createdAt: startedAt,
        updatedAt: finishedAt,
      };
      await saveRun(runRecord);
      send("run_saved", { runId });
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
