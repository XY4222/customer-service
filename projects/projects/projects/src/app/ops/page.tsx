"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface RunRecord {
  id?: string;
  runId: string;
  question?: string;
  userQuestion?: string;
  finalReply?: string;
  riskPassed?: boolean;
  riskResult?: { passed: boolean; issues?: Array<unknown> };
  status: string;
  durationMs: number;
  source: string;
  isBadCase?: boolean;
  startedAt: string;
  finishedAt?: string;
  steps: any[];
  handoffToHuman?: boolean;
  handoffReason?: string;
  needsClarification?: boolean;
  clarificationQuestion?: string | null;
  risk?: { passed?: boolean; riskLevel?: string; issues?: Array<unknown> };
  riskLevel?: string;
  ratings?: Array<{ score: number }>;
}

interface SkillMeta {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  model?: string;
  temperature?: number;
  updatedAt?: string;
}

interface SkillVersionMeta {
  vId: string;
  id?: string;
  skillId: string;
  createdAt: string;
  source: "manual" | "patch" | "rollback" | "initial" | "seed";
  reason?: string;
  message?: string;
  snapshotId?: string;
  systemPrompt?: string;
  body?: string;
}
interface AbTest {
  id: string;
  name: string;
  targetType: "skill" | "planner";
  targetId: string;
  targetName?: string;
  variantA: string;
  variantALabel: string;
  variantB: string;
  variantBLabel: string;
  trafficSplit: number;
  status: "draft" | "running" | "paused" | "completed";
  startedAt: string | null;
  endedAt?: string | null;
  pausedAt?: string | null;
  winner?: "A" | "B" | "tie" | null;
  confidence: number;
  goal: string;
  conclusion?: string;
  pauseReason?: string;
  metrics: {
    aCount: number; bCount: number;
    aPassRate: number; bPassRate: number;
    aAvgTokens: number; bAvgTokens: number;
    aAvgLatencyMs: number; bAvgLatencyMs: number;
    aAvgScore: number; bAvgScore: number;
    aHandoffRate?: number; bHandoffRate?: number;
  };
}
interface EvalCase {
  id: string;
  name: string;
  question: string;
  scenario?: string;
  expectedKeywords?: string[];
  expectedPrice?: number | null;
  expectRiskPassed?: boolean;
  requiredCapabilities?: string[];
  forbiddenCapabilities?: string[];
  enabled: boolean;
}

interface EvalBatch {
  id: string;
  name?: string;
  baselineBatchId?: string;
  createdAt: string;
  status: "running" | "done" | "error";
  total: number;
  passed: number;
  failed: number;
  review: number;
  errors: number;
  passRate?: number;
  caseIds?: string[];
  conditionSnapshot?: {
    capturedAt: string;
    caseSetHash: string;
    evaluatorVersion: string;
    evaluatorHash: string;
    provider: string;
    model: string;
    paramsHash: string;
    plannerHash: string;
    skillHashes: Record<string, string>;
    toolHash: string;
    businessDataHash: string;
  };
  caseResults: Record<string, {
    status: "PASS" | "FAIL" | "REVIEW" | "ERROR";
    passed: boolean;
    reason?: string;
    finalReply?: string;
    priceAccurate?: boolean;
    durationMs: number;
    runId?: string;
    error?: string;
    riskPassed?: boolean;
    evidence?: {
      keywordChecks?: Array<{ group: string; matched?: string; passed: boolean }>;
      keywordMisses?: string[];
      expectedPrice?: number | null;
      mentionedPrice?: number | null;
      riskIssues?: string[];
      forbiddenHits?: string[];
    };
  }>;
}

interface Rating {
  id: string;
  runId: string;
  score: number;
  question: string;
  reply: string;
  comment: string;
  createdAt: string;
}

interface Annotation {
  id: string;
  question: string;
  reply: string;
  expectedReply?: string;
  intent?: string;
  riskLevel?: string;
  status: "pending" | "annotated" | "approved" | "rejected";
  scores: { correctness: number; relevance: number; completeness: number; safety: number; tone: number; overall: number };
  qualityTags?: string[];
  requiredCapabilities?: string[];
  expectedFacts?: string[];
  forbiddenPhrases?: string[];
  annotatorNote?: string;
  reviewNote?: string;
  note?: string;
  runId?: string;
  sourceRunId?: string;
  caseId?: string;
  source?: string;
  createdAt: string;
}

