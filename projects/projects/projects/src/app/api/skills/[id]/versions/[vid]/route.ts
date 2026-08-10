import { NextResponse } from "next/server";
import { getSkillVersion, rollbackSkillVersion } from "@/lib/skill-versions";

export const runtime = "nodejs";

/** GET /api/skills/[id]/versions/[vid] 获取单个版本详情 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  const { id, vid } = await params;
  const v = await getSkillVersion(id, vid);
  if (!v) return NextResponse.json({ error: "版本不存在" }, { status: 404 });
  return NextResponse.json({ version: v });
}

/** PUT /api/skills/[id]/versions/[vid] 直接回滚到 vid */
export async function PUT(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  const { id, vid } = await params;
  const exists = await getSkillVersion(id, vid);
  if (!exists) return NextResponse.json({ error: "版本不存在" }, { status: 404 });
  const versions = await rollbackSkillVersion(id, vid);
  return NextResponse.json({ ok: true, rolledBackTo: vid, versions });
}
