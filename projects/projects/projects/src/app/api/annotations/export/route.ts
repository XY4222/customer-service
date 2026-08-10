import { NextResponse } from "next/server";
import { listAnnotations } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/annotations/export
 * 导出标注数据为 JSONL（每行一条 JSON 记录，便于后续 fine-tuning）
 */
export async function GET() {
  const list = await listAnnotations();
  const lines = list.map((a: any) =>
    JSON.stringify({
      id: a.id,
      question: a.question,
      answer: a.answer,
      expectedAnswer: a.expectedAnswer,
      intent: a.intent,
      riskLevel: a.riskLevel,
      qualityTags: a.qualityTags,
      requiredCapabilities: a.requiredCapabilities,
      expectedFacts: a.expectedFacts,
      forbiddenPhrases: a.forbiddenPhrases,
      quality: a.scores ?? a.quality,
      note: a.note,
      status: a.status,
      createdAt: a.createdAt,
    }),
  );
  const body = lines.join("\n") + "\n";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-jsonlines; charset=utf-8",
      "Content-Disposition": `attachment; filename="annotations-${new Date().toISOString().slice(0, 10)}.jsonl"`,
    },
  });
}
