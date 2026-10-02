import { NextRequest, NextResponse } from "next/server";
import { getRun, saveRun, type RunRecord } from "@/lib/store";
import { listEnabledSkills } from "@/lib/skills-registry";
import { getToolCatalog } from "@/lib/tools";
import { executePlan } from "@/lib/executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/run/retry
 * body: { runId: string, stepIndex?: number }
 * 从指定步骤开始重新执行后续 plan（默认从第一个失败/降级步骤开始），SSE 流式返回。
 * 重试结果写回原 run 的 steps 并追加 finalReply（产生新版本 run，不覆盖老 trace）。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { runId: string; stepIndex?: number };
    const { runId } = body;
    if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

    const original = await getRun(runId);
    if (!original) return NextResponse.json({ error: `Run ${runId} not found` }, { status: 404 });
    const plan = (original as any).plan as { steps: Array<{ type: string; ref: string; [k: string]: unknown }> } | null;
    if (!plan || !Array.isArray(plan.steps)) {
      return NextResponse.json({ error: "原 Run 没有可执行的 plan" }, { status: 400 });
    }

    // 默认从第一个失败/降级步骤开始；否则从头开始
    let startIdx = typeof body.stepIndex === "number" ? body.stepIndex : plan.steps.findIndex((s, i) => {
      const trace = (original.steps ?? []).find((t) => t.stepIndex === i);
      return trace?.status === "error" || trace?.status === "degraded";
    });
    if (startIdx < 0) startIdx = 0;

    const skills = await listEnabledSkills();
    const tools = await getToolCatalog();

    const retryPlan = {
      ...plan,
      steps: plan.steps.slice(startIdx),
    };

    const history = Array.isArray((original as any).conversationHistory) ? (original as any).conversationHistory : [];
    const question = original.question ?? "";

    const encoder = new TextEncoder();
    const newSteps: Array<Record<string, unknown>> = [];

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        send("retry_started", { runId, startIdx, totalSteps: retryPlan.steps.length });
        try {
          const result = await executePlan({
            plan: retryPlan as any,
            question,
            history,
            availableSkills: skills.map((s) => s.id),
            availableTools: tools.map((t) => t.id),
            onStepStart: (idx: number, input: Record<string, unknown>) => {
              const planStep = retryPlan.steps[idx];
              newSteps.push({ stepIndex: startIdx + idx, ref: planStep?.ref ?? "", type: planStep?.type, input, output: null, status: "running", startedAt: new Date().toISOString() });
              send("step_started", { stepIndex: startIdx + idx, step: startIdx + idx, type: planStep?.type, ref: planStep?.ref, input });
            },
            onStepComplete: (idx: number, output: unknown) => {
              const planStep = retryPlan.steps[idx];
              const s = newSteps.find((st) => (st.stepIndex as number) === startIdx + idx);
              if (s) {
                s.output = output as any;
                s.status = "success";
                s.finishedAt = new Date().toISOString();
              }
              send("step_output", { stepIndex: startIdx + idx, step: startIdx + idx, type: planStep?.type, ref: planStep?.ref, output, status: "success" });
              send("step_completed", { stepIndex: startIdx + idx, step: startIdx + idx, type: planStep?.type, ref: planStep?.ref, output, status: "success" });
            },
            // degraded 状态在 onStepComplete 之后才能确定，由 onStepRecord 回写
            onStepRecord: (idx: number, rec: any) => {
              if (rec?.status === "degraded") {
                const s = newSteps.find((st) => (st.stepIndex as number) === startIdx + idx);
                if (s) s.status = "degraded";
              }
            },
            onStepError: (idx: number, err: Error | string) => {
              const planStep = retryPlan.steps[idx];
              const s = newSteps.find((st) => (st.stepIndex as number) === startIdx + idx);
              if (s) {
                s.error = String((err as Error)?.message ?? err);
                s.status = "error";
                s.finishedAt = new Date().toISOString();
              }
              send("step_error", { stepIndex: startIdx + idx, step: startIdx + idx, type: planStep?.type, ref: planStep?.ref, error: String((err as Error)?.message ?? err) });
            },
          });

          // 写回原 run：用重试结果替换 startIdx 之后的 steps
          const oldSteps = (original.steps ?? []).filter((t) => t.stepIndex < startIdx);
          const mergedSteps: import("@/lib/store").StepRecord[] = [...oldSteps, ...newSteps.map((s) => ({
            stepIndex: s.stepIndex as number,
            ref: (s.ref as string) ?? "",
            refName: (s.ref as string) ?? "",
            type: s.type as "skill" | "tool",
            description: "",
            input: s.input as Record<string, unknown>,
            output: s.output as Record<string, unknown>,
            status: (() => {
              const raw = s.status as string;
              if (raw === "error") return "error";
              if (raw === "degraded") return "degraded";
              return "success";
            })() as "success" | "error" | "degraded",
            startedAt: s.startedAt as string,
            finishedAt: s.finishedAt as string | undefined,
            error: s.error as string | undefined,
          }))];
          original.steps = mergedSteps;
          original.finalReply = result.finalReply ?? null;
          original.riskResult = (result.riskResult as RunRecord["riskResult"]) ?? null;
          original.status = result.riskResult?.passed === false ? "risk_blocked" : "success";
          /* 复跑要同时尊重「风控未过」与「确定性/模型判定的转人工」，否则复跑会把待人工会话
             悄悄变回普通会话（从坐席工作台消失） */
          const retryRiskBlocked = result.riskResult?.passed === false;
          const retryHandoff = !!(result as { handoffToHuman?: boolean }).handoffToHuman;
          original.handoffToHuman = retryRiskBlocked || retryHandoff;
          original.handoffReason = retryRiskBlocked
            ? "risk_blocked"
            : ((result as { handoffReason?: string | null }).handoffReason ?? undefined);
          original.handoffIssues = result.riskResult?.issues?.map((i: any) => i.detail ?? String(i)) ?? [];
          original.handoffAt = original.handoffToHuman ? new Date().toISOString() : undefined;
          /* 复跑会重生成回复：候选/选择/发送留痕基于旧回复，必须一并清掉，避免留痕与内容不一致 */
          original.draftCandidates = undefined;
          original.draftUsedFallback = undefined;
          original.selectedCandidateId = null;
          original.selectedBy = null;
          original.selectedAt = null;
          original.sentAt = null;
          original.finishedAt = new Date().toISOString();
          original.durationMs = mergedSteps.reduce((acc: number, s) => {
            if (s.startedAt && s.finishedAt) return acc + (new Date(s.finishedAt).getTime() - new Date(s.startedAt).getTime());
            return acc;
          }, 0);
          await saveRun(original);

          send("final_reply", { finalReply: result.finalReply, reply: result.finalReply, risk: result.riskResult });
          send("done", { runId, finalReply: result.finalReply, risk: result.riskResult, status: result.riskResult?.passed === false ? "risk_failed" : "success" });
        } catch (err) {
          send("error", { message: (err as Error).message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
