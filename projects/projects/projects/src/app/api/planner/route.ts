import { NextResponse } from "next/server";
import { readPlannerConfig, writePlannerConfig } from "@/lib/planner";
import { getEffectiveModelForDisplay } from "@/lib/llm";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = readPlannerConfig();
  const { effective, translated } = getEffectiveModelForDisplay(config.model);
  return NextResponse.json({ config, effectiveModel: effective, modelTranslated: translated });
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const next = writePlannerConfig(body);
    return NextResponse.json({ config: next });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 400 });
  }
}
