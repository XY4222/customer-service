import { NextRequest, NextResponse } from "next/server";
import { explainArtifact } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/explain
 * 解释 Agent / Planner 产物
 * body: { runId?, artifact: "plan"|"step"|"risk"|"reply", stepIndex?, context? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      runId?: string;
      artifact: "plan" | "step" | "risk" | "reply";
      stepIndex?: number;
      context?: string;
    };
    if (!body.artifact) {
      return NextResponse.json({ error: "artifact is required" }, { status: 400 });
    }
    const explanation = explainArtifact(body);
    return NextResponse.json({ explanation });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
