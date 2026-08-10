import { NextRequest, NextResponse } from "next/server";
import { getSkill, updateSkill, deleteSkill } from "@/lib/skills-registry";
import { snapshotSkillBeforeWrite } from "@/lib/skill-versions";
import { getEffectiveModelForDisplay } from "@/lib/llm";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = getSkill(id);
  if (!doc) return NextResponse.json({ error: "skill not found" }, { status: 404 });
  const eff = getEffectiveModelForDisplay(doc.model);
  return NextResponse.json({
    skill: { ...doc, effectiveModel: eff.effective, modelTranslated: eff.translated },
    content: doc.body,
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const existing = getSkill(id);
  if (!existing) return NextResponse.json({ error: "skill not found" }, { status: 404 });
  const patch: Record<string, unknown> = {};
  if (body.meta) {
    Object.assign(patch, body.meta);
  } else {
    if (body.name !== undefined) patch.name = body.name;
    if (body.model !== undefined) patch.model = body.model;
    if (body.temperature !== undefined) patch.temperature = body.temperature;
    if (body.maxTokens !== undefined) patch.maxTokens = body.maxTokens;
    if (body.description !== undefined) patch.description = body.description;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.requiredTools !== undefined) patch.requiredTools = body.requiredTools;
  }
  const content = body.content ?? body.body ?? existing.body;
  // 保存前自动存版本快照（若内容未变会被去重）
  if (content !== existing.body) {
    await snapshotSkillBeforeWrite(id, body.message || "编辑器保存", "manual").catch(() => null);
  }
  const updated = updateSkill(id, { ...patch, body: content } as any);
  return NextResponse.json({ skill: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  deleteSkill(id);
  return NextResponse.json({ ok: true });
}
