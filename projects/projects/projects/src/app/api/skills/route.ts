import { NextResponse } from "next/server";
import {
  listSkills,
  createSkillFromDescription,
  createSkill,
} from "@/lib/skills-registry";
import { getEffectiveModelForDisplay } from "@/lib/llm";

export async function GET() {
  const skills = listSkills().map((s) => {
    const eff = getEffectiveModelForDisplay(s.model);
    return { ...s, effectiveModel: eff.effective, modelTranslated: eff.translated };
  });
  return NextResponse.json({ skills });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (body.mode === "ai_create") {
    const doc = await createSkillFromDescription(body.description || "", body.name);
    return NextResponse.json({ skill: doc });
  }
  const id = (body.id || `skill_${Date.now()}`).replace(/[^a-z0-9_-]/gi, "-");
  const skill = createSkill(id, {
    name: body.name || id,
    model: body.model || "doubao-seed-2-0-mini-260215",
    temperature: Number(body.temperature ?? 0.3),
    maxTokens: Number(body.maxTokens ?? 800),
    description: body.description || "",
  });
  return NextResponse.json({ skill });
}
