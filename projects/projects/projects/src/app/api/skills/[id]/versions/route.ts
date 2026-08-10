import { NextResponse } from "next/server";
import {
  listSkillVersions,
  snapshotSkillBeforeWrite,
  rollbackSkillVersion,
  getSkillVersion,
} from "@/lib/skill-versions";

export const runtime = "nodejs";

/** GET /api/skills/[id]/versions 列表（不含 body） */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const list = await listSkillVersions(id);
  return NextResponse.json({
    versions: list.map((v) => ({
      vId: v.id,
      id: v.id,
      skillId: v.skillId,
      message: v.message,
      reason: v.message,
      createdAt: v.createdAt,
      source: v.source,
    })),
  });
}

/** POST /api/skills/[id]/versions 手动存快照 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { message?: string };
  const snap = await snapshotSkillBeforeWrite(id, body.message || "手动快照", "manual");
  if (!snap) return NextResponse.json({ error: "Skill 不存在" }, { status: 404 });
  return NextResponse.json({ ok: true, version: snap });
}

/** PUT /api/skills/[id]/versions body: { versionId } 回滚（兼容 body 形式） */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { versionId?: string };
  const versionId = body.versionId;
  if (!versionId) return NextResponse.json({ error: "versionId 必填" }, { status: 400 });
  const exists = await getSkillVersion(id, versionId);
  if (!exists) return NextResponse.json({ error: "版本不存在" }, { status: 404 });
  const versions = await rollbackSkillVersion(id, versionId);
  return NextResponse.json({ ok: true, rolledBackTo: versionId, versions });
}
