import { type NextRequest, NextResponse } from "next/server";
import { addEvalCase, listEvalCases } from "@/lib/store";

// POST 将一次 run 加入 Eval 黄金用例集
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { question, expectedReply, expectedKeywords, expectedPrice, expectRiskPassed, tags, sourceRunId, name } = body || {};
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "question 必填" }, { status: 400 });
    }
    const cases = await listEvalCases();
    const existing = cases.find(
      (c: { question: string; enabled: boolean }) => c.question.trim() === question.trim() && c.enabled,
    );
    if (existing) {
      return NextResponse.json({ ok: true, id: (existing as any).id, duplicated: true });
    }
    const id = "case" + Math.random().toString(36).slice(2, 10);
    const one = {
      id,
      name: name || question.slice(0, 20),
      question,
      expectedReply: expectedReply || "",
      expectedKeywords: Array.isArray(expectedKeywords) ? expectedKeywords : [],
      expectedPrice: typeof expectedPrice === "number" ? expectedPrice : undefined,
      expectRiskPassed: expectRiskPassed !== false,
      enabled: true,
      evalDimension: "keyword" as const,
      tags: Array.isArray(tags) ? tags : sourceRunId ? ["from_run"] : [],
      sourceRunId: sourceRunId || undefined,
      createdAt: new Date().toISOString(),
    };
    await addEvalCase(one as any);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET() {
  const cases = await listEvalCases();
  return NextResponse.json({ cases });
}
