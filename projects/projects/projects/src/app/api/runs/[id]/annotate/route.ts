import { annotateRun } from "@/lib/store";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as {
    isBadCase?: boolean;
    rating?: 1 | 2 | 3 | 4 | 5;
    note?: string;
    tags?: string[];
  };
  const patch: Record<string, unknown> = {};
  if (typeof body.isBadCase === "boolean") patch.isBadCase = body.isBadCase;
  if (body.rating && [1, 2, 3, 4, 5].includes(body.rating)) patch.rating = body.rating;
  if (body.note !== undefined) patch.note = body.note;
  if (Array.isArray(body.tags)) patch.tags = body.tags;

  const updated = await annotateRun(id, patch);
  if (!updated) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ run: updated });
}
