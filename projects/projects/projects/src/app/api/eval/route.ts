import { NextResponse } from "next/server";
import {
  readEvalCases,
  readEvalBatches,
  listToolConfigs,
} from "@/lib/store";
import { listSkills } from "@/lib/skills-registry";

export async function GET() {
  const { cases } = await readEvalCases();
  const batches = (await readEvalBatches()).batches;
  const skills = listSkills();
  const tools = await listToolConfigs();
  return NextResponse.json({
    cases: cases.map((c) => ({ ...c, dimension: c.evalDimension })),
    batches: batches.slice(0, 20),
    skills: skills.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled })),
    tools: tools.map((t) => ({ id: t.id, name: t.name, enabled: t.enabled })),
  });
}
