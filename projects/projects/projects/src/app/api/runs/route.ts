import { NextRequest } from "next/server";
import { readRuns } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source");
  const badCase = searchParams.get("badCase");
  const limit = Math.min(Number(searchParams.get("limit") ?? 200), 500);

  const { runs: allRuns } = await readRuns();
  let runs = allRuns;
  if (source) runs = runs.filter((r) => r.source === source);
  if (badCase === "1") runs = runs.filter((r) => r.isBadCase);

  // 列表视图：保留 ops 页需要的统计字段（risk/handoff/needsClarification/isBadCase/steps.status），避免前端全部是 0
  const list = runs.slice(0, limit).map((r) => ({
    id: r.id,
    runId: r.runId,
    question: r.question,
    userQuestion: r.userQuestion,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
    durationMs: r.durationMs,
    source: r.source,
    status: r.status,
    risk: r.risk,
    riskResult: r.risk ?? null,
    riskPassed: r.risk?.passed,
    riskLevel: r.risk?.riskLevel,
    riskIssues: r.risk?.issues,
    isBadCase: r.isBadCase,
    rating: r.rating,
    ratings: (r as any).ratings,
    handoffToHuman: r.handoffToHuman,
    handoffReason: r.handoffReason,
    needsClarification: r.needsClarification,
    clarificationQuestion: r.clarificationQuestion,
    steps: (r.steps || []).map((s, idx) => ({
      stepIndex: s.stepIndex ?? idx,
      step: (s.stepIndex ?? idx) + 1,
      type: s.type,
      ref: s.ref,
      refName: s.refName,
      description: s.description,
      status: s.status,
      error: s.error,
      durationMs: s.durationMs,
    })),
    stepCount: r.steps.length,
    finalReply: r.finalReply ? r.finalReply.slice(0, 120) : undefined,
    note: r.note,
    tags: r.tags,
    evalBatchId: r.evalBatchId,
  }));

  return Response.json({ runs: list, total: runs.length });
}
