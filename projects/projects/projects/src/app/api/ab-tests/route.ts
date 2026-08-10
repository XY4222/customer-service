import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const AB_FILE = path.join(process.cwd(), "data", "ab-tests.json");
const AB_MOCK = path.join(process.cwd(), "scripts", "ab-test-mock.json");

export const runtime = "nodejs";

async function ensureData() {
  try {
    await fs.access(AB_FILE);
  } catch {
    // seed from mock json
    const raw = await fs.readFile(AB_MOCK, "utf-8");
    await fs.writeFile(AB_FILE, JSON.stringify({ tests: JSON.parse(raw) }, null, 2), "utf-8");
  }
  const raw = await fs.readFile(AB_FILE, "utf-8");
  return JSON.parse(raw) as { tests: any[] };
}

export async function GET() {
  const data = await ensureData();
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const {
    name, targetType, targetId, targetName,
    variantALabel, variantBLabel,
    trafficSplit = 50, goal = "",
  } = body as {
    name?: string; targetType?: "skill" | "planner"; targetId?: string; targetName?: string;
    variantALabel?: string; variantBLabel?: string;
    trafficSplit?: number; goal?: string;
  };
  if (!name || !targetType || !targetId || !variantALabel || !variantBLabel) {
    return NextResponse.json({ error: "缺少必填字段（name/targetType/targetId/variantALabel/variantBLabel）" }, { status: 400 });
  }
  const data = await ensureData();
  const id = "ab_" + Math.random().toString(36).slice(2, 8);
  const newTest: any = {
    id,
    name,
    targetType,
    targetId,
    targetName: targetName || targetId,
    variantA: "current",
    variantALabel,
    variantB: "new",
    variantBLabel,
    trafficSplit: Math.max(5, Math.min(95, Number(trafficSplit) || 50)),
    status: "draft",
    startedAt: null,
    metrics: {
      aCount: 0, bCount: 0,
      aPassRate: 0, bPassRate: 0,
      aAvgTokens: 0, bAvgTokens: 0,
      aAvgLatencyMs: 0, bAvgLatencyMs: 0,
      aAvgScore: 0, bAvgScore: 0,
    },
    winner: null,
    confidence: 0,
    goal: goal || "对比两个版本的实际效果",
  };
  data.tests.unshift(newTest);
  await fs.writeFile(AB_FILE, JSON.stringify(data, null, 2), "utf-8");
  return NextResponse.json({ ok: true, test: newTest });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { id, status, winner } = body as { id?: string; status?: string; winner?: string };
  if (!id) return NextResponse.json({ error: "id 必填" }, { status: 400 });
  const data = await ensureData();
  const idx = data.tests.findIndex((t) => t.id === id);
  if (idx < 0) return NextResponse.json({ error: "实验不存在" }, { status: 404 });
  const t = data.tests[idx];
  if (status) t.status = status;
  if (winner) t.winner = winner;
  if (status === "running" && !t.startedAt) t.startedAt = new Date().toISOString();
  if (status === "paused") t.pausedAt = new Date().toISOString();
  if (status === "completed") t.endedAt = new Date().toISOString();
  await fs.writeFile(AB_FILE, JSON.stringify(data, null, 2), "utf-8");
  return NextResponse.json({ ok: true, test: data.tests[idx] });
}
