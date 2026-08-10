import { NextResponse } from 'next/server';
import { getRun, saveRun } from '@/lib/store';

/**
 * POST /api/runs/[id]/handoff
 * 标记某次运行为「已转人工」，前端点击"转人工客服"时调用。
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) {
    return NextResponse.json({ error: 'run not found' }, { status: 404 });
  }
  let body: { reason?: string } = {};
  try {
    body = await _req.json();
  } catch {
    // ignore
  }
  run.handoffToHuman = true;
  run.handoffReason = body.reason ?? '用户主动转人工';
  run.handoffAt = new Date().toISOString();
  await saveRun(run);
  return NextResponse.json({ success: true, runId: id });
}