/** 评分趋势迷你图：纯 SVG，无需外部图表库 */
function RatingSparkline({ ratings }: { ratings: Rating[] }) {
  const W = 600;
  const H = 120;
  const pad = 24;
  const n = ratings.length;
  if (n === 0) return null;
  const normRatings = ratings
    .map((r, idx) => {
      const anyR = r as unknown as { score?: number; rating?: number; id?: string };
      const raw = anyR.score ?? anyR.rating;
      return { ...r, _i: idx, _score: Number(raw), _id: anyR.id ?? `rt-${idx}` };
    })
    .filter((r) => Number.isFinite(r._score) && r._score >= 1 && r._score <= 5);
  const nn = normRatings.length;
  if (nn === 0) return null;
  const xStep = (W - pad * 2) / Math.max(nn - 1, 1);
  const points = normRatings.map((r, i) => {
    const x = pad + i * xStep;
    const y = H - pad - ((r._score - 1) / 4) * (H - pad * 2);
    return { x, y, score: r._score, key: String(r._id) };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L${points[points.length - 1].x.toFixed(1)},${H - pad} L${pad},${H - pad} Z`;
  const avg = normRatings.reduce((s, r) => s + r._score, 0) / nn;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>近 {nn} 条平均 <b className="text-foreground">{avg.toFixed(2)}</b> 分</span>
        <span>最新 <b className="text-foreground">{normRatings[normRatings.length - 1]._score}</b> 分</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28">
        <defs>
          <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.646 0.222 41.116)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="oklch(0.646 0.222 41.116)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[1, 2, 3, 4, 5].map((s) => {
          const y = H - pad - ((s - 1) / 4) * (H - pad * 2);
          return (
            <g key={s}>
              <line x1={pad} x2={W - pad} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.08} />
              <text x={pad - 6} y={y + 3} textAnchor="end" fontSize="10" fill="currentColor" opacity={0.4}>
                {s}
              </text>
            </g>
          );
        })}
        <path d={areaPath} fill="url(#sparkFill)" />
        <path d={path} fill="none" stroke="oklch(0.646 0.222 41.116)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, idx) => (
          <circle key={p.key ?? `pt-${idx}`} cx={p.x} cy={p.y} r={p.score <= 2 ? 3.5 : 2.5} fill={p.score <= 2 ? "oklch(0.60 0.22 25)" : "oklch(0.646 0.222 41.116)"} />
        ))}
      </svg>
    </div>
  );
}


function fmtTime(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

/** 简单行级 diff：基于 LCS 计算两个文本的逐行差异，返回 [aLines, bLines] 带状态的标记行 */
type DiffLine = { text: string; tag: "equal" | "add" | "del" };
function lineDiff(a: string, b: string): { aLines: DiffLine[]; bLines: DiffLine[]; stats: { add: number; del: number } } {
  const aArr = (a || "").split(/\r?\n/);
  const bArr = (b || "").split(/\r?\n/);
  const n = aArr.length;
  const m = bArr.length;
  // LCS DP
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aArr[i] === bArr[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const aLines: DiffLine[] = [];
  const bLines: DiffLine[] = [];
  let add = 0;
  let del = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aArr[i] === bArr[j]) {
      aLines.push({ text: aArr[i], tag: "equal" });
      bLines.push({ text: bArr[j], tag: "equal" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      aLines.push({ text: aArr[i], tag: "del" });
      del++;
      i++;
    } else {
      bLines.push({ text: bArr[j], tag: "add" });
      add++;
      j++;
    }
  }
  while (i < n) {
    aLines.push({ text: aArr[i], tag: "del" });
    del++;
    i++;
  }
  while (j < m) {
    bLines.push({ text: bArr[j], tag: "add" });
    add++;
    j++;
  }
  return { aLines, bLines, stats: { add, del } };
}

export default function OpsPage() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [batches, setBatches] = useState<EvalBatch[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [versionMap, setVersionMap] = useState<Record<string, SkillVersionMeta[]>>({});
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [abTests, setAbTests] = useState<AbTest[]>([]);
  const [loadingAb, setLoadingAb] = useState(false);
  const [runningBatch, setRunningBatch] = useState(false);
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [batchName, setBatchName] = useState("baseline-v1");
  const [compareA, setCompareA] = useState<string>("");
  // eval case 单条测试/编辑/新增
  const [testingCaseId, setTestingCaseId] = useState<string | null>(null);
  const [testingCaseResult, setTestingCaseResult] = useState<string>("");
  const [testingCaseTrace, setTestingCaseTrace] = useState<any[] | null>(null);
  const [testingCaseQuestion, setTestingCaseQuestion] = useState<string>("");
  const [showCaseTrace, setShowCaseTrace] = useState(false);
  const [editingCase, setEditingCase] = useState<EvalCase | null>(null);
  const [editingCaseNew, setEditingCaseNew] = useState<boolean>(false);
  const [runningSingle, setRunningSingle] = useState(false);
  const [compareB, setCompareB] = useState<string>("");
  // 版本查看/对比/快照
  const [versionPreview, setVersionPreview] = useState<{ skillId: string; skillName: string; vId: string; body: string; message?: string } | null>(null);
  const [versionCompare, setVersionCompare] = useState<{ skillId: string; skillName: string; a: string; b: string; aId: string; bId: string } | null>(null);
  const [comparing, setComparing] = useState<string | null>(null);
  const versionCompareDiff = useMemo(
    () => (versionCompare ? lineDiff(versionCompare.a, versionCompare.b) : null),
    [versionCompare],
  );
  const [snapshotMsg, setSnapshotMsg] = useState<Record<string, string>>({});
  const [snapshotting, setSnapshotting] = useState<string | null>(null);
  const [versionTesting, setVersionTesting] = useState<string | null>(null);
  const [versionTestResult, setVersionTestResult] = useState<{ vId: string; output: string } | null>(null);
  // A/B 测试 新建/详情
  const [abCreateOpen, setAbCreateOpen] = useState(false);
  const [abDetailTest, setAbDetailTest] = useState<AbTest | null>(null);
  const [abSaving, setAbSaving] = useState(false);
  const [abSimulating, setAbSimulating] = useState<string | null>(null);
  const [abForm, setAbForm] = useState({
    name: "",
    targetType: "skill" as "skill" | "planner",
    targetId: "",
    targetName: "",
    variantALabel: "A：当前版本（基线）",
    variantBLabel: "B：新版本（实验）",
    trafficSplit: 50,
    goal: "",
  });

  const handleSnapshot = async (skillId: string) => {
    const msg = snapshotMsg[skillId]?.trim() || "";
    setSnapshotting(skillId);
    try {
      const r = await fetch(`/api/skills/${skillId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg || "运营后台手动保存快照" }),
      });
      if (r.ok) {
        const j = await r.json();
        // POST 返回 {version}；PUT/GET list 返回 {versions}
        const newVersions = j.versions || (j.version ? [j.version, ...(versionMap[skillId] || [])] : (versionMap[skillId] || []));
        setVersionMap((m: Record<string, SkillVersionMeta[]>) => ({ ...m, [skillId]: newVersions }));
        setSnapshotMsg((m: Record<string, string>) => ({ ...m, [skillId]: "" }));
        toast.success("已保存快照");
      } else {
        toast.error("保存失败");
      }
    } finally {
      setSnapshotting(null);
    }
  };

  const fetchVersionBody = async (skillId: string, vId: string) => {
    const r = await fetch(`/api/skills/${skillId}/versions/${vId}`);
    if (!r.ok) throw new Error("fetch version failed");
    return (await r.json()).version?.body || "";
  };

  const handlePreview = async (skillId: string, skillName: string, vId: string, message?: string) => {
    try {
      const body = await fetchVersionBody(skillId, vId);
      setVersionPreview({ skillId, skillName, vId, body, message });
    } catch {
      toast.error("读取版本内容失败");
    }
  };

  const handleCompare = async (skillId: string, skillName: string, vId: string) => {
    if (comparing === vId) return;
    setComparing(vId);
    toast.loading("正在加载版本内容...");
    try {
      // "当前版本"取 /api/skills/:id 返回的实时 SKILL.md content，
      // 而不是版本快照列表中的第一项（快照可能滞后于编辑器最新修改）。
      const [curRes, bodyB] = await Promise.all([
        fetch(`/api/skills/${skillId}`).then((r) => r.json()),
        fetchVersionBody(skillId, vId),
      ]);
      const bodyA = curRes?.content || curRes?.skill?.body || "";
      if (!bodyA || !bodyB) {
        toast.error("版本内容为空，请稍后重试");
        return;
      }
      setVersionCompare({
        skillId,
        skillName,
        a: bodyA,
        b: bodyB,
        aId: "current", // 使用固定标识代表"工作区当前内容"
        bId: vId,
      });
    } catch (e: any) {
      console.error("compare failed", e);
      toast.error("读取版本内容失败: " + (e?.message || "未知错误"));
    } finally {
      setComparing(null);
    }
  };

  const handleTestVersion = async (skillId: string, vId: string) => {
    setVersionTesting(vId);
    setVersionTestResult(null);
    try {
      const sampleInput: Record<string, any> = {
        "need-extraction": { question: "我想买点办公室零食，预算30元左右，麻辣口味" },
        "response-generator": { question: "推荐一款办公室零食", user_needs: { category: "坚果", budget: 30 } },
        "risk-check": { question: "推荐一款零食", reply: "这款零食绝对是最好吃的" },
      };
      const input = sampleInput[skillId] || { question: "测试问题" };
      const r = await fetch(`/api/skills/${skillId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const j = await r.json();
      setVersionTestResult({ vId, output: JSON.stringify(j.output || j.error || j, null, 2) });
    } catch (e: any) {
      setVersionTestResult({ vId, output: "测试失败: " + e.message });
    } finally {
      setVersionTesting(null);
    }
  };

  const handleRollback = async (skillId: string, skillName: string, vId: string) => {
    if (!window.confirm(`确定将 "${skillName}" 回滚到版本 ${vId.slice(0, 8)}？\n回滚前会自动保存当前版本为回滚快照。`)) return;
    const r = await fetch(`/api/skills/${skillId}/versions/${vId}`, { method: "PUT" });
    if (r.ok) {
      const j = await r.json();
      setVersionMap((m: Record<string, SkillVersionMeta[]>) => ({ ...m, [skillId]: j.versions || [] }));
      toast.success(`已回滚到 ${vId.slice(0, 8)}`);
    } else {
      toast.error("回滚失败");
    }
  };

  const batchSummary = (b: EvalBatch | undefined | null) => {
    if (!b) return null;
    const passRate = b.total > 0 ? Math.round((b.passed / b.total) * 100) : 0;
    const avgDuration = b.total > 0 && b.caseResults
      ? Math.round(
          Object.values(b.caseResults).reduce((acc, r) => acc + (r.durationMs ?? 0), 0) / b.total
        )
      : 0;
    const riskFailed = b.caseResults
      ? Object.values(b.caseResults).filter((r) => r.reason?.includes("风控")).length
      : 0;
    return { passRate, avgDuration, riskFailed };
  };
  const compareBatches = (a: EvalBatch | undefined, b: EvalBatch | undefined) => {
    if (!a || !b) return null;
    const sa = a.conditionSnapshot;
    const sb = b.conditionSnapshot;
    if (!sa || !sb) return { comparable: false, reasons: ["旧批次缺少运行条件快照"], fixed: [], regressions: [], changedSkills: [] };
    const reasons: string[] = [];
    const checks: Array<[string, unknown, unknown]> = [
      ["用例快照", sa.caseSetHash, sb.caseSetHash],
      ["评分器", sa.evaluatorHash, sb.evaluatorHash],
      ["Provider", sa.provider, sb.provider],
      ["模型", sa.model, sb.model],
      ["模型参数", sa.paramsHash, sb.paramsHash],
      ["Planner", sa.plannerHash, sb.plannerHash],
      ["Tools", sa.toolHash, sb.toolHash],
      ["业务数据", sa.businessDataHash, sb.businessDataHash],
    ];
    checks.forEach(([label, av, bv]) => { if (av !== bv) reasons.push(`${label}不同`); });
    const skillIds = new Set([...Object.keys(sa.skillHashes || {}), ...Object.keys(sb.skillHashes || {})]);
    const changedSkills = [...skillIds].filter((id) => sa.skillHashes?.[id] !== sb.skillHashes?.[id]);
    if (changedSkills.length > 1) reasons.push(`同时修改了多个 Skill：${changedSkills.join("、")}`);
    const fixed: string[] = [];
    const regressions: string[] = [];
    if (reasons.length === 0) {
      for (const id of a.caseIds || []) {
        const before = a.caseResults?.[id]?.status;
        const after = b.caseResults?.[id]?.status;
        if (before !== "PASS" && after === "PASS") fixed.push(id);
        if (before === "PASS" && after && after !== "PASS") regressions.push(id);
      }
    }
    return { comparable: reasons.length === 0, reasons, fixed, regressions, changedSkills };
  };
  const summaryA = batchSummary(batches.find((b) => b.id === compareA));
  const summaryB = batchSummary(batches.find((b) => b.id === compareB));
  const comparison = compareBatches(batches.find((b) => b.id === compareA), batches.find((b) => b.id === compareB));
  const [batchStatus, setBatchStatus] = useState<EvalBatch | null>(null);
  const [judgePrompt, setJudgePrompt] = useState("你是客服回复质量评测助手。判断回复是否满足关键词要求、价格是否准确、是否通过风控。");
  const [pollingId, setPollingId] = useState<string | null>(null);
  const [noteDlg, setNoteDlg] = useState<{ id: string; question: string } | null>(null);
  const [patchLoading, setPatchLoading] = useState<string | null>(null);
  const [patchPreview, setPatchPreview] = useState<null | {
    skillId: string;
    skillName: string;
    clusterName: string;
    rationale: string;
    segments: Array<{ kind: string; anchor?: string; oldText?: string; newText: string; reason: string }>;
    originalBody: string;
    patchedBodyPreview: string;
    sampleRuns: Array<{ runId: string; question: string; reply?: string; issue?: string }>;
  }>(null);
  const [patchApplying, setPatchApplying] = useState(false);

  // 生成 Prompt 补丁
  const generatePatch = async (clusterName: string) => {
    setPatchLoading(clusterName);
    try {
      const resp = await fetch("/api/improvements/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusterName }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "生成失败");
      setPatchPreview(data);
    } catch (e: any) {
      toast.error(`生成补丁失败：${e.message}`);
    } finally {
      setPatchLoading(null);
    }
  };

  const applyPatch = async () => {
    if (!patchPreview) return;
    setPatchApplying(true);
    try {
      const resp = await fetch("/api/improvements/apply-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId: patchPreview.skillId,
          segments: patchPreview.segments,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "应用失败");
      toast.success(`已应用 ${data.applied} 处修改到 ${patchPreview.skillName}`);
      setPatchPreview(null);
    } catch (e: any) {
      toast.error(`应用失败：${e.message}`);
    } finally {
      setPatchApplying(false);
    }
  };

  const handleSimulateAb = async (testId: string, samples = 50) => {
    setAbSimulating(testId);
    try {
      const resp = await fetch("/api/ab-tests/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: testId, samples }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "模拟失败");
      toast.success(`已注入 ${samples} 个模拟样本`);
      // 如果详情 Dialog 打开着同步更新
      if (abDetailTest?.id === testId) setAbDetailTest(data.test);
      loadAbTests();
    } catch (e: any) {
      toast.error(`模拟流量失败：${e.message}`);
    } finally {
      setAbSimulating(null);
    }
  };

  // 简易 diff：按行对比 original vs patched
  const renderDiff = (a: string, b: string) => {
    const al = a.split("\n");
    const bl = b.split("\n");
    const out: Array<{ t: "add" | "del" | "ctx"; text: string }> = [];
    let i = 0;
    let j = 0;
    while (i < al.length || j < bl.length) {
      if (i < al.length && j < bl.length && al[i] === bl[j]) {
        out.push({ t: "ctx", text: al[i] });
        i++; j++;
      } else {
        let foundI = -1;
        let foundJ = -1;
        for (let k = 1; k < 8; k++) {
          if (i + k < al.length) {
            const jj = bl.indexOf(al[i + k], j);
            if (jj >= 0 && jj - j < 8) { foundI = i + k; foundJ = jj; break; }
          }
          if (j + k < bl.length) {
            const ii = al.indexOf(bl[j + k], i);
            if (ii >= 0 && ii - i < 8) { foundI = ii; foundJ = j + k; break; }
          }
        }
        if (foundI < 0) {
          while (i < al.length) out.push({ t: "del", text: al[i++] });
          while (j < bl.length) out.push({ t: "add", text: bl[j++] });
        } else {
          while (i < foundI) out.push({ t: "del", text: al[i++] });
          while (j < foundJ) out.push({ t: "add", text: bl[j++] });
        }
      }
    }
    return (
      <pre className="text-[11px] font-mono bg-muted/40 rounded-lg p-3 overflow-auto max-h-80 whitespace-pre">
        {out.map((l, idx) => (
          <div
            key={idx}
            className={
              l.t === "add"
                ? "bg-success/15 text-success"
                : l.t === "del"
                ? "bg-danger/15 text-danger"
                : "text-muted-foreground"
            }
          >
            {l.t === "add" ? "+ " : l.t === "del" ? "- " : "  "}
            {l.text}
          </div>
        ))}
      </pre>
    );
  };

  // 重跑 Dialog
  const [replayQuestion, setReplayQuestion] = useState<string>("");
  const [replaying, setReplaying] = useState(false);
  const handleReplay = async () => {
    if (!replayQuestion) return;
    setReplaying(true);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({question: replayQuestion, source: "ops-replay"}),
      });
      if (res.ok) { alert("已发起重跑"); setReplayQuestion(""); void load(); }
      else alert("重跑失败");
    } finally { setReplaying(false); }
  };
  const handleRejectWithNote = async () => {
    if (!reviewingAnnotation) return;
    await updateAnnotationStatus(reviewingAnnotation.id, "rejected", reviewNote);
    setReviewingAnnotation(null); setReviewNote("");
  };
  const load = async () => {
    const [runsResponse, evalResponse, ratingsResponse, annotationsResponse] = await Promise.all([
      fetch("/api/runs?limit=100").then((r) => r.json()),
      fetch("/api/eval").then((r) => r.json()),
      fetch("/api/ratings").then((r) => r.json()),
      fetch("/api/annotations").then((r) => r.json()),
    ]);
    setRuns(runsResponse.runs || []);
    const loadedCases: EvalCase[] = evalResponse.cases || [];
    setCases(loadedCases);
    setSelectedCaseIds((current) => {
      if (current.length) return current.filter((id) => loadedCases.some((item) => item.id === id));
      const preferred = ["case_budget_spicy", "case_exaggerated_claim_trap", "case_illegal_winning_claim"]
        .filter((id) => loadedCases.some((item) => item.id === id));
      return preferred.length === 3 ? preferred : loadedCases.filter((item) => item.enabled).slice(0, 3).map((item) => item.id);
    });
    setBatches(evalResponse.batches || []);
    setRatings(ratingsResponse.ratings || []);
    setAnnotations(annotationsResponse.annotations || []);
  };

  const [reviewingAnnotation, setReviewingAnnotation] = useState<Annotation | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [replayRunId, setReplayRunId] = useState<string | null>(null);

  async function updateAnnotationStatus(id: string, status: "approved" | "rejected", note?: string) {
    const res = await fetch(`/api/annotations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, reviewNote: note || "" }),
    });
    if (res.ok) {
      alert(status === "approved" ? "已标记通过" : "已驳回该标注");
      load();
    } else {
      alert("操作失败");
    }
  }

  function startReplay(question: string) {
    // 跳转到 Agent 控制台并带上 question 参数，由控制台监听并自动发送
    window.location.href = `/?ask=${encodeURIComponent(question)}`;
  }

  useEffect(() => {
    load();
    loadSkillVersions();
    loadAbTests();
  }, []);

  async function loadAbTests() {
    try {
      setLoadingAb(true);
      const j = await (await fetch("/api/ab-tests")).json();
      setAbTests(j.tests || []);
    } finally {
      setLoadingAb(false);
    }
  }

  async function loadSkillVersions() {
    try {
      setLoadingVersions(true);
      const sks = await (await fetch("/api/skills")).json();
      const skillList: SkillMeta[] = sks.skills || [];
      setSkills(skillList);
      const map: Record<string, SkillVersionMeta[]> = {};
      await Promise.all(skillList.map(async (s) => {
        const r = await fetch(`/api/skills/${s.id}/versions`);
        if (r.ok) {
          const j = await r.json();
          map[s.id] = j.versions || [];
        }
      }));
      setVersionMap(map);
    } catch (e) {
      console.error("load versions failed", e);
    } finally {
      setLoadingVersions(false);
    }
  }

  useEffect(() => {
    if (!pollingId) return;
    let cancelled = false;
    const t = setInterval(async () => {
      try {
        const resp = await fetch(`/api/eval/batch/${pollingId}`);
        if (resp.status === 404) {
          clearInterval(t);
          if (!cancelled) {
            setPollingId(null);
            setRunningBatch(false);
            toast.error("评测批次不存在，已停止轮询");
            load();
          }
          return;
        }
        const j = await resp.json();
        const b = j.batch;
        if (!b) {
          clearInterval(t);
          if (!cancelled) {
            setPollingId(null);
            setRunningBatch(false);
            toast.error("评测批次响应异常，已停止轮询");
            load();
          }
          return;
        }
        setBatchStatus(b);
        if (b.status !== "running") {
          clearInterval(t);
          if (!cancelled) {
            setPollingId(null);
            setRunningBatch(false);
            load();
            toast.success("评测完成");
          }
        }
      } catch (err) {
        // keep polling on transient errors
        console.warn("[eval poll] error:", err);
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [pollingId]);

  const totalRuns = runs.length;
  const riskPassedOf = (r: RunRecord) => r.riskResult?.passed !== false;
  const successRuns = runs.filter((r) => r.status === "success" && riskPassedOf(r)).length;
  const failRuns = runs.filter((r) => r.status === "failed" || r.status === "error" || (r.status === "risk_blocked") || !riskPassedOf(r)).length;
  const avgDuration = totalRuns > 0 ? Math.round(runs.reduce((s, r) => s + r.durationMs, 0) / totalRuns) : 0;
  const badCases = runs.filter((r) => r.isBadCase || ((r as any).ratings || []).some((x: any) => x.score === 1));
  const humanRate = runs.length > 0 ? Math.round((runs.filter((r) => (r as any).handoffToHuman || (r.finalReply || "").includes("人工")).length / runs.length) * 100) : 0;
  const failSteps = runs.flatMap((r) => (r.steps || [])
    .filter((s) => s.status === "error" || s.status === "degraded")
    .map((s) => ({ ...s, __runId: r.runId || r.id, __question: r.userQuestion || r.question }))
  );
  const riskLevels: Record<string, number> = {};
  runs.forEach((r) => {
    const lvl = r.riskResult?.passed === false ? "high" : r.riskResult?.issues?.length ? "medium" : "low";
    riskLevels[lvl] = (riskLevels[lvl] || 0) + 1;
  });

  const runEval = async (baselineBatchId?: string) => {
    if (!selectedCaseIds.length) {
      toast.error("请至少选择一条评测用例");
      return;
    }
    setRunningBatch(true);
    const response = await fetch("/api/eval/batch/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseIds: selectedCaseIds, name: batchName, baselineBatchId }),
    });
    const res = await response.json();
    if (!response.ok) {
      setRunningBatch(false);
      toast.error(res.error?.message || "创建批次失败");
      return;
    }
    setPollingId(res.batchId);
    setBatchStatus(null);
    toast.info(`开始评测 ${res.name}，共 ${res.total} 条`);
  };

  const toggleCase = async (id: string, enabled: boolean) => {
    await fetch(`/api/eval/cases/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    load();
  };

  const runSingleCase = async (c: EvalCase) => {
    setTestingCaseId(c.id);
    setTestingCaseResult("正在调用真实 Agent 执行该用例...");
    setTestingCaseTrace(null);
    setTestingCaseQuestion(c.question);
    setRunningSingle(true);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
        body: JSON.stringify({ question: c.question, source: "eval", conversationId: `eval_single_${c.id}_${Date.now()}` }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      // Parse SSE: extract step_output/final_reply/error/done events; collect full trace
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalPayload: Record<string, unknown> | null = null;
      let replyText = "";
      let riskData: { passed?: boolean; issues?: unknown[] } | undefined;
      let errorText = "";
      const trace: Array<{ type: string; ref?: string; refName?: string; stepType?: string; output?: unknown; durationMs?: number; reply?: string; risk?: unknown; message?: string; status?: string }> = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() || "";
        for (const chunk of chunks) {
          let eventName = "";
          let dataStr = "";
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }
          if (!eventName || !dataStr) continue;
          try {
            const payload = JSON.parse(dataStr);
            if (eventName === "step_output") {
              trace.push({ type: "step", ref: payload.ref, refName: payload.refName, stepType: payload.type, output: payload.output, durationMs: payload.durationMs, status: payload.status });
            } else if (eventName === "step_error") {
              // 记录步骤错误，标记为 error 状态
              const existingStep = trace.find((t) => t.type === "step" && t.ref === payload.ref);
              if (existingStep) {
                existingStep.status = "error";
                existingStep.message = payload.error;
              } else {
                trace.push({ type: "step", ref: payload.ref, stepType: payload.type, output: null, status: "error", message: payload.error });
              }
            } else if (eventName === "final_reply") {
              replyText = (payload.reply as string) || (payload.finalReply as string) || "";
              riskData = payload.risk as { passed?: boolean; issues?: unknown[] } | undefined;
              trace.push({ type: "final", reply: replyText, risk: riskData });
            } else if (eventName === "error") {
              errorText = (payload.message as string) || "";
              trace.push({ type: "error", message: errorText });
            } else if (eventName === "done") {
              finalPayload = payload as Record<string, unknown>;
            }
          } catch { /* ignore partial */ }
        }
      }
      if (!finalPayload && !replyText) {
        throw new Error("未收到最终结果，可能 Agent 执行中断");
      }
      const rp = replyText || "(无回复)";
      const risk = riskData;
      const status = (finalPayload?.status as string) || (errorText ? "error" : "success");
      const toolsUsed = (finalPayload?.toolsUsed as string[]) || [];

      const checks: string[] = [];
      if (c.expectedKeywords?.length) {
        const hit = c.expectedKeywords.filter((k) => {
          const variants = k.split("|").map((x) => x.trim()).filter(Boolean);
          return variants.some((v) => rp.includes(v));
        }).length;
        checks.push(`关键词命中：${hit}/${c.expectedKeywords.length}`);
      }
      if (c.expectRiskPassed === false) {
        checks.push(risk?.passed === false ? "风控拦截：✓ 已正确拦截" : `风控拦截：✗ 应被拦截但通过了${risk?.passed === true ? "（风控通过了）" : ""}`);
      } else if (c.expectRiskPassed === true) {
        checks.push(risk?.passed ? "风控通过：✓" : "风控通过：✗ 被错误拦截");
      }
      if (c.expectedPrice != null) {
        const m = rp.match(/(\d+(\.\d+)?)\s*元/);
        const mentioned = m ? m[1] : null;
        checks.push(mentioned ? `价格提及：${mentioned} 元（期望 ≈${c.expectedPrice} 元）` : "价格提及：回复中未找到价格");
      }
      checks.push(`执行状态：${status}，共 ${trace.filter((t) => t.type === "step").length} 步`);
      if (toolsUsed.length) checks.push(`调用工具：${toolsUsed.join("、")}`);
      if (errorText) checks.push(`错误信息：${errorText}`);

      setTestingCaseResult(`【回复】\n${rp}\n\n【快速检查】\n${checks.join("\n")}`);
      setTestingCaseTrace(trace);
    } catch (e: unknown) {
      setTestingCaseResult("执行失败：" + (e instanceof Error ? e.message : String(e)));
      setTestingCaseTrace([]);
    } finally {
      setRunningSingle(false);
    }
  };

  const saveEditingCase = async () => {
    if (!editingCase) return;
    const body: Record<string, unknown> = {
      name: editingCase.name,
      question: editingCase.question,
      scenario: editingCase.scenario,
      expectedKeywords: editingCase.expectedKeywords,
      expectedPrice: editingCase.expectedPrice,
      expectRiskPassed: editingCase.expectRiskPassed,
      requiredCapabilities: editingCase.requiredCapabilities,
      forbiddenCapabilities: editingCase.forbiddenCapabilities,
    };
    const url = editingCaseNew ? "/api/eval/cases" : `/api/eval/cases/${editingCase.id}`;
    const method = editingCaseNew ? "POST" : "PATCH";
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) {
      toast.success(editingCaseNew ? "已新增评测用例" : "已保存");
      setEditingCase(null);
      setEditingCaseNew(false);
      load();
    } else {
      toast.error("保存失败");
    }
  };

  const deleteCase = async (id: string) => {
    if (!confirm("确定删除该评测用例？删除后无法恢复。")) return;
    const r = await fetch(`/api/eval/cases/${id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("已删除");
      load();
    } else {
      toast.error("删除失败");
    }
  };

  const duplicateCase = (c: EvalCase) => {
    setEditingCase({ ...c, id: "", name: c.name + "（副本）", enabled: true });
    setEditingCaseNew(true);
  };

  const latestBatch = batchStatus || batches[0] || null;
  const lowScoreRuns = runs.filter((r) => {
    const rs = (r as any).ratings || [];
    return rs.some((x: any) => x.score <= 2);
  });

  // Bad Case 聚类：按风险/失败/低分模式聚合
  const badCaseClusters = (() => {
    const map: Record<string, { count: number; sampleRunIds: string[]; sampleQs: string[]; hint: string; targetSkill: string }> = {};
    const bump = (key: string, run: typeof runs[number], hint: string, targetSkill: string) => {
      if (!map[key]) map[key] = { count: 0, sampleRunIds: [], sampleQs: [], hint, targetSkill };
      map[key].count++;
      if (map[key].sampleRunIds.length < 3) {
        map[key].sampleRunIds.push(run.runId ?? run.id ?? "");
        map[key].sampleQs.push((run.question || "").slice(0, 28));
      }
    };
    runs.forEach((r) => {
      const runId: string = r.runId ?? r.id ?? "";
      if (!runId) return;
      const risk = r.risk;
      const riskIssues: string[] = Array.isArray(risk?.issues)
        ? (risk.issues as unknown[])
            .map((i: unknown) => (typeof i === "string" ? i : (i as { detail?: string }).detail))
            .filter((x): x is string => typeof x === "string" && x.length > 0)
        : [];
      const riskPassed = r.riskPassed !== false && risk?.passed !== false;
      const steps: Array<{ status?: string; ref?: string; error?: string }> = Array.isArray(r.steps) ? r.steps : [];
      const hasErrStep = steps.some((s) => s.status === "error" || s.status === "failed");
      const degraded = steps.some((s) => s.status === "degraded");
      // 取该 run 对应的评分（从 ratings 里按 runId 关联）
      const runRatings = ratings.filter((rt) => rt.runId === runId || rt.id === runId);
      const worstScore = runRatings.length > 0 ? Math.min(...runRatings.map((x: any) => x.score ?? x.rating ?? 5)) : null;
      const isLowScore = worstScore !== null && worstScore <= 2;
      const isOneStar = worstScore === 1;
      if (riskIssues.some((i) => i.includes("价格") || i.includes("优惠") || i.includes("满减") || i.includes("金额"))) {
        bump("价格/优惠不一致", r, "response-generator 中出现的价格、优惠未使用 calculate_price 输出，或数字错配。建议强制引用 {{price_details}}，禁止编造到手价。", "response-generator");
      } else if (riskIssues.some((i) => i.includes("禁词") || i.includes("承诺") || i.includes("绝对") || i.includes("100%") || i.includes("保证"))) {
        bump("禁词/过度承诺", r, "回复中出现绝对化用语或过度承诺。建议在 risk-check 词表补充「100%/绝对/保证/肯定」等禁词，并在 response-generator 中明确禁止承诺疗效/减肥等。", "risk-check");
      } else if (riskIssues.some((i) => i.includes("新客") || i.includes("新人"))) {
        bump("新人身份判断错误", r, "need-extraction 的 isNewUser 字段识别不准确，导致向老客推送新客优惠。建议补充明确的触发词（首次/第一次/新用户/从来没买过）。", "need-extraction");
      } else if (r.handoffToHuman) {
        bump("触发人工接管", r, "高风险客诉/售后/安全类问题已正确转人工。建议沉淀此类场景的标准回复模板，或检查是否有可自动化分支遗漏。", "script");
      } else if (r.needsClarification) {
        bump("反问澄清未闭环", r, "用户问题模糊触发澄清，但缺少进一步承接话术。建议在 planner 中将「澄清→收集→推荐」闭环，澄清后直接回到 recommendation 步骤。", "planner");
      } else if (hasErrStep) {
        const errRef = steps.find((s) => s.status === "error")?.ref ?? "tool";
        bump(`Tool 调用失败 (${errRef})`, r, "运行轨迹中存在 error/failed 步骤，多为参数格式异常或数据源缺失。建议查看具体 errorMessage 并完善 Tool 入参校验。", errRef);
      } else if (degraded) {
        bump("数据缺失降级", r, "非关键 Tool 走了空结果兜底，导致推荐/价格信息不完整。建议补商品/券/活动数据覆盖度，或在降级时明确告知用户。", "tools");
      } else if (!riskPassed) {
        bump("风控拦截（其他）", r, "风控未通过但未命中以上分类。建议查看 risk.issues 具体内容再决定是否扩词或调阈值。", "risk-check");
      } else if (isOneStar) {
        bump("用户 1 星差评（语气/匹配）", r, "系统判定成功但用户打 1 分，通常是推荐不匹配或语气不佳。建议到会话详情查看实际 Q/A，补充 annotations 标注弱维度后针对性优化。", "response-generator");
      } else if (isLowScore) {
        bump("用户低评分（≤2 分）", r, "用户对回复不满意但未打 1 分，可能是信息不全或答非所问。建议结合评分评论调整 Prompt 的输出结构。", "response-generator");
      } else if (r.isBadCase) {
        bump("已标 Bad Case", r, "人工标为 Bad Case 但未命中其他分类。建议先完成六维质量标注再决定优化方向。", "annotations");
      }
    });
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count);
  })();

  return (
    <div className="max-w-full py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">运营中心</h1>
        <p className="text-muted-foreground text-sm mt-1">
          运行监控 / 质量评测 / 改进闭环
        </p>
      </div>

      <Tabs defaultValue="monitor">
        <TabsList className="grid grid-cols-5 md:grid-cols-9 h-auto gap-1">
          <TabsTrigger value="monitor" className="text-xs px-2">运行监控</TabsTrigger>
          <TabsTrigger value="ratings" className="text-xs px-2">服务评分</TabsTrigger>
          <TabsTrigger value="eval-sets" className="text-xs px-2">评测集</TabsTrigger>
          <TabsTrigger value="eval" className="text-xs px-2">评测中心</TabsTrigger>
          <TabsTrigger value="annotations" className="text-xs px-2">数据标注</TabsTrigger>
          <TabsTrigger value="improvements" className="text-xs px-2">改进建议</TabsTrigger>
          <TabsTrigger value="human-review" className="text-xs px-2">人工评估</TabsTrigger>
          <TabsTrigger value="versions" className="text-xs px-2">版本回滚</TabsTrigger>
          <TabsTrigger value="ab" className="text-xs px-2">Prompt A/B</TabsTrigger>
        </TabsList>

        {/* 运行监控 */}
        <TabsContent value="monitor" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MetricCard label="运行总数" value={totalRuns} />
            <MetricCard label="风控通过率" value={`${totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 0}%`} tone="success" />
            <MetricCard label="平均耗时" value={fmtTime(avgDuration)} />
            <MetricCard label="失败/拒绝" value={failRuns} tone="danger" />
            <MetricCard label="人工接管率" value={`${humanRate}%`} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">最近会话</CardTitle></CardHeader>
              <CardContent>
                {runs.length === 0 ? (
                  <p className="text-muted-foreground text-sm">暂无会话</p>
                ) : (
                  <ul className="space-y-1.5 text-sm max-h-60 overflow-auto">
                    {runs.slice(0, 12).map((r, idx) => (
                      <li key={r.runId ?? `run-${idx}`} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-muted-foreground w-24 truncate">{r.runId}</span>
                        <span className="flex-1 truncate">{(r.question || "").slice(0, 40)}</span>
                        {r.handoffToHuman ? (
                          <Badge variant="secondary" className="text-[10px] bg-blue-100 text-blue-700 border-blue-200">
                            已转人工
                            {(r as any).handoffReason ? `·${String((r as any).handoffReason).slice(0, 6)}` : ""}
                          </Badge>
                        ) : r.status === "success" && r.riskResult?.passed !== false ? (
                          <Badge variant="secondary" className="text-[10px]">成功</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px]">拒绝</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">风险等级分布</CardTitle></CardHeader>
              <CardContent>
                {Object.entries(riskLevels).length === 0 ? (
                  <p className="text-muted-foreground text-sm">暂无数据</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(riskLevels).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-3">
                        <span className="w-16 text-sm capitalize">{k === "low" ? "低" : k === "medium" ? "中" : "高"}</span>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${k === "high" ? "bg-danger" : k === "medium" ? "bg-amber-500" : "bg-success"}`} style={{ width: `${(v / totalRuns) * 100}%` }} />
                        </div>
                        <span className="w-10 text-sm tabular-nums text-right">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-baseline justify-between">
                  <CardTitle className="text-base">失败与降级步骤</CardTitle>
                  <span className="text-xs text-muted-foreground">近 {Math.min(failSteps.length, 10)} / 共 {failSteps.length} 条</span>
                </div>
                <CardDescription>执行异常、超时降级、模型返回格式错误等需关注的步骤。点击可跳转详情。</CardDescription>
              </CardHeader>
              <CardContent>
                {failSteps.length === 0 ? (
                  <div className="text-center py-6 text-sm text-muted-foreground">
                    <div className="text-2xl mb-1">✅</div>
                    暂无失败或降级步骤，系统运行平稳
                  </div>
                ) : (
                  <ul className="space-y-2 text-sm max-h-80 overflow-auto">
                    {failSteps.slice(-10).reverse().map((s: any, i) => {
                      const isDegraded = s.status === "degraded";
                      return (
                        <li key={i} className="rounded-lg border p-2.5 hover:bg-accent/30 transition">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge
                              variant={isDegraded ? "outline" : "destructive"}
                              className={cn("text-[10px]", isDegraded && "border-amber-400 text-amber-600 bg-amber-50")}
                            >
                              {isDegraded ? "降级" : "失败"}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px]">
                              {s.type === "skill" ? "🧠 技能" : "🔧 工具"}
                            </Badge>
                            <span className="font-mono text-xs font-medium">{s.ref}</span>
                            {s.__runId && (
                              <a
                                href={`/runs/${s.__runId}`}
                                className="ml-auto text-[10px] text-primary hover:underline"
                              >
                                查看详情 →
                              </a>
                            )}
                          </div>
                          {(s.error || s.description) && (
                            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                              {s.description && <span className="text-foreground/80">{s.description}：</span>}
                              {(s.error || "").slice(0, 160)}
                            </p>
                          )}
                          {s.__question && (
                            <p className="text-[10px] text-muted-foreground mt-1 truncate">
                              用户问题：{s.__question}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">会话级满意度 & 任务完成率</CardTitle>
                <CardDescription>
                  综合用户评分（CSAT）和风控通过情况，反映客服真实体验质量。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(() => {
                  const ratedRuns = ratings || [];
                  const ratedCount = ratedRuns.length;
                  const avgScore = ratedCount > 0
                    ? ratedRuns.reduce((s, r: any) => s + (r.score ?? r.rating ?? 0), 0) / ratedCount
                    : 0;
                  const satisfied = ratedCount > 0 ? ratedRuns.filter((r: any) => (r.score ?? r.rating ?? 0) >= 4).length : 0;
                  const csat = ratedCount > 0 ? Math.round((satisfied / ratedCount) * 100) : 0;
                  const successCount = runs.filter((r) => r.status === "success" && r.riskResult?.passed !== false).length;
                  const taskCompletion = totalRuns > 0 ? Math.round((successCount / totalRuns) * 100) : 0;
                  const handoffCount = runs.filter((r) => (r as any).handoffToHuman).length;
                  const clarificationCount = runs.filter((r) => (r as any).needsClarification).length;
                  const degradedCount = runs.filter((r) => (r.steps || []).some((s: any) => s.status === "degraded")).length;
                  const blockedCount = runs.filter((r) => r.status === "risk_blocked").length;
                  const failedCount = runs.filter((r) => r.status === "failed").length;
                  return (
                    <>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg border p-2">
                          <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                            CSAT
                            <span title="Customer Satisfaction：打 4-5 星会话占所有被评分会话的比例" className="cursor-help text-muted-foreground/60">ⓘ</span>
                          </div>
                          <div className="text-xl font-semibold tabular-nums">{ratedCount > 0 ? `${csat}%` : "—"}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{ratedCount} 份评分</div>
                        </div>
                        <div className="rounded-lg border p-2">
                          <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                            平均评分
                            <span title="用户打分的算术平均值，满分 5 分。评分在对话结束时由用户给出。" className="cursor-help text-muted-foreground/60">ⓘ</span>
                          </div>
                          <div className="text-xl font-semibold tabular-nums">{ratedCount > 0 ? avgScore.toFixed(1) : "—"}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">满分 5 分</div>
                        </div>
                        <div className="rounded-lg border p-2">
                          <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                            任务完成率
                            <span title="执行成功且通过风控审核的会话 / 总会话数。风控拦截或执行失败都算未完成。" className="cursor-help text-muted-foreground/60">ⓘ</span>
                          </div>
                          <div className="text-xl font-semibold tabular-nums text-emerald-600">{taskCompletion}%</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{successCount} / {totalRuns} 完成</div>
                        </div>
                      </div>
                      <div className="rounded-lg border p-2.5 bg-muted/30">
                        <div className="text-[11px] font-medium text-muted-foreground mb-1.5">会话分类统计</div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                              人工接管
                              <span title="涉及客诉/售后/安全等敏感场景，AI 主动转交人工客服处理" className="cursor-help text-muted-foreground/60">ⓘ</span>
                            </span>
                            <span className="tabular-nums">{handoffCount}（{totalRuns > 0 ? Math.round((handoffCount / totalRuns) * 100) : 0}%）</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                              反问澄清
                              <span title="用户需求模糊（如'有什么好吃的'），AI 先反问口味/预算/场景再做推荐" className="cursor-help text-muted-foreground/60">ⓘ</span>
                            </span>
                            <span className="tabular-nums">{clarificationCount}（{totalRuns > 0 ? Math.round((clarificationCount / totalRuns) * 100) : 0}%）</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                              降级执行
                              <span title="某一步（工具超时、模型返回异常）失败后使用兜底结果继续回复，可能影响回复质量" className="cursor-help text-muted-foreground/60">ⓘ</span>
                            </span>
                            <span className="tabular-nums">{degradedCount}（{totalRuns > 0 ? Math.round((degradedCount / totalRuns) * 100) : 0}%）</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                              风控拦截
                              <span title="触发绝对化宣传/功效承诺等合规红线，回复被拦截重写或转人工" className="cursor-help text-muted-foreground/60">ⓘ</span>
                            </span>
                            <span className="tabular-nums">{blockedCount}（{totalRuns > 0 ? Math.round((blockedCount / totalRuns) * 100) : 0}%）</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-600"></span>
                              执行失败
                              <span title="步骤异常导致无法生成回复，向用户返回'服务不可用'类提示" className="cursor-help text-muted-foreground/60">ⓘ</span>
                            </span>
                            <span className="tabular-nums">{failedCount}（{totalRuns > 0 ? Math.round((failedCount / totalRuns) * 100) : 0}%）</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              正常完成
                            </span>
                            <span className="tabular-nums text-emerald-600 font-medium">{successCount}（{taskCompletion}%）</span>
                          </div>
                        </div>
                      </div>
                      {ratedCount === 0 && (
                        <p className="text-[11px] text-muted-foreground bg-yellow-50 border border-yellow-200 rounded p-2">
                          ⓘ CSAT 和平均评分为「—」是因为当前会话还没有用户评分。去 <a href="/demo" className="text-primary underline">聊天 Demo</a> 或 <a href="/eval" className="text-primary underline">批量评测</a> 跑完一批，在回复末尾点击 👍/👎 打分，这里就会有数据。
                        </p>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 服务评分 */}
        <TabsContent value="ratings" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <MetricCard label="评分总数" value={ratings.length.toString()} />
            <MetricCard
              label="平均分"
              value={ratings.length ? (ratings.reduce((s, r) => s + r.score, 0) / ratings.length).toFixed(2) : "-"}
            />
            <MetricCard
              label="好评率(4-5分)"
              value={ratings.length ? `${Math.round((ratings.filter((r) => r.score >= 4).length / ratings.length) * 100)}%` : "-"}
            />
            <MetricCard
              label="差评(1-2分)"
              value={ratings.filter((r) => r.score <= 2).length.toString()}
              tone={ratings.some((r) => r.score <= 2) ? "danger" : undefined}
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">评分趋势（最近 14 条）</CardTitle>
              <CardDescription>每日平均分变化，用于观察改动后效果</CardDescription>
            </CardHeader>
            <CardContent>
              {ratings.length === 0 ? (
                <p className="text-muted-foreground text-sm">暂无评分</p>
              ) : (
                <RatingSparkline ratings={ratings.slice(-30)} />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">评分明细</CardTitle>
              <CardDescription>1 分自动进入 Bad Case / 改进建议</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {ratings.slice().reverse().map((r) => (
                  <div key={r.id} className="border border-border rounded-lg p-3 flex gap-3">
                    <div className={`text-2xl font-bold ${r.score <= 2 ? "text-danger" : r.score === 3 ? "text-amber-500" : "text-success"}`}>{r.score}</div>
                    <div className="flex-1 space-y-1 min-w-0">
                      <p className="text-sm truncate"><b>Q:</b> {r.question}</p>
                      <p className="text-sm text-muted-foreground truncate"><b>A:</b> {r.reply}</p>
                      {r.comment && <p className="text-xs italic">"{r.comment}"</p>}
                      <p className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 评测集 */}
        <TabsContent value="eval-sets" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">评测集 ({cases.filter((c) => c.enabled).length}/{cases.length} 启用)</CardTitle>
                <CardDescription>每条用例包含场景、期望关键词、价格、风控要求和能力路径。每行可单独测试、编辑和删除</CardDescription>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setEditingCase({
                    id: "",
                    name: "新用例",
                    question: "",
                    scenario: "自定义场景",
                    expectedKeywords: [],
                    expectedPrice: null,
                    expectRiskPassed: true,
                    requiredCapabilities: [],
                    forbiddenCapabilities: [],
                    enabled: true,
                  });
                  setEditingCaseNew(true);
                }}
              >
                + 新增用例
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {cases.map((c) => (
                <div key={c.id} className="border border-border rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge variant="secondary" className="text-[10px]">{c.name ?? c.scenario}</Badge>
                        {!c.expectRiskPassed && c.expectRiskPassed !== undefined ? <Badge variant="destructive" className="text-[10px]">期望风控拒绝</Badge> : null}
                        {c.expectRiskPassed && <Badge variant="outline" className="text-[10px] text-success border-success/30">期望通过</Badge>}
                        {c.expectedPrice && <Badge variant="outline" className="text-[10px]">期望价格 ¥{c.expectedPrice}</Badge>}
                      </div>
                      <p className="text-sm font-medium">{c.question}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        关键词: {(c.expectedKeywords || []).length > 0 ? (c.expectedKeywords || []).map((g: string) => g.replace(/\|/g, "/")).join(" · ") : <span className="text-muted-foreground/70 italic">未设置</span>}
                      </p>
                      {((c.requiredCapabilities?.length ?? 0) > 0 || (c.forbiddenCapabilities?.length ?? 0) > 0) && (
                        <p className="text-xs mt-1">
                          {(c.requiredCapabilities?.length ?? 0) > 0 && <span className="text-success">必经: {(c.requiredCapabilities ?? []).join(", ")}</span>}
                          {(c.forbiddenCapabilities?.length ?? 0) > 0 && <span className="text-danger ml-2">禁用: {(c.forbiddenCapabilities ?? []).join(", ")}</span>}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => runSingleCase(c)} disabled={runningSingle && testingCaseId === c.id}>
                        {runningSingle && testingCaseId === c.id ? "测试中…" : "▶ 测试"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setEditingCase(c); setEditingCaseNew(false); }}>
                        ✎ 编辑
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => duplicateCase(c)} title="复制一份">
                        ⎘ 复制
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-danger hover:text-danger" onClick={() => deleteCase(c.id)}>
                        🗑
                      </Button>
                      <Switch checked={c.enabled} onCheckedChange={(v) => toggleCase(c.id, v)} />
                    </div>
                  </div>
                  {testingCaseId === c.id && testingCaseResult && (
                    <div className="mt-2 pl-0.5 pr-0.5">
                      <div className="text-[11px] text-muted-foreground mb-1 flex items-center justify-between">
                        <span>🧪 单条测试结果</span>
                        <div className="flex items-center gap-1.5">
                          {testingCaseTrace && testingCaseTrace.length > 0 && (
                            <button onClick={() => {
                              // 切换显示/隐藏完整 trace
                              const el = document.getElementById(`case-trace-${c.id}`);
                              if (el) el.classList.toggle('hidden');
                            }} className="text-primary hover:underline">🔍 展开/折叠执行 Trace</button>
                          )}
                          <button onClick={() => { setTestingCaseId(null); setTestingCaseResult(""); setTestingCaseTrace(null); }} className="hover:text-foreground">×</button>
                        </div>
                      </div>
                      <pre className="text-xs bg-muted/60 rounded-md p-2 whitespace-pre-wrap max-h-60 overflow-auto font-sans text-foreground/90 leading-relaxed">{testingCaseResult}</pre>
                      {testingCaseTrace && testingCaseTrace.length > 0 && (
                        <div id={`case-trace-${c.id}`} className="hidden mt-2 border rounded-md p-2 bg-slate-50 space-y-1.5">
                          <div className="text-[11px] text-muted-foreground mb-1">🔬 执行步骤明细（共 {testingCaseTrace.length} 步）</div>
                          {testingCaseTrace.map((s, idx) => {
                            if (s.type !== 'step') return null;
                            const dotColor = s.status === 'error' ? 'text-red-500' : s.status === 'degraded' ? 'text-amber-500' : 'text-emerald-600';
                            return (
                            <details key={idx} className="border rounded bg-white px-2 py-1.5" open={false}>
                              <summary className="cursor-pointer text-xs flex items-center gap-2 list-none">
                                <span className={dotColor}>●</span>
                                <span className="font-mono">{s.ref}</span>
                                <span className="text-muted-foreground">({s.stepType || s.type})</span>
                                {s.status === 'error' && <span className="text-red-500 text-[10px]">error</span>}
                                {s.status === 'degraded' && <span className="text-amber-500 text-[10px]">degraded</span>}
                                <span className="ml-auto text-muted-foreground">{s.durationMs || 0}ms</span>
                              </summary>
                              {s.message && <div className="text-[11px] text-red-600 mt-1 px-1">{s.message}</div>}
                              <pre className="text-[11px] whitespace-pre-wrap mt-1.5 p-1.5 bg-slate-50 rounded max-h-48 overflow-y-auto text-foreground/80">{typeof s.output === 'string' ? s.output : JSON.stringify(s.output, null, 2)}</pre>
                            </details>
                          );})}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 评测中心 */}
        <TabsContent value="eval" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="text-base">评测中心</CardTitle>
                <CardDescription>固定用例与运行条件，建立可重复、可比较的回归批次</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[240px_1fr_auto] md:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="eval-batch-name">批次名称</Label>
                  <Input id="eval-batch-name" value={batchName} onChange={(event) => setBatchName(event.target.value)} placeholder="例如 baseline-v1" />
                </div>
                <div className="text-xs text-muted-foreground">
                  已选择 <b className="text-foreground">{selectedCaseIds.length}</b> 条；运行后会保存 caseIds、用例快照、评分器、Provider、模型、参数、Skill、Tool 与业务数据指纹。
                </div>
                <Button onClick={() => runEval()} disabled={runningBatch || selectedCaseIds.length === 0}>
                  {runningBatch ? "运行中..." : `运行 ${selectedCaseIds.length} 条`}
                </Button>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {cases.map((evalCase) => (
                  <label key={evalCase.id} className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm",
                    selectedCaseIds.includes(evalCase.id) && "border-primary bg-primary/5",
                  )}>
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedCaseIds.includes(evalCase.id)}
                      onChange={(event) => setSelectedCaseIds((current) =>
                        event.target.checked
                          ? [...current, evalCase.id]
                          : current.filter((id) => id !== evalCase.id)
                      )}
                    />
                    <span>
                      <span className="block font-medium">{evalCase.name}</span>
                      <span className="block text-xs text-muted-foreground">{evalCase.question}</span>
                    </span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>
          {latestBatch && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  {latestBatch.name || `批次 ${latestBatch.id.slice(-6)}`}
                  <Badge variant={latestBatch.status === "done" ? "default" : "secondary"}>
                    {latestBatch.status === "running" ? "运行中" : latestBatch.status === "done" ? "完成" : "错误"}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  PASS {latestBatch.passed} · FAIL {latestBatch.failed} · REVIEW {latestBatch.review ?? 0} · ERROR {latestBatch.errors ?? 0} · total {latestBatch.total}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {latestBatch.conditionSnapshot && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs">
                    <div className="font-medium mb-1.5">运行条件快照</div>
                    <div className="grid gap-1 md:grid-cols-3 text-muted-foreground">
                      <span>case {latestBatch.conditionSnapshot.caseSetHash}</span>
                      <span>scorer {latestBatch.conditionSnapshot.evaluatorVersion}</span>
                      <span>{latestBatch.conditionSnapshot.provider} / {latestBatch.conditionSnapshot.model}</span>
                      <span>params {latestBatch.conditionSnapshot.paramsHash}</span>
                      <span>planner {latestBatch.conditionSnapshot.plannerHash}</span>
                      <span>tools {latestBatch.conditionSnapshot.toolHash}</span>
                    </div>
                  </div>
                )}
                {(latestBatch.caseIds ? cases.filter((item) => latestBatch.caseIds?.includes(item.id)) : cases).map((c) => {
                  const r = latestBatch.caseResults?.[c.id];
                  const ev = r?.evidence;
                  const resultStatus = r?.status || (r?.passed ? "PASS" : "FAIL");
                  const statusClass = resultStatus === "PASS"
                    ? "bg-success text-white"
                    : resultStatus === "REVIEW"
                      ? "bg-warning text-white"
                      : resultStatus === "ERROR"
                        ? "bg-slate-700 text-white"
                        : "bg-danger text-white";
                  return (
                    <details key={c.id} className="group p-2 border border-border rounded-lg open:bg-accent/30">
                      <summary className="flex items-start gap-3 cursor-pointer list-none">
                        <div className={`mt-1 min-w-14 rounded px-1.5 py-0.5 text-center text-[10px] font-medium ${!r ? "bg-muted text-muted-foreground" : statusClass}`}>
                          {!r ? "PENDING" : resultStatus}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{c.question}</p>
                          {r?.reason && <p className={`text-xs mt-0.5 ${r.passed ? "text-success" : "text-danger"}`}>{r.reason}</p>}
                          <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px] text-muted-foreground">
                            {ev?.keywordChecks !== undefined && <span className={ev.keywordChecks.every((item) => item.passed) ? "text-success" : "text-danger"}>关键词 {ev.keywordChecks.filter((item) => item.passed).length}/{ev.keywordChecks.length}</span>}
                            {ev?.expectedPrice != null && <span className={(ev.mentionedPrice != null && ev.expectedPrice != null && ev.mentionedPrice !== ev.expectedPrice) ? "text-danger" : "text-success"}>价格{(ev.mentionedPrice != null && ev.expectedPrice != null && ev.mentionedPrice !== ev.expectedPrice) ? `✗(出现¥${ev.mentionedPrice ?? "-"})` : "✓"}</span>}
                            {c.expectRiskPassed != null && <span className={r?.riskPassed === c.expectRiskPassed ? "text-success" : "text-danger"}>安全判断{r?.riskPassed === c.expectRiskPassed ? "✓" : "✗"}</span>}
                          </div>
                        </div>
                        <span className="text-muted-foreground text-xs mt-1 group-open:rotate-90 transition">▸</span>
                      </summary>
                      <div className="mt-2 pl-8 space-y-2 text-xs">
                        {ev?.keywordChecks && ev.keywordChecks.some((item) => item.passed) && <p><span className="text-success">命中关键词：</span>{ev.keywordChecks.filter((item) => item.passed).map((item) => item.matched).join(" / ")}</p>}
                        {ev?.keywordMisses && ev.keywordMisses.length > 0 && <p><span className="text-danger">未命中：</span>{ev.keywordMisses.join(" / ")}</p>}
                        {ev?.forbiddenHits && ev.forbiddenHits.length > 0 && <p><span className="text-danger">命中禁用词：</span>{ev.forbiddenHits.join(" / ")}</p>}
                        {ev?.expectedPrice != null && <p>期望价格：¥{ev.expectedPrice}；回复提取：{ev.mentionedPrice != null ? `¥${ev.mentionedPrice}` : "未提及"}</p>}
                        {ev?.riskIssues && ev.riskIssues.length > 0 && <p className="text-danger">风控问题：{ev.riskIssues.join("；")}</p>}
                        {r?.finalReply && (
                          <div className="bg-muted/50 rounded p-2">
                            <p className="text-[11px] text-muted-foreground mb-1">模型回复</p>
                            <p className="whitespace-pre-wrap text-foreground/90">{r.finalReply.slice(0, 400)}{r.finalReply.length > 400 ? "…" : ""}</p>
                          </div>
                        )}
                        {r?.runId && <a href={`/runs/${r.runId}`} className="text-primary hover:underline inline-block">查看完整 trace →</a>}
                      </div>
                    </details>
                  );
                })}
                {latestBatch.status === "done" && (
                  <div className="flex justify-end">
                    <Button variant="outline" onClick={() => {
                      setSelectedCaseIds(latestBatch.caseIds || []);
                      setBatchName("risk-fix-v2");
                      toast.success("已复用基线 caseIds；修改 risk-check 后运行回归批次");
                    }}>
                      复用本批次用例创建回归
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle className="text-base">人工复核提示词草案</CardTitle></CardHeader>
            <CardContent>
              <Textarea value={judgePrompt} onChange={(e) => setJudgePrompt(e.target.value)} rows={4} />
              <p className="text-xs text-muted-foreground mt-2">当前自动评分使用确定性规则；规则无法覆盖的结果进入 REVIEW，本提示词仅供人工复核参考，不会伪装成已执行的 Judge。</p>
            </CardContent>
          </Card>
          {batches.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">批次对比</CardTitle>
                <CardDescription>先核对运行条件；只有可比时才给出已修复、新增失败和指标变化</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <select
                    value={compareA}
                    onChange={(e) => setCompareA(e.target.value)}
                    className="rounded-md border border-input bg-background px-2 py-1.5"
                  >
                    <option value="">请选择批次 A</option>
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name || b.id.slice(-6)} · {b.passed}/{b.total} · {formatDate(b.createdAt)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={compareB}
                    onChange={(e) => setCompareB(e.target.value)}
                    className="rounded-md border border-input bg-background px-2 py-1.5"
                  >
                    <option value="">请选择批次 B</option>
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name || b.id.slice(-6)} · {b.passed}/{b.total} · {formatDate(b.createdAt)}
                      </option>
                    ))}
                  </select>
                </div>
                {comparison && (
                  <div className={cn(
                    "rounded-lg border p-3 text-sm",
                    comparison.comparable ? "border-success/40 bg-success/5" : "border-danger/40 bg-danger/5",
                  )}>
                    <div className="font-medium">{comparison.comparable ? "✓ 运行条件可比" : "✗ 不可直接比较"}</div>
                    {comparison.comparable ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        仅允许一个 Skill 发生变化；本次变化：{comparison.changedSkills.join("、") || "无"}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-danger">原因：{comparison.reasons.join("；")}</div>
                    )}
                  </div>
                )}
                {summaryA && summaryB && comparison?.comparable && (
                  <>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {([
                      ["通过率", `${summaryA.passRate}%`, `${summaryB.passRate}%`, "passRate"],
                      ["平均耗时", `${summaryA.avgDuration}ms`, `${summaryB.avgDuration}ms`, "avgDuration"],
                      ["风控拦截", `${summaryA.riskFailed}`, `${summaryB.riskFailed}`, "riskFailed"],
                    ] as const).map(([label, vA, vB, key]) => {
                      const delta =
                        key === "passRate"
                          ? summaryB.passRate - summaryA.passRate
                          : key === "avgDuration"
                            ? summaryB.avgDuration - summaryA.avgDuration
                            : summaryB.riskFailed - summaryA.riskFailed;
                      const goodDelta = key === "avgDuration" ? delta < 0 : key === "passRate" ? delta > 0 : delta < 0;
                      return (
                        <div key={key} className="rounded-lg border border-border p-3">
                          <div className="text-xs text-muted-foreground">{label}</div>
                          <div className="flex items-baseline justify-center gap-2 mt-1">
                            <span className="font-mono text-sm">{vA}</span>
                            <span className="text-muted-foreground text-xs">→</span>
                            <span className="font-mono text-sm font-medium">{vB}</span>
                          </div>
                          <div className={`text-[11px] mt-1 ${delta === 0 ? "text-muted-foreground" : goodDelta ? "text-success" : "text-danger"}`}>
                            {delta === 0 ? "持平" : (delta > 0 ? "+" : "") + delta + (key === "passRate" ? "pp" : "")}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="rounded-lg border border-success/40 bg-success/5 p-3">
                      <div className="text-sm font-medium text-success">已修复 {comparison.fixed.length}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {comparison.fixed.length ? comparison.fixed.map((id) => cases.find((item) => item.id === id)?.name || id).join("、") : "无"}
                      </div>
                    </div>
                    <div className="rounded-lg border border-danger/40 bg-danger/5 p-3">
                      <div className="text-sm font-medium text-danger">新增失败 {comparison.regressions.length}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {comparison.regressions.length ? comparison.regressions.map((id) => cases.find((item) => item.id === id)?.name || id).join("、") : "无"}
                      </div>
                    </div>
                  </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle className="text-base">历史批次</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1 text-sm">
                {batches.slice(0, 11).map((b) => (
                  <div key={b.id} className="flex items-center justify-between p-2 border border-border rounded">
                    <span className="text-xs"><b>{b.name || b.id}</b><span className="ml-2 font-mono text-muted-foreground">{b.id.slice(-6)}</span></span>
                    <span className="text-xs text-muted-foreground">{formatDate(b.createdAt)}</span>
                    <Badge variant={b.failed === 0 && (b.errors ?? 0) === 0 ? "default" : "destructive"} className="text-[10px]">
                      P{b.passed} / F{b.failed} / R{b.review ?? 0} / E{b.errors ?? 0}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 数据标注 */}
        <TabsContent value="annotations" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MetricCard label="标注总量" value={annotations.length} />
            <MetricCard label="待审核" value={annotations.filter((a) => a.status === "pending").length} tone="warning" />
            <MetricCard label="已通过" value={annotations.filter((a) => a.status === "approved").length} tone="success" />
            <MetricCard label="已驳回" value={annotations.filter((a) => a.status === "rejected").length} tone="danger" />
            <MetricCard label="Golden Case" value={annotations.filter((a) => a.qualityTags?.includes("golden") || (a.scores && a.scores.overall === 5)).length} tone="success" />
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">六维质量标注</CardTitle>
              <CardDescription>正确性 / 相关性 / 完整性 / 安全性 / 语气 / 整体。标注→审核→发布为 Eval / Skill 草案</CardDescription>
            </CardHeader>
            <CardContent>
              {annotations.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground text-sm mb-3">暂无标注数据</p>
                  <p className="text-xs text-muted-foreground">可在会话详情页将 Bad Case 转为标注任务</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {annotations.map((a) => (
                    <div key={a.id} className="border border-border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={`text-[10px] capitalize ${
                            a.status === "approved" ? "text-success border-success/40" :
                            a.status === "rejected" ? "text-danger border-danger/40" :
                            a.status === "pending" ? "text-amber-700 border-amber-300" : ""
                          }`}>{a.status}</Badge>
                          {a.intent && <Badge variant="secondary" className="text-[10px]">{a.intent}</Badge>}
                          {a.riskLevel && (
                            <Badge className={`text-[10px] ${
                              a.riskLevel === "high" ? "bg-danger/15 text-danger" :
                              a.riskLevel === "medium" ? "bg-amber-100 text-amber-700" :
                              "bg-success/15 text-success"
                            }`}>{a.riskLevel} risk</Badge>
                          )}
                          {a.qualityTags?.slice(0, 3).map((t) => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>
                          ))}
                        </div>
                        <span className="text-xs text-muted-foreground">{formatDate(a.createdAt)}</span>
                      </div>
                      <p className="text-sm"><b>Q:</b> {a.question}</p>
                      <p className="text-sm text-muted-foreground"><b>A:</b> {a.reply?.slice(0, 150)}{(a.reply?.length || 0) > 150 ? "…" : ""}</p>
                      {a.expectedReply && (
                        <p className="text-sm mt-1 text-success/80"><b>期望:</b> {a.expectedReply.slice(0, 120)}{a.expectedReply.length > 120 ? "…" : ""}</p>
                      )}
                      <div className="flex flex-wrap gap-2 mt-2 text-xs">
                        {Object.entries(a.scores).map(([k, v]) => (
                          <span key={k} className={`px-2 py-0.5 rounded ${v >= 4 ? "bg-success/15 text-success" : v === 3 ? "bg-amber-100 text-amber-700" : "bg-danger/15 text-danger"}`}>
                            {k}: {v}
                          </span>
                        ))}
                      </div>
                      {a.forbiddenPhrases && a.forbiddenPhrases.length > 0 && (
                        <p className="text-[11px] mt-1 text-danger/80">禁词: {a.forbiddenPhrases.join(" / ")}</p>
                      )}
                      {a.annotatorNote && <p className="text-xs italic mt-1 text-muted-foreground">注: {a.annotatorNote}</p>}
                      {a.status === "pending" && (
                        <div className="mt-3 pt-2 border-t border-border flex flex-wrap gap-2 items-center">
                          <Button size="sm" variant="default" className="h-7 text-xs bg-success hover:bg-success/90" onClick={() => updateAnnotationStatus(a.id, "approved")}>
                            ✓ 批准为合规
                          </Button>
                          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => setReviewingAnnotation(a)}>
                            ✗ 驳回重写
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startReplay(a.question)}>
                            ↻ 重跑此问
                          </Button>
                      {(() => {
                        const targetRunId = a.runId || a.sourceRunId;
                        const btn = (
                          <Button size="sm" variant="outline" className="h-7 text-xs" asChild disabled={!targetRunId}>
                            {targetRunId
                              ? <a href={`/runs/${targetRunId}`} target="_blank" rel="noreferrer">查看完整对话 →</a>
                              : <span className="text-muted-foreground/60 cursor-not-allowed">查看完整（无关联会话）</span>}
                          </Button>
                        );
                        return btn;
                      })()}
                    </div>
                  )}
                  {a.status !== "pending" && (
                    <div className="mt-2 pt-2 border-t border-border flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => startReplay(a.question)}>
                        ↻ 重跑此问
                      </Button>
                      {(() => {
                        const targetRunId = a.runId || a.sourceRunId;
                        return (
                          <Button size="sm" variant="ghost" className="h-7 text-xs" asChild disabled={!targetRunId}>
                            {targetRunId
                              ? <a href={`/runs/${targetRunId}`} target="_blank" rel="noreferrer">查看完整对话 →</a>
                              : <span className="text-muted-foreground/60 cursor-not-allowed">查看完整（无关联会话）</span>}
                          </Button>
                        );
                      })()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 改进建议 */}
        <TabsContent value="improvements" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">改进建议中心</CardTitle>
              <CardDescription>自动汇总 Bad Case / 低评分 / 低分标注，给出 Planner/Skill/Tool/Eval 改进方向</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {badCaseClusters.length > 0 && (
                <div className="space-y-2 pb-1">
                  <p className="text-xs font-medium text-muted-foreground">Bad Case 聚类</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {badCaseClusters.map((c) => (
                      <div key={c.name} className="rounded-lg border border-border bg-card p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium truncate">{c.name}</span>
                            <Badge variant="secondary" className="text-[10px] shrink-0">
                              {c.targetSkill}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline" className="text-destructive border-destructive/30 bg-destructive/5 text-[11px]">
                              {c.count} 条
                            </Badge>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="text-[11px] h-7 px-2"
                              disabled={patchLoading === c.name}
                              onClick={() => generatePatch(c.name)}
                            >
                              {patchLoading === c.name ? "生成中…" : "生成 Prompt 补丁"}
                            </Button>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{c.hint}</p>
                        {c.sampleQs.length > 0 && (
                          <div className="mt-2 space-y-0.5">
                            {c.sampleQs.map((q, i) => (
                              <div key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground/80">
                                <span className="font-mono text-primary/70 shrink-0">·</span>
                                <span className="truncate">{q}</span>
                                <span className="font-mono text-muted-foreground/50 shrink-0 ml-auto">{c.sampleRunIds[i]?.slice(-8)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {latestBatch && latestBatch.failed > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-xs bg-amber-500 text-white">{latestBatch.failed}</span>
                      <b className="text-sm">评测未通过 case</b>
                    </div>
                    <Button size="sm" variant="ghost" className="text-[11px] h-7" asChild>
                      <a href="#eval-anchor" onClick={() => {
                        const el = document.querySelector('[role="tab"][data-value="eval"]') as HTMLElement | null;
                        el?.click();
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}>前往评测中心 →</a>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground ml-10">
                    最新批次（{latestBatch.id.slice(-8)}）有 {latestBatch.failed} 条用例未通过，建议到评测中心查看失败明细再优化对应 Skill Prompt。
                  </p>
                </div>
              )}
              {failRuns === 0 && badCases.length === 0 && failSteps.length === 0 && badCaseClusters.length === 0 && (!latestBatch || latestBatch.failed === 0) && (
                <div className="text-center py-8">
                  <p className="text-success">暂无待改进项，当前系统表现良好。</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Prompt 补丁预览抽屉 */}
        {patchPreview && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-end">
            <div className="w-full md:w-[720px] h-full bg-background border-l border-border overflow-auto p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-semibold">Prompt 补丁预览</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    目标 Skill：<span className="font-medium">{patchPreview.skillName}</span>
                    （{patchPreview.skillId}） · 聚类：{patchPreview.clusterName}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setPatchPreview(null)}>关闭</Button>
              </div>

              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">改进逻辑</p>
                <p className="text-sm">{patchPreview.rationale || "（未生成）"}</p>
              </div>

              <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">修改点（{patchPreview.segments.length}）</p>
                <ul className="space-y-2">
                  {patchPreview.segments.map((s, i) => (
                    <li key={i} className="text-xs border border-border rounded-md p-2">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className="text-[10px]" variant={s.kind === "replace" ? "destructive" : "secondary"}>
                          {s.kind === "insert_after" ? "追加" : s.kind === "replace" ? "替换" : "保留"}
                        </Badge>
                        <span className="text-muted-foreground">{s.reason}</span>
                      </div>
                      {s.kind === "replace" && s.oldText && (
                        <pre className="text-[11px] bg-danger/10 text-danger p-2 rounded whitespace-pre-wrap mb-1">{s.oldText}</pre>
                      )}
                      <pre className="text-[11px] bg-success/10 text-success p-2 rounded whitespace-pre-wrap">{s.newText}</pre>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Diff 预览</p>
                {renderDiff(patchPreview.originalBody, patchPreview.patchedBodyPreview)}
              </div>

              {patchPreview.sampleRuns.length > 0 && (
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">参考样例</p>
                  <div className="space-y-2">
                    {patchPreview.sampleRuns.map((s, i) => (
                      <div key={s.runId + i} className="text-xs border border-border rounded p-2">
                        <p className="font-mono text-muted-foreground">{s.runId}</p>
                        <p className="mt-1"><span className="text-muted-foreground">Q：</span>{s.question}</p>
                        {s.reply && <p className="mt-0.5"><span className="text-muted-foreground">A：</span>{s.reply.slice(0, 160)}{s.reply.length > 160 ? "…" : ""}</p>}
                        {s.issue && <p className="mt-0.5 text-danger">命中：{s.issue}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 sticky bottom-0 bg-background pt-2">
                <Button variant="outline" onClick={() => setPatchPreview(null)}>取消</Button>
                <Button onClick={applyPatch} disabled={patchApplying}>{patchApplying ? "应用中…" : "确认应用到 Skill"}</Button>
              </div>
            </div>
          </div>
        )}

        {/* 人工评估 */}
        <TabsContent value="human-review" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">待人工评估
                    <Badge variant="secondary" className="text-xs">
                      {annotations.filter((a) => a.status === "pending" || a.status === "annotated").length} 条
                    </Badge>
                  </CardTitle>
                  <CardDescription>标注员已打六维评分、待主管审核。可批准发布为 Eval 黄金用例、或驳回补标注</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {(() => {
                const pending = annotations.filter((a) => a.status === "pending" || a.status === "annotated");
                if (pending.length === 0) {
                  return <p className="text-muted-foreground text-sm py-4 text-center">暂无待审核标注</p>;
                }
                return (
                  <div className="space-y-3">
                    {pending.map((a) => (
                      <div key={a.id} className="p-4 border border-border rounded-xl bg-card">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <Badge
                                variant="secondary"
                                className={cn(
                                  "text-xs",
                                  a.riskLevel === "high" && "bg-danger/10 text-danger",
                                  a.riskLevel === "medium" && "bg-amber-500/10 text-amber-600",
                                  a.riskLevel === "low" && "bg-success/10 text-success",
                                )}
                              >
                                {a.riskLevel === "high" ? "高风险" : a.riskLevel === "medium" ? "中风险" : "低风险"}
                              </Badge>
                              {a.qualityTags?.slice(0, 3).map((t: string) => (
                                <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                              ))}
                              {a.status === "annotated" && (
                                <Badge variant="outline" className="text-xs text-muted-foreground">已标注 · 待审核</Badge>
                              )}
                            </div>
                            <p className="text-sm font-medium">{a.question}</p>
                            {a.reply && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">A：{a.reply.slice(0, 180)}{a.reply.length > 180 ? "…" : ""}</p>
                            )}
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                              <span>整体 <b className={cn("font-mono", (a.scores?.overall ?? 0) <= 2 ? "text-danger" : (a.scores?.overall ?? 0) >= 4 ? "text-success" : "")}>{a.scores?.overall ?? "-"}/5</b></span>
                              <span>正确性 {a.scores?.correctness ?? "-"}</span>
                              <span>相关性 {a.scores?.relevance ?? "-"}</span>
                              <span>完整性 {a.scores?.completeness ?? "-"}</span>
                              <span>安全 {a.scores?.safety ?? "-"}</span>
                              <span>语气 {a.scores?.tone ?? "-"}</span>
                            </div>
                            {a.annotatorNote && (
                              <p className="text-xs mt-2 px-2 py-1 rounded bg-muted/50 text-muted-foreground">
                                标注备注：{a.annotatorNote}
                              </p>
                            )}
                            {a.note && a.note !== a.annotatorNote && (
                              <p className="text-xs mt-1 text-muted-foreground/80">种子说明：{a.note}</p>
                            )}
                          </div>
                          <div className="flex flex-col gap-1.5 shrink-0">
                            <Button size="sm" className="px-3" onClick={async () => {
                              await fetch("/api/annotations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...a, status: "approved" }) });
                              toast.success("已批准，可作为 Eval 黄金用例");
                              load();
                            }}>批准</Button>
                            <Button size="sm" variant="outline" onClick={async () => {
                              const reason = window.prompt("驳回原因（必填）：");
                              if (!reason) return;
                              await fetch("/api/annotations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...a, status: "rejected", reviewNote: reason }) });
                              toast.success("已驳回");
                              load();
                            }}>驳回</Button>
                            <Button size="sm" variant="ghost" onClick={async () => {
                              const note = window.prompt("补充批注（可选）：", a.reviewNote || "");
                              await fetch("/api/annotations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...a, reviewNote: note ?? a.reviewNote }) });
                              load();
                            }}>批注</Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">已批准（可进 Eval）</div>
              <div className="text-2xl font-semibold mt-1 text-success">
                {annotations.filter(a => a.status === "approved").length}
              </div>
              <p className="text-xs text-muted-foreground mt-1">已通过主管审核，可发布为评测黄金用例</p>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">已驳回（需改 Prompt）</div>
              <div className="text-2xl font-semibold mt-1 text-danger">
                {annotations.filter(a => a.status === "rejected").length}
              </div>
              <p className="text-xs text-muted-foreground mt-1">暴露能力缺陷，驱动 Skill Prompt 迭代</p>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">总标注样本</div>
              <div className="text-2xl font-semibold mt-1">{annotations.length}</div>
              <p className="text-xs text-muted-foreground mt-1">覆盖六维质量标注 + 审核闭环</p>
            </Card>
          </div>
        </TabsContent>

        {/* 版本回滚 */}
        <TabsContent value="versions" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">版本历史 & 回滚</CardTitle>
              <CardDescription>每次保存 Skill / Planner / Tool 配置自动留存版本，可一键回滚</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    共 {skills.length} 个 Skill，合计 {Object.values(versionMap).reduce((n, vs) => n + vs.length, 0)} 个版本快照
                  </p>
                  <p className="text-xs text-muted-foreground/80 mt-1">
                    每条记录标注来源：<span className="rounded bg-amber-50 text-amber-700 px-1 text-[10px]">manual</span> 手动保存 /
                    <span className="rounded bg-primary/10 text-primary px-1 text-[10px] ml-1">patch</span> Prompt 补丁 /
                    <span className="rounded bg-success/10 text-success px-1 text-[10px] ml-1">rollback</span> 回滚 /
                    <span className="rounded bg-muted px-1 text-[10px] ml-1">seed</span> 初始版本
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loadingVersions}
                  onClick={async () => {
                    setLoadingVersions(true);
                    const map: Record<string, SkillVersionMeta[]> = {};
                    await Promise.all(skills.map(async (s) => {
                      const r = await fetch(`/api/skills/${s.id}/versions`);
                      const j = await r.json();
                      map[s.id] = (j.versions || []).slice(0, 8);
                    }));
                    setVersionMap(map);
                    setLoadingVersions(false);
                    toast.success("版本列表已刷新");
                  }}
                >
                  {loadingVersions ? "加载中…" : "刷新版本"}
                </Button>
              </div>

              {skills.length === 0 && (
                <p className="text-sm text-muted-foreground">暂无 Skill 数据。</p>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                {skills.map((s) => {
                  const versions = versionMap[s.id] || [];
                  const currentSnap = versions[0];
                  return (
                    <Card key={s.id} className="overflow-hidden">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <CardTitle className="text-sm flex items-center gap-2">
                              {s.name}
                              {s.enabled ? (
                                <Badge variant="outline" className="text-[10px] text-success">启用</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] text-muted-foreground">停用</Badge>
                              )}
                            </CardTitle>
                            <CardDescription className="text-xs mt-1 line-clamp-1">{s.description}</CardDescription>
                          </div>
                        </div>
                        {currentSnap && (
                          <div className="flex items-center justify-between gap-2 mt-1">
                            <div className="text-[11px] text-muted-foreground font-mono">
                              最新快照：{currentSnap.vId?.slice(0, 8)}（工作区内容可能已更新，请以对比为准）
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                className="text-[11px] text-primary hover:underline px-1"
                                onClick={() => handlePreview(s.id, s.name, currentSnap.vId, currentSnap.message)}
                              >查看</button>
                              <button
                                className="text-[11px] text-primary hover:underline px-1"
                                onClick={() => handleTestVersion(s.id, currentSnap.vId)}
                              >测试</button>
                            </div>
                          </div>
                        )}
                        {/* 手动保存快照 */}
                        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border/60">
                          <input
                            className="flex-1 h-7 text-[11px] rounded border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-primary"
                            placeholder="快照备注（例：修复用户需求误判bug后保存）"
                            value={snapshotMsg[s.id] || ""}
                            onChange={(e) => setSnapshotMsg((m) => ({ ...m, [s.id]: e.target.value }))}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px] px-2"
                            disabled={snapshotting === s.id}
                            onClick={() => handleSnapshot(s.id)}
                          >
                            {snapshotting === s.id ? "保存中…" : "📸 保存快照"}
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        {versions.length === 0 ? (
                          <p className="text-xs text-muted-foreground">暂无版本快照</p>
                        ) : (
                          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                            {versions.map((v, i) => (
                              <div key={v.vId} className={cn(
                                "flex items-center justify-between gap-2 text-xs rounded-md px-2 py-1.5",
                                i === 0 ? "bg-primary/5 border border-primary/20" : "bg-muted/40"
                              )}>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={cn(
                                      "px-1 rounded text-[10px]",
                                      v.source === "manual" && "bg-amber-100 text-amber-700",
                                      v.source === "patch" && "bg-primary/10 text-primary",
                                      v.source === "rollback" && "bg-success/10 text-success",
                                      v.source === "seed" && "bg-muted text-muted-foreground",
                                    )}>{v.source}</span>
                                    <span className="font-mono text-[10px] text-muted-foreground">{v.vId?.slice(0, 8)}</span>
                                    {v.createdAt && (
                                      <span className="text-[10px] text-muted-foreground/70 hidden md:inline">
                                        {new Date(v.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}
                                      </span>
                                    )}
                                  </div>
                                  {(v.message || v.reason) && (
                                    <p className="text-muted-foreground text-[11px] mt-0.5 truncate">{v.message || v.reason}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-0.5 shrink-0">
                                  <button
                                    className="text-[10px] text-muted-foreground hover:text-primary px-1 py-0.5 rounded hover:bg-primary/5"
                                    title="查看该版本 Prompt 内容"
                                    disabled={comparing !== null}
                                    onClick={() => handlePreview(s.id, s.name, v.vId, v.message)}
                                  >查看</button>
                                  <button
                                    className="text-[10px] text-muted-foreground hover:text-primary px-1 py-0.5 rounded hover:bg-primary/5 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="与当前版本对比 diff"
                                    disabled={comparing === v.vId}
                                    onClick={() => handleCompare(s.id, s.name, v.vId)}
                                  >{comparing === v.vId ? "加载中..." : "对比"}</button>
                                  <button
                                    className="text-[10px] text-primary px-1 py-0.5 rounded hover:bg-primary/10 font-medium disabled:opacity-50"
                                    title="回滚到该版本"
                                    disabled={comparing !== null}
                                    onClick={() => handleRollback(s.id, s.name, v.vId)}
                                  >回滚</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Prompt A/B */}
        <TabsContent value="ab" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">Prompt A/B 测试</h3>
              <p className="text-xs text-muted-foreground mt-1">对 Skill 或 Planner 的两个 Prompt 版本做分流测试，基于通过率 / CSAT / 延迟自动决出赢家</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                运行中 {abTests.filter(t => t.status === "running").length}
              </Badge>
              <Badge variant="outline" className="text-xs">
                已结束 {abTests.filter(t => t.status === "completed").length}
              </Badge>
              <Button size="sm" variant="outline" onClick={loadAbTests} disabled={loadingAb}>刷新</Button>
              <Button size="sm" onClick={() => {
                setAbForm({
                  name: "",
                  targetType: "skill",
                  targetId: "",
                  targetName: "",
                  variantALabel: "A：当前版本（基线）",
                  variantBLabel: "B：新版本（实验）",
                  trafficSplit: 50,
                  goal: "",
                });
                setAbCreateOpen(true);
              }}>+ 新建实验</Button>
            </div>
          </div>

          {abTests.length === 0 && !loadingAb && (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
              暂无实验，点击右上角「+ 新建实验」创建第一个 A/B 测试。
            </CardContent></Card>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {abTests.map((t) => {
              const m = t.metrics;
              const statusBadge = t.status === "running"
                ? <Badge className="bg-success/10 text-success border-success/30">● 运行中</Badge>
                : t.status === "completed"
                  ? <Badge className="bg-primary/10 text-primary border-primary/30">已结束</Badge>
                  : t.status === "paused"
                    ? <Badge variant="outline" className="text-amber-600 border-amber-300">已暂停</Badge>
                    : <Badge variant="outline">草稿</Badge>;
              const aLead = m.aPassRate > 0 && m.bPassRate > 0 && m.aPassRate > m.bPassRate;
              const bLead = m.aPassRate > 0 && m.bPassRate > 0 && m.bPassRate > m.aPassRate;
              const diffPct = m.aPassRate > 0 && m.bPassRate > 0 ? Math.round((Math.max(m.aPassRate, m.bPassRate) - Math.min(m.aPassRate, m.bPassRate)) * 100) : 0;
              return (
                <Card key={t.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-sm flex items-center gap-2">
                          {t.name}
                          {statusBadge}
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">
                          目标：{t.targetType === "skill" ? "Skill" : "Planner"} · {t.targetName || t.targetId} · 流量 {t.trafficSplit}% 分流
                        </CardDescription>
                      </div>
                      {t.winner && (
                        <Badge className="shrink-0 bg-success text-white">
                          赢家 {t.winner}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">目标：{t.goal}</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* 核心指标对比 */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className={cn(
                        "rounded-lg border p-2.5",
                        aLead && !bLead ? "border-success/40 bg-success/5" : "border-border"
                      )}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium">{t.variantALabel}</span>
                          {aLead && !bLead && <span className="text-[10px] text-success">领先 +{diffPct}%</span>}
                        </div>
                        <div className="text-xl font-bold tabular-nums mt-1">{m.aCount > 0 ? Math.round(m.aPassRate * 100) : 0}%</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 grid grid-cols-3 gap-1">
                          <span>n={m.aCount}</span>
                          <span>{m.aAvgScore.toFixed(1)}分</span>
                          <span>{m.aAvgLatencyMs}ms</span>
                        </div>
                      </div>
                      <div className={cn(
                        "rounded-lg border p-2.5",
                        bLead && !aLead ? "border-success/40 bg-success/5" : "border-border"
                      )}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium">{t.variantBLabel}</span>
                          {bLead && !aLead && <span className="text-[10px] text-success">领先 +{diffPct}%</span>}
                        </div>
                        <div className="text-xl font-bold tabular-nums mt-1">{m.bCount > 0 ? Math.round(m.bPassRate * 100) : 0}%</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 grid grid-cols-3 gap-1">
                          <span>n={m.bCount}</span>
                          <span>{m.bAvgScore.toFixed(1)}分</span>
                          <span>{m.bAvgLatencyMs}ms</span>
                        </div>
                      </div>
                    </div>

                    {/* 置信度 */}
                    {t.status === "running" && m.aCount + m.bCount > 0 && (
                      <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                        <span>置信度 {(t.confidence * 100).toFixed(0)}%</span>
                        <span>
                          {t.confidence >= 0.95 ? "结论可靠，可以宣布赢家" : t.confidence >= 0.8 ? "趋势明显，继续累积样本" : "数据不显著，继续观察"}
                        </span>
                      </div>
                    )}

                    {/* 额外指标：接管率 */}
                    {m.aHandoffRate !== undefined && m.bHandoffRate !== undefined && (
                      <div className="text-[11px] text-muted-foreground rounded bg-muted/40 p-2">
                        人工接管率：A {(m.aHandoffRate * 100).toFixed(0)}% / B {(m.bHandoffRate * 100).toFixed(0)}%
                      </div>
                    )}

                    {/* 结论 / 暂停原因 */}
                    {t.conclusion && (
                      <div className="text-xs rounded bg-success/5 border border-success/20 text-success p-2">
                        {t.conclusion}
                      </div>
                    )}
                    {t.pauseReason && (
                      <div className="text-xs rounded bg-amber-50 border border-amber-200 text-amber-700 p-2">
                        暂停原因：{t.pauseReason}
                      </div>
                    )}

                    {/* 时间 */}
                    <div className="text-[11px] text-muted-foreground flex items-center gap-3">
                      {t.startedAt && <span>开始：{new Date(t.startedAt).toLocaleDateString("zh-CN")}</span>}
                      {t.endedAt && <span>结束：{new Date(t.endedAt).toLocaleDateString("zh-CN")}</span>}
                      {!t.startedAt && <span>尚未启动</span>}
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setAbDetailTest(t)}>查看详情</Button>
                      {t.status === "running" && (
                        <>
                          <Button size="sm" variant="outline" className="text-xs h-7"
                            disabled={abSimulating === t.id}
                            onClick={() => handleSimulateAb(t.id, 50)}
                          >{abSimulating === t.id ? "注入中..." : "🎲 模拟+50"}</Button>
                          <Button size="sm" variant="ghost" className="text-xs h-7 px-2"
                            disabled={abSimulating === t.id}
                            onClick={() => handleSimulateAb(t.id, 200)}
                            title="一次性注入 200 个样本快速看到显著差异"
                          >+200</Button>
                          <Button size="sm" variant="outline" className="text-xs h-7" onClick={async () => {
                            await fetch("/api/ab-tests", {
                              method: "PATCH", headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: t.id, status: "paused" }),
                            });
                            toast.success("已暂停实验");
                            loadAbTests();
                          }}>暂停</Button>
                          {t.confidence >= 0.9 && bLead && (
                            <Button size="sm" className="text-xs h-7" onClick={async () => {
                              await fetch("/api/ab-tests", {
                                method: "PATCH", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: t.id, status: "completed", winner: "B" }),
                              });
                              toast.success("已宣布 B 为赢家");
                              loadAbTests();
                            }}>宣布 B 胜出</Button>
                          )}
                          {t.confidence >= 0.9 && aLead && (
                            <Button size="sm" className="text-xs h-7" onClick={async () => {
                              await fetch("/api/ab-tests", {
                                method: "PATCH", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: t.id, status: "completed", winner: "A" }),
                              });
                              toast.success("已宣布 A 为赢家");
                              loadAbTests();
                            }}>宣布 A 胜出</Button>
                          )}
                        </>
                      )}
                      {t.status === "paused" && (
                        <Button size="sm" variant="outline" className="text-xs h-7" onClick={async () => {
                          await fetch("/api/ab-tests", {
                            method: "PATCH", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ id: t.id, status: "running" }),
                          });
                          toast.success("已恢复实验");
                          loadAbTests();
                        }}>恢复</Button>
                      )}
                      {t.status === "draft" && (
                        <Button size="sm" className="text-xs h-7" onClick={async () => {
                          await fetch("/api/ab-tests", {
                            method: "PATCH", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ id: t.id, status: "running" }),
                          });
                          toast.success("实验已启动");
                          loadAbTests();
                        }}>启动实验</Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {reviewingAnnotation && (
        <Dialog open={true} onOpenChange={(o) => !o && (setReviewingAnnotation(null), setReviewNote(""))}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>批注「{reviewingAnnotation.runId}」</DialogTitle>
              <DialogDescription>输入审核备注（拒绝原因/补充说明），状态会设为 rejected。</DialogDescription>
            </DialogHeader>
            <Textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="例：回复出现 100% 绝对化承诺，违反广告法；正确话术：我帮您查下售后政策"
              rows={5}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setReviewingAnnotation(null); setReviewNote(""); }}>取消</Button>
              <Button variant="destructive" onClick={handleRejectWithNote}>确认驳回</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {replayQuestion && (
        <Dialog open={true} onOpenChange={(o) => !o && setReplayQuestion("")}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>重跑此问题</DialogTitle>
              <DialogDescription>把原问题原样发送给客服 Agent，对比新旧回复。新 run 会进入运行监控。</DialogDescription>
            </DialogHeader>
            <div className="text-sm bg-muted p-3 rounded">
              <div className="text-muted-foreground text-xs mb-1">原始问题</div>
              <div>{replayQuestion}</div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setReplayQuestion("")}>取消</Button>
              <Button onClick={handleReplay} disabled={replaying}>
                {replaying ? "重跑中…" : "发送并重跑"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 版本预览 */}
      {versionPreview && (
        <Dialog open={true} onOpenChange={(o) => !o && setVersionPreview(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                📄 {versionPreview.skillName} · 版本 {versionPreview.vId.slice(0, 8)}
                {versionPreview.message && <span className="text-xs font-normal text-muted-foreground">- {versionPreview.message}</span>}
              </DialogTitle>
              <DialogDescription>该版本保存时的 SKILL.md 完整 Prompt 内容</DialogDescription>
            </DialogHeader>
            <pre className="text-xs bg-muted rounded p-3 overflow-auto whitespace-pre-wrap flex-1 font-mono leading-relaxed">{versionPreview.body}</pre>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                navigator.clipboard?.writeText(versionPreview.body);
                toast.success("已复制到剪贴板");
              }}>复制内容</Button>
              <Button onClick={() => setVersionPreview(null)}>关闭</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 版本测试结果 */}
      {versionTestResult && (
        <Dialog open={true} onOpenChange={(o) => !o && setVersionTestResult(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>🧪 版本 {versionTestResult.vId.slice(0, 8)} 快速测试结果</DialogTitle>
              <DialogDescription>用通用样例输入调用该 Skill，输出如下（非完整回归）</DialogDescription>
            </DialogHeader>
            <pre className="text-xs bg-muted rounded p-3 overflow-auto whitespace-pre-wrap flex-1 font-mono">{versionTestResult.output}</pre>
            <DialogFooter>
              <Button onClick={() => setVersionTestResult(null)}>关闭</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 版本对比 */}
      {versionCompare && (
        <Dialog open={true} onOpenChange={(o) => !o && setVersionCompare(null)}>
          <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>🔀 版本对比 · {versionCompare.skillName}</DialogTitle>
              <DialogDescription>
                <span className="text-success">当前（新）{versionCompare.aId === "current" ? "（工作区最新内容）" : versionCompare.aId.slice(0, 8)}</span>
                {" vs "}
                <span className="text-amber-600">历史版本 {versionCompare.bId.slice(0, 8)}</span>
                {" · "}
                <span className="text-emerald-600">+{versionCompareDiff?.stats.add ?? 0} 新增</span>
                {" / "}
                <span className="text-rose-600">-{versionCompareDiff?.stats.del ?? 0} 删除</span>
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2 flex-1 overflow-hidden">
              <div className="flex flex-col overflow-hidden">
                <div className="text-xs font-medium text-success mb-1">当前（新）</div>
                <div className="text-xs bg-success/5 border border-success/20 rounded p-2 overflow-auto font-mono flex-1 leading-relaxed">
                  {versionCompareDiff!.aLines.map((ln, idx) => (
                    <div
                      key={idx}
                      className={
                        ln.tag === "del"
                          ? "bg-rose-100 text-rose-800 rounded-sm px-1 -mx-1 my-0.5 line-through decoration-rose-500/60"
                          : ln.tag === "add"
                          ? "bg-emerald-100 text-emerald-800 rounded-sm px-1 -mx-1 my-0.5"
                          : ""
                      }
                    >
                      <span className="select-none text-muted-foreground/40 inline-block w-8 text-right mr-2 text-[10px]">{idx + 1}</span>
                      {ln.text || "\u00A0"}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col overflow-hidden">
                <div className="text-xs font-medium text-amber-600 mb-1">历史（旧）</div>
                <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2 overflow-auto font-mono flex-1 leading-relaxed">
                  {versionCompareDiff!.bLines.map((ln, idx) => (
                    <div
                      key={idx}
                      className={
                        ln.tag === "add"
                          ? "bg-rose-100 text-rose-800 rounded-sm px-1 -mx-1 my-0.5 line-through decoration-rose-500/60"
                          : ln.tag === "del"
                          ? "bg-emerald-100 text-emerald-800 rounded-sm px-1 -mx-1 my-0.5"
                          : ""
                      }
                    >
                      <span className="select-none text-muted-foreground/40 inline-block w-8 text-right mr-2 text-[10px]">{idx + 1}</span>
                      {ln.text || "\u00A0"}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-300" />绿色高亮 = 新增/变更</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-rose-100 border border-rose-300" />红色删除线 = 已删除</span>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                navigator.clipboard?.writeText(versionCompare.b);
                toast.success("已复制旧版本内容");
              }}>复制旧版</Button>
              <Button variant="destructive" onClick={() => {
                handleRollback(versionCompare.skillId, versionCompare.skillName, versionCompare.bId);
                setVersionCompare(null);
              }}>确认回滚到此版本</Button>
              <Button onClick={() => setVersionCompare(null)}>关闭</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {/* 评测用例新增/编辑 Dialog */}
      <Dialog open={!!editingCase} onOpenChange={(o) => { if (!o) { setEditingCase(null); setEditingCaseNew(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingCaseNew ? "新增评测用例" : "编辑评测用例"}</DialogTitle>
          </DialogHeader>
          {editingCase && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">用例名称</Label>
                <Input value={editingCase.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditingCase({ ...editingCase, name: e.target.value })} placeholder="如：麻辣零食30元预算推荐" />
              </div>
              <div>
                <Label className="text-xs">用户问题（必填）</Label>
                <Textarea className="min-h-[80px]"
                  value={editingCase.question} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditingCase({ ...editingCase, question: e.target.value })}
                  placeholder="模拟用户会说的话" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">期望关键词（逗号分隔）</Label>
                  <Input value={(editingCase.expectedKeywords || []).join(",")}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditingCase({ ...editingCase, expectedKeywords: e.target.value.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean) })}
                    placeholder="麻辣,30元,每日坚果" />
                </div>
                <div>
                  <Label className="text-xs">期望提及价格（元，可空）</Label>
                  <Input type="number" value={editingCase.expectedPrice ?? ""}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditingCase({ ...editingCase, expectedPrice: e.target.value ? Number(e.target.value) : null })}
                    placeholder="如 30" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">风控期望</Label>
                  <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    value={editingCase.expectRiskPassed === undefined ? "" : String(editingCase.expectRiskPassed)}
                    onChange={(e) => setEditingCase({ ...editingCase, expectRiskPassed: e.target.value === "" ? undefined : e.target.value === "true" })}>
                    <option value="">不检查</option>
                    <option value="true">期望通过</option>
                    <option value="false">期望被拦截（红线问题）</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">启用</Label>
                  <div className="flex items-center h-9 gap-2">
                    <Switch checked={editingCase.enabled} onCheckedChange={(v) => setEditingCase({ ...editingCase, enabled: v })} />
                    <span className="text-xs text-muted-foreground">{editingCase.enabled ? "参与评测" : "暂不评测"}</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">必经能力（逗号分隔 skill/tool id）</Label>
                  <Input value={(editingCase.requiredCapabilities || []).join(",")}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditingCase({ ...editingCase, requiredCapabilities: e.target.value.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean) })}
                    placeholder="如 query_products,risk-check" />
                </div>
                <div>
                  <Label className="text-xs">禁用能力（不能调用的）</Label>
                  <Input value={(editingCase.forbiddenCapabilities || []).join(",")}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditingCase({ ...editingCase, forbiddenCapabilities: e.target.value.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean) })}
                    placeholder="如 human-handoff" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => { setEditingCase(null); setEditingCaseNew(false); }}>取消</Button>
                <Button onClick={saveEditingCase} disabled={!editingCase.question.trim()}>保存</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* A/B 测试：新建实验 */}
      <Dialog open={abCreateOpen} onOpenChange={setAbCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新建 A/B 实验</DialogTitle>
            <DialogDescription>
              选择一个 Skill 或 Planner，配置两个 Prompt 版本进行分流测试。新建后默认是「草稿」状态，可在卡片上点"启动"开始分流。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">实验名称 *</Label>
              <Input placeholder="如：开场白：热情 vs 克制" value={abForm.name} onChange={e => setAbForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">实验目标类型 *</Label>
                <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={abForm.targetType}
                  onChange={e => setAbForm(f => ({ ...f, targetType: e.target.value as any, targetId: "", targetName: "" }))}>
                  <option value="skill">Skill（具体技能）</option>
                  <option value="planner">Planner（总规划）</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">实验目标 *</Label>
                <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={abForm.targetId}
                  onChange={e => {
                    const opt = e.target.selectedOptions[0];
                    setAbForm(f => ({ ...f, targetId: e.target.value, targetName: opt?.label || e.target.value }));
                  }}>
                  <option value="">请选择…</option>
                  {abForm.targetType === "planner" ? (
                    <option value="main-planner">Planner（主流程规划）</option>
                  ) : skills.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">A 版本标签 *</Label>
                <Input value={abForm.variantALabel} onChange={e => setAbForm(f => ({ ...f, variantALabel: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">B 版本标签 *</Label>
                <Input value={abForm.variantBLabel} onChange={e => setAbForm(f => ({ ...f, variantBLabel: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">流量分配（B 版本占比）：{abForm.trafficSplit}%</Label>
              <input type="range" min={5} max={95} step={5} value={abForm.trafficSplit}
                onChange={e => setAbForm(f => ({ ...f, trafficSplit: Number(e.target.value) }))}
                className="w-full" />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>A 版本 {100 - abForm.trafficSplit}%</span>
                <span>B 版本 {abForm.trafficSplit}%</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">实验目标/假设</Label>
              <Textarea rows={2} placeholder="如：新开场白期望降低风控拦截率、提升 CSAT 0.3 分"
                value={abForm.goal} onChange={e => setAbForm(f => ({ ...f, goal: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAbCreateOpen(false)}>取消</Button>
            <Button size="sm" disabled={abSaving || !abForm.name || !abForm.targetId} onClick={async () => {
              setAbSaving(true);
              try {
                const r = await fetch("/api/ab-tests", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(abForm),
                });
                if (r.ok) {
                  toast.success("实验已创建（草稿状态，点卡片上的启动开始分流）");
                  setAbCreateOpen(false);
                  loadAbTests();
                } else {
                  const j = await r.json().catch(() => ({}));
                  toast.error("创建失败：" + (j.error || r.statusText));
                }
              } finally { setAbSaving(false); }
            }}>{abSaving ? "保存中..." : "创建实验（草稿）"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* A/B 测试：查看详情 */}
      <Dialog open={!!abDetailTest} onOpenChange={o => !o && setAbDetailTest(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          {abDetailTest && (() => {
            const t = abDetailTest; const m = t.metrics;
            const statRow = (label: string, a: any, b: any, better?: "a" | "b" | "higher" | "lower") => {
              const aBetter = better === "higher" ? a > b : better === "lower" ? a < b : better === "a";
              const bBetter = better === "higher" ? b > a : better === "lower" ? b < a : better === "b";
              return (
                <div className="grid grid-cols-3 gap-2 py-1.5 border-b border-border/60 text-sm">
                  <div className="text-muted-foreground">{label}</div>
                  <div className={cn("tabular-nums text-center", aBetter && "text-success font-semibold")}>{a}</div>
                  <div className={cn("tabular-nums text-center", bBetter && "text-success font-semibold")}>{b}</div>
                </div>
              );
            };
            const pct = (v: number) => (v > 0 ? Math.round(v * 100) + "%" : "—");
            const dec1 = (v: number) => (v > 0 ? v.toFixed(1) : "—");
            return (<>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {t.name}
                  {t.status === "running" && <Badge className="bg-success/10 text-success border-success/30">● 运行中</Badge>}
                  {t.status === "completed" && <Badge className="bg-primary/10 text-primary border-primary/30">已结束</Badge>}
                  {t.status === "paused" && <Badge variant="outline" className="text-amber-600 border-amber-300">已暂停</Badge>}
                  {t.status === "draft" && <Badge variant="outline">草稿</Badge>}
                  {t.winner && <Badge className="bg-success text-white">赢家 {t.winner}</Badge>}
                </DialogTitle>
                <DialogDescription>
                  目标：{t.targetType === "skill" ? "Skill" : "Planner"} · {t.targetName || t.targetId} · B 版本流量 {t.trafficSplit}%
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                {t.status === "running" && (m.aCount + m.bCount === 0) && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
                    <span>ℹ️</span>
                    <div className="flex-1">
                      <p className="font-medium">实验已启动，等待流量进入</p>
                      <p className="text-xs mt-1 text-amber-700">演示环境没有线上流量接入，可点击下方「🎲 注入模拟流量」快速生成样本看对比效果。真实部署接入 Agent pipeline 后会自动累积线上样本。</p>
                    </div>
                  </div>
                )}
                {(t as any)._autoHint && (
                  <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success flex items-start gap-2">
                    <span>✨</span>
                    <div>
                      <p className="font-medium">{(t as any)._autoHint}</p>
                      <p className="text-xs mt-0.5 opacity-80">可在卡片底部手动宣布赢家结束实验</p>
                    </div>
                  </div>
                )}
                {t.status === "draft" && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
                    <span>📝</span>
                    <div className="flex-1">
                      <p className="font-medium">当前是草稿状态</p>
                      <p className="text-xs mt-1 text-amber-700">确认配置无误后点击下方「▶ 启动分流」开始实验，之后可注入模拟流量或接入线上流量。</p>
                    </div>
                  </div>
                )}
                <div className="rounded-lg border p-3 bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-1">实验假设/目标</p>
                  <p className="text-sm">{t.goal || "（未填写）"}</p>
                  {t.conclusion && (<>
                    <p className="text-xs text-muted-foreground mt-3 mb-1">实验结论</p>
                    <p className="text-sm text-success">{t.conclusion}</p>
                  </>)}
                </div>

                <div>
                  <div className="grid grid-cols-3 gap-2 pb-2 border-b text-xs text-muted-foreground">
                    <div>指标</div>
                    <div className="text-center">{t.variantALabel}</div>
                    <div className="text-center">{t.variantBLabel}</div>
                  </div>
                  {statRow("样本量 n", m.aCount || "—", m.bCount || "—")}
                  {statRow("通过率", pct(m.aPassRate), pct(m.bPassRate), "higher")}
                  {statRow("平均 CSAT", dec1(m.aAvgScore), dec1(m.bAvgScore), "higher")}
                  {statRow("平均延迟 (ms)", m.aAvgLatencyMs || "—", m.bAvgLatencyMs || "—", "lower")}
                  {statRow("平均 token", m.aAvgTokens || "—", m.bAvgTokens || "—", "lower")}
                  {statRow("人工接管率", m.aHandoffRate != null ? pct(m.aHandoffRate) : "—", m.bHandoffRate != null ? pct(m.bHandoffRate) : "—", "lower")}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border p-2.5">
                    <div className="text-muted-foreground">统计置信度</div>
                    <div className={cn("text-lg font-bold mt-1", t.confidence >= 0.9 ? "text-success" : "text-amber-600")}>
                      {t.confidence > 0 ? Math.round(t.confidence * 100) + "%" : "—"}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {t.confidence >= 0.95 ? "结果高度显著，可定胜负" : t.confidence >= 0.9 ? "趋势明显，建议继续累积样本" : t.confidence > 0 ? "样本量不足，继续收集" : "尚未开始分流"}
                    </div>
                  </div>
                  <div className="rounded-lg border p-2.5">
                    <div className="text-muted-foreground">时间</div>
                    <div className="text-sm mt-1">开始：{t.startedAt ? new Date(t.startedAt).toLocaleString("zh-CN") : "尚未启动"}</div>
                    {t.pausedAt && <div className="text-sm text-amber-600">暂停：{new Date(t.pausedAt).toLocaleString("zh-CN")}{t.pauseReason ? `（${t.pauseReason}）` : ""}</div>}
                    {t.endedAt && <div className="text-sm text-primary">结束：{new Date(t.endedAt).toLocaleString("zh-CN")}</div>}
                  </div>
                </div>

                {t.status === "draft" && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                    <b>草稿提示</b>：在下方点「▶ 启动分流」即可开始。
                  </div>
                )}
              </div>
              <DialogFooter className="gap-2">
                {t.status === "running" && (
                  <Button size="sm" variant="secondary" disabled={!!abSimulating} onClick={() => handleSimulateAb(t.id!, 50)}>
                    {abSimulating ? "注入中..." : "🎲 注入50个样本"}
                  </Button>
                )}
                {t.status === "draft" && (
                  <Button size="sm" onClick={async () => {
                    const r = await fetch("/api/ab-tests", {
                      method: "PATCH", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id: t.id, status: "running" }),
                    });
                    if (r.ok) { toast.success("已启动分流"); loadAbTests(); setAbDetailTest(null); }
                    else toast.error("启动失败");
                  }}>▶ 启动分流</Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setAbDetailTest(null)}>关闭</Button>
              </DialogFooter>
            </>);
          })()}
        </DialogContent>
      </Dialog>

      {/* 评测单条测试结果已经直接在卡片内展开（回复+检查项+步骤明细），无额外页面 */}
    </div>
  );
}

function MetricCard({ label, value, tone = "default" }: { label: string; value: any; tone?: "default" | "success" | "danger" | "warning" }) {
  const toneCls = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : tone === "warning" ? "text-amber-600" : "";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold tabular-nums mt-1 ${toneCls}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function SuggestionCard({ title, count, color, suggestion }: { title: string; count: number; color: "danger" | "warning" | "success"; suggestion: string }) {
  const cls = color === "danger" ? "border-danger/40 bg-danger/5" : color === "warning" ? "border-amber-300 bg-amber-50" : "border-success/40 bg-success/5";
  const badge = color === "danger" ? "bg-danger text-white" : color === "warning" ? "bg-amber-500 text-white" : "bg-success text-white";
  return (
    <div className={`border rounded-lg p-3 ${cls}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`px-2 py-0.5 rounded text-xs ${badge}`}>{count}</span>
        <b className="text-sm">{title}</b>
      </div>
      <p className="text-xs text-muted-foreground ml-10">{suggestion}</p>
    </div>
  );
}
