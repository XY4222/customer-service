import { NextResponse } from "next/server";
import { getRun, saveRun } from "@/lib/store";
import { draftCandidates } from "@/lib/draft-candidates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/runs/[id]/draft-candidates
 * 为已转人工的会话生成（或重新生成）3 条候选话术并落库。
 * 只起草，不发送——不存在任何发送端点，这是「只填不发」的技术保证。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: { code: "RUN_NOT_FOUND", message: "运行记录不存在" } }, { status: 404 });
  if (!run.handoffToHuman) {
    return NextResponse.json(
      { error: { code: "NOT_HANDOFF", message: "该会话未被判定需要人工介入，不生成坐席候选" } },
      { status: 400 },
    );
  }

  const result = await draftCandidates(run);
  run.draftCandidates = result.candidates;
  run.draftUsedFallback = result.usedFallback;
  /* 重新生成候选视为回到「待选择」：清掉上一次的选择与发送留痕，避免留痕与候选不一致 */
  run.selectedCandidateId = null;
  run.selectedBy = null;
  run.selectedAt = null;
  run.sentAt = null;
  await saveRun(run);

  return NextResponse.json({
    runId: run.runId,
    candidates: result.candidates,
    usedFallback: result.usedFallback,
    notes: result.notes,
  });
}

/**
 * PATCH /api/runs/[id]/draft-candidates
 * 坐席动作：{ action: "select", candidateId, operator } 或 { action: "mark-sent", operator }
 * 只记录人的决定，系统不发送任何消息。
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: { code: "RUN_NOT_FOUND", message: "运行记录不存在" } }, { status: 404 });

  let body: { action?: unknown; candidateId?: unknown; operator?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_BODY", message: "请求体不是合法 JSON" } }, { status: 400 });
  }
  // body 可能是 null / 数组 / 字符串（合法 JSON 但不是对象）：必须先挡住，否则读取属性会 500
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: { code: "INVALID_BODY", message: "请求体必须是 JSON 对象，如 {\"action\":\"select\"}" } },
      { status: 400 },
    );
  }
  const operator =
    typeof body.operator === "string" && body.operator.trim() ? body.operator.trim().slice(0, 40) : "演示坐席";
  const candidates = run.draftCandidates ?? [];

  if (body.action === "select") {
    if (typeof body.candidateId !== "string" || !candidates.some((c) => c.id === body.candidateId)) {
      return NextResponse.json(
        { error: { code: "CANDIDATE_NOT_FOUND", message: "候选不存在，请先生成候选或检查 candidateId" } },
        { status: 400 },
      );
    }
    run.selectedCandidateId = body.candidateId;
    run.selectedBy = operator;
    run.selectedAt = new Date().toISOString();
    /* 改选另一条时，之前"已标记发送"的留痕作废——发送状态必须与当前选择一致 */
    run.sentAt = null;
    await saveRun(run);
    return NextResponse.json({
      runId: run.runId,
      status: "selected",
      selectedCandidateId: run.selectedCandidateId,
      selectedBy: run.selectedBy,
      selectedAt: run.selectedAt,
    });
  }

  if (body.action === "mark-sent") {
    if (!run.selectedCandidateId) {
      return NextResponse.json(
        {
          error: {
            code: "NO_SELECTION",
            message: "还没有选择候选话术，不能标记为已发送（系统不会自动发送，需坐席先选定）",
          },
        },
        { status: 400 },
      );
    }
    run.sentAt = new Date().toISOString();
    await saveRun(run);
    return NextResponse.json({
      runId: run.runId,
      status: "sent",
      selectedCandidateId: run.selectedCandidateId,
      selectedBy: run.selectedBy,
      sentAt: run.sentAt,
      deliveredBy: "human",
    });
  }

  return NextResponse.json(
    { error: { code: "UNKNOWN_ACTION", message: "action 必须是 select 或 mark-sent" } },
    { status: 400 },
  );
}
