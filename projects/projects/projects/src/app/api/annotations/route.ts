import { NextResponse } from "next/server";
import { listAnnotations, saveAnnotation } from "@/lib/store";

export async function GET() {
  const list = await listAnnotations();
  return NextResponse.json({ annotations: list });
}

export async function POST(req: Request) {
  const body = await req.json();
  const a = {
    id: body.id ?? `ann_${Date.now().toString(36)}`,
    createdAt: body.createdAt ?? new Date().toISOString(),
    status: body.status ?? "pending",
    scores: body.scores ?? { correctness: 3, relevance: 3, completeness: 3, safety: 3, tone: 3, overall: 3 },
    ...body,
  };
  await saveAnnotation(a);
  return NextResponse.json({ ok: true, annotation: a });
}
