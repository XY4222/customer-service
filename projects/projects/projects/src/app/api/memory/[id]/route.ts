import { NextRequest, NextResponse } from "next/server";
import { readProfile, deleteProfile, sanitizeVisitorId } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/memory/[id] — 单个访客完整画像 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const visitorId = sanitizeVisitorId(id);
  if (!visitorId) {
    return NextResponse.json({ error: "invalid visitor id" }, { status: 400 });
  }
  const profile = await readProfile(visitorId);
  return NextResponse.json({ visitorId, profile });
}

/** DELETE /api/memory/[id] — 删除画像（用户被遗忘权） */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const visitorId = sanitizeVisitorId(id);
  if (!visitorId) {
    return NextResponse.json({ error: "invalid visitor id" }, { status: 400 });
  }
  const ok = await deleteProfile(visitorId);
  return NextResponse.json({ ok, visitorId });
}
