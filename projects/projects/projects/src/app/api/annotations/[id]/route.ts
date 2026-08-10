import { NextRequest, NextResponse } from "next/server";
import { listAnnotations, updateAnnotation } from "@/lib/store";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { action, reviewNote } = body as {
      action: "approve" | "reject";
      reviewNote?: string;
    };
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "action 必须是 approve 或 reject" }, { status: 400 });
    }
    const annotations = await listAnnotations();
    const target = annotations.find((a) => a.id === id);
    if (!target) {
      return NextResponse.json({ error: "标注任务不存在" }, { status: 404 });
    }
    const updated = await updateAnnotation(id, {
      status: action === "approve" ? "approved" : "rejected",
      reviewNote: reviewNote ?? (action === "approve" ? "审核通过，可加入评测集" : "审核驳回，标注维度或结论需调整"),
      reviewedAt: new Date().toISOString(),
    });
    return NextResponse.json({ annotation: updated });
  } catch (e) {
    console.error("[annotations PATCH]", e);
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}
