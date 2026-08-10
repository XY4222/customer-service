import { NextResponse } from "next/server";
import { readEvalBatches } from "@/lib/store";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await readEvalBatches();
  const batch = store.batches.find((b) => b.id === id);
  if (!batch) {
    return NextResponse.json(
      { error: { code: "BATCH_NOT_FOUND", message: "未找到评测批次" } },
      { status: 404 }
    );
  }
  return NextResponse.json({ batch });
}
