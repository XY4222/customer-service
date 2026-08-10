import { NextResponse } from "next/server";
import { readEvalCases, writeEvalCases } from "@/lib/store";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const store = await readEvalCases();
  const idx = store.cases.findIndex((c) => c.id === id);
  if (idx === -1) return NextResponse.json({ error: "not found" }, { status: 404 });
  store.cases[idx] = { ...store.cases[idx], ...body };
  await writeEvalCases(store);
  return NextResponse.json(store.cases[idx]);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await readEvalCases();
  const idx = store.cases.findIndex((c) => c.id === id);
  if (idx === -1) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [removed] = store.cases.splice(idx, 1);
  await writeEvalCases(store);
  return NextResponse.json({ ok: true, removed: removed.id });
}
