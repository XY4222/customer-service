import { NextResponse } from "next/server";
import { readSkillFile, writeSkillFile } from "@/lib/skills-registry";
import { snapshotSkillBeforeWrite } from "@/lib/skill-versions";

export const runtime = "nodejs";
export const maxDuration = 30;

interface ApplyRequest {
  skillId: string;
  // 若传 segments，按 segments 应用；若传 regenerate=true+clusterName，则重新生成并直接应用
  segments?: Array<{
    kind: "keep" | "replace" | "insert_after";
    anchor?: string;
    oldText?: string;
    newText: string;
  }>;
}

function fuzzyFindLine(body: string, anchor?: string): number {
  if (!anchor) return -1;
  const lines = body.split("\n");
  const tryKeys = anchor.split("|").map((s) => s.trim()).filter(Boolean);
  for (const k of tryKeys) {
    const idx = lines.findIndex((l) => l.includes(k));
    if (idx >= 0) return idx;
  }
  return -1;
}

function applyPatch(body: string, segments: NonNullable<ApplyRequest["segments"]>): string {
  const lines = body.split("\n");
  const ops = segments
    .map((seg) => ({ seg, idx: fuzzyFindLine(body, seg.anchor) }))
    .sort((a, b) => b.idx - a.idx);

  for (const { seg, idx } of ops) {
    if (seg.kind === "replace" && seg.oldText && idx >= 0) {
      const blockLines = seg.oldText.split("\n");
      let start = -1;
      for (let i = Math.max(0, idx - 5); i < lines.length; i++) {
        if (lines[i].includes(blockLines[0].trim())) {
          start = i;
          break;
        }
      }
      if (start >= 0) {
        const newLines = seg.newText.split("\n");
        lines.splice(start, blockLines.length, ...newLines);
      }
    } else if (seg.kind === "insert_after" && idx >= 0) {
      lines.splice(idx + 1, 0, ...seg.newText.split("\n"));
    }
  }
  return lines.join("\n");
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as ApplyRequest;
  const { skillId, segments } = body;
  if (!skillId || !Array.isArray(segments) || segments.length === 0) {
    return NextResponse.json({ error: "skillId 与 segments 必填" }, { status: 400 });
  }
  const original = readSkillFile(skillId) || "";
  if (!original) {
    return NextResponse.json({ error: `Skill ${skillId} 不存在或无法读取` }, { status: 404 });
  }
  // 应用补丁前自动存版本快照
  await snapshotSkillBeforeWrite(skillId, "改进建议补丁应用", "patch").catch(() => null);
  const patched = applyPatch(original, segments);
  writeSkillFile(skillId, patched);
  return NextResponse.json({ ok: true, skillId, applied: segments.length });
}
