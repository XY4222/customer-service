import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { atomicWriteText } from "@/lib/fs-atomic";

const AB_FILE = path.join(process.cwd(), "data", "ab-tests.json");
const AB_MOCK = path.join(process.cwd(), "scripts", "ab-test-mock.json");

export const runtime = "nodejs";

async function ensureData() {
  try {
    await fs.access(AB_FILE);
  } catch {
    const raw = await fs.readFile(AB_MOCK, "utf-8");
    await atomicWriteText(AB_FILE, JSON.stringify({ tests: JSON.parse(raw) }, null, 2));
  }
  return JSON.parse(await fs.readFile(AB_FILE, "utf-8")) as { tests: any[] };
}

// Box-Muller 正态采样
function normal(mean: number, std: number, min: number, max: number) {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(min, Math.min(max, mean + z * std));
}
function bernoulli(p: number) {
  return Math.random() < p;
}
// 两比例 z 检验置信度（B 优于 A 的概率）
function twoPropConf(aPass: number, aN: number, bPass: number, bN: number): number {
  if (aN < 2 || bN < 2) return 0;
  const pA = aPass / aN;
  const pB = bPass / bN;
  const p = (aPass + bPass) / (aN + bN);
  const se = Math.max(1e-9, Math.sqrt(p * (1 - p) * (1 / aN + 1 / bN)));
  const z = (pB - pA) / se;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp(-(z * z) / 2);
  const c = 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const cdf = z > 0 ? c : 1 - c;
  return Math.max(0, Math.min(1, cdf));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { id, samples = 50 } = body as { id?: string; samples?: number };
  if (!id) return NextResponse.json({ error: "id 必填" }, { status: 400 });
  const data = await ensureData();
  const idx = data.tests.findIndex((t) => t.id === id);
  if (idx < 0) return NextResponse.json({ error: "实验不存在" }, { status: 404 });
  const t = data.tests[idx];
  if (t.status !== "running") {
    return NextResponse.json({ error: "只有运行中的实验可以注入模拟流量" }, { status: 400 });
  }

  // 真实效果参数（B 相比 A 的提升）
  // 种子实验基于历史值：A 通过率 80~85%，B 通过率 88~92%；B CSAT 高 0.3~0.5；B延迟略低或略高
  const seedA = t.metrics?.aCount > 0 ? null : {
    passRate: 0.78 + Math.random() * 0.05,    // A 通过率 78-83%
    csat: 3.5 + Math.random() * 0.3,          // A CSAT 3.5-3.8
    latency: 750 + Math.random() * 200,       // A 延迟 750-950ms
    tokens: 320 + Math.random() * 60,         // A token
    handoff: 0.12 + Math.random() * 0.04,     // A 人工接管率 12-16%
  };
  const seedB = t.metrics?.bCount > 0 ? null : {
    // B 效果略优
    passRate: (seedA?.passRate ?? 0.8) + 0.06 + Math.random() * 0.06,  // +6~12%
    csat: (seedA?.csat ?? 3.7) + 0.4 + Math.random() * 0.3,             // +0.4~0.7
    latency: (seedA?.latency ?? 850) * (0.85 + Math.random() * 0.2),     // 85-105%
    tokens: (seedA?.tokens ?? 350) * (0.95 + Math.random() * 0.15),      // 95-110%
    handoff: (seedA?.handoff ?? 0.14) * (0.55 + Math.random() * 0.2),    // 55-75%
  };

  // 保证 metrics 完整（旧数据可能缺 handoff/tokens 字段）
  const m = t.metrics || ({} as any);
  const metricsDefault = {
    aCount: m.aCount ?? 0, aPassRate: m.aPassRate ?? 0, aAvgScore: m.aAvgScore ?? 0,
    aAvgLatencyMs: m.aAvgLatencyMs ?? 0, aAvgTokens: m.aAvgTokens ?? 0, aHandoffRate: m.aHandoffRate ?? 0,
    bCount: m.bCount ?? 0, bPassRate: m.bPassRate ?? 0, bAvgScore: m.bAvgScore ?? 0,
    bAvgLatencyMs: m.bAvgLatencyMs ?? 0, bAvgTokens: m.bAvgTokens ?? 0, bHandoffRate: m.bHandoffRate ?? 0,
  };
  t.metrics = metricsDefault;

  // 使用已存在的均值作为采样中心（持续追加）
  const aBase = {
    passRate: t.metrics.aCount > 0 ? t.metrics.aPassRate : seedA!.passRate,
    csat: t.metrics.aCount > 0 ? t.metrics.aAvgScore : seedA!.csat,
    latency: t.metrics.aCount > 0 ? t.metrics.aAvgLatencyMs : seedA!.latency,
    tokens: t.metrics.aCount > 0 ? t.metrics.aAvgTokens : seedA!.tokens,
    handoff: t.metrics.aCount > 0 ? t.metrics.aHandoffRate : seedA!.handoff,
  };
  const bBase = {
    passRate: t.metrics.bCount > 0 ? t.metrics.bPassRate : seedB!.passRate,
    csat: t.metrics.bCount > 0 ? t.metrics.bAvgScore : seedB!.csat,
    latency: t.metrics.bCount > 0 ? t.metrics.bAvgLatencyMs : seedB!.latency,
    tokens: t.metrics.bCount > 0 ? t.metrics.bAvgTokens : seedB!.tokens,
    handoff: t.metrics.bCount > 0 ? t.metrics.bHandoffRate : seedB!.handoff,
  };

  // 在线追加样本（使用 Welford 风格的递推平均）
  let aPass = Math.round(aBase.passRate * t.metrics.aCount);
  let aScoreSum = aBase.csat * t.metrics.aCount;
  let aLatSum = aBase.latency * t.metrics.aCount;
  let aTokSum = aBase.tokens * t.metrics.aCount;
  let aHand = Math.round(aBase.handoff * t.metrics.aCount);
  let aN = t.metrics.aCount;

  let bPass = Math.round(bBase.passRate * t.metrics.bCount);
  let bScoreSum = bBase.csat * t.metrics.bCount;
  let bLatSum = bBase.latency * t.metrics.bCount;
  let bTokSum = bBase.tokens * t.metrics.bCount;
  let bHand = Math.round(bBase.handoff * t.metrics.bCount);
  let bN = t.metrics.bCount;

  const half = Math.floor(samples / 2);
  // 追加到 A
  for (let i = 0; i < half; i++) {
    aN++;
    if (bernoulli(aBase.passRate)) aPass++;
    aScoreSum += normal(aBase.csat, 0.6, 1, 5);
    aLatSum += normal(aBase.latency, 180, 200, 2500);
    aTokSum += normal(aBase.tokens, 60, 120, 900);
    if (bernoulli(aBase.handoff)) aHand++;
  }
  // 追加到 B
  for (let i = 0; i < samples - half; i++) {
    bN++;
    if (bernoulli(bBase.passRate)) bPass++;
    bScoreSum += normal(bBase.csat, 0.6, 1, 5);
    bLatSum += normal(bBase.latency, 180, 200, 2500);
    bTokSum += normal(bBase.tokens, 60, 120, 900);
    if (bernoulli(bBase.handoff)) bHand++;
  }

  t.metrics.aCount = aN;
  t.metrics.bCount = bN;
  t.metrics.aPassRate = +(aPass / aN).toFixed(3);
  t.metrics.bPassRate = +(bPass / bN).toFixed(3);
  t.metrics.aAvgScore = +(aScoreSum / aN).toFixed(2);
  t.metrics.bAvgScore = +(bScoreSum / bN).toFixed(2);
  t.metrics.aAvgLatencyMs = Math.round(aLatSum / aN);
  t.metrics.bAvgLatencyMs = Math.round(bLatSum / bN);
  t.metrics.aAvgTokens = Math.round(aTokSum / aN);
  t.metrics.bAvgTokens = Math.round(bTokSum / bN);
  t.metrics.aHandoffRate = +(aHand / aN).toFixed(3);
  t.metrics.bHandoffRate = +(bHand / bN).toFixed(3);

  // 综合置信度（通过率 + CSAT 等权）
  const passConf = twoPropConf(aPass, aN, bPass, bN);
  // CSAT：用 Welch t 检验的简化（同方差假设，样本量够大时近似正态）
  const aVar = 0.36, bVar = 0.36; // 假设评分方差 ~0.6^2
  const csatZ = (bBase.csat - aBase.csat) / Math.max(1e-9, Math.sqrt(aVar / aN + bVar / bN));
  const t_c = 1 / (1 + 0.2316419 * Math.abs(csatZ));
  const d_c = 0.3989422804 * Math.exp(-(csatZ * csatZ) / 2);
  const c_c = 1 - d_c * t_c * (0.3193815 + t_c * (-0.3565638 + t_c * (1.781478 + t_c * (-1.821256 + t_c * 1.330274))));
  const csatConf = csatZ > 0 ? c_c : 1 - c_c;
  t.confidence = +(0.5 * passConf + 0.5 * csatConf).toFixed(3);

  // 自动结判定：样本量≥80 且置信度≥95% 时提示可宣布胜负（不自动结束，保留人工确认）
  if (aN + bN >= 80 && t.confidence >= 0.95 && !t.winner) {
    const bBetter = t.metrics.bPassRate > t.metrics.aPassRate && t.metrics.bAvgScore > t.metrics.aAvgScore - 0.1;
    t._autoHint = bBetter ? "B 组显著领先，可宣布 B 胜出" : "A 组显著领先，可保留 A 为基线";
  }

  await atomicWriteText(AB_FILE, JSON.stringify(data, null, 2));
  return NextResponse.json({ ok: true, test: t, added: samples });
}
