"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, XCircle, Loader2, AlertTriangle, Clock, User, Bot, Tag, ShieldAlert, Play, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StepRecord {
  stepIndex: number;
  type: "skill" | "tool";
  ref: string;
  refName: string;
  description: string;
  status: "pending" | "running" | "success" | "failed" | "skipped" | "degraded" | "error";
  input: unknown;
  output?: unknown;
  error?: string | null;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  thinking?: string;
}
interface RiskIssue { type: string; detail: string; severity?: "warning" | "blocker" }
interface RiskResult {
  passed: boolean;
  riskLevel: "low" | "medium" | "high";
  issues: RiskIssue[];
  suggestedFix?: string;
}
interface RunRecord {
  runId: string;
  source: "user" | "demo" | "eval" | "replay" | "annotation";
  userQuestion?: string;
  question?: string;
  plan: any;
  steps?: StepRecord[];
  trace?: StepRecord[];
  finalReply?: string;
  reasoning?: string;
  risk?: RiskResult | null;
  riskResult?: RiskResult | null;
  error?: string | null;
  startedAt: string;
  finishedAt?: string;
  durationMs: number;
  status: "running" | "success" | "failed" | "risk_blocked" | "error" | "risk_failed";
  tags?: string[];
  skillsUsed?: string[];
  toolsUsed?: string[];
  handoffToHuman?: boolean;
  handoffReason?: string;
  clarificationQuestion?: string | null;
}

const statusMeta: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  success: { label: "成功", className: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  running: { label: "执行中", className: "bg-blue-50 text-blue-700 border-blue-200", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  failed: { label: "失败", className: "bg-red-50 text-red-700 border-red-200", icon: <XCircle className="h-3.5 w-3.5" /> },
  risk_blocked: { label: "风控拦截", className: "bg-amber-50 text-amber-700 border-amber-200", icon: <ShieldAlert className="h-3.5 w-3.5" /> },
  risk_failed: { label: "风控未通过", className: "bg-amber-50 text-amber-700 border-amber-200", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  error: { label: "错误", className: "bg-red-50 text-red-700 border-red-200", icon: <XCircle className="h-3.5 w-3.5" /> },
};

function JsonBlock({ data }: { data: unknown }) {
  const text = data == null ? "" : typeof data === "string" ? data : JSON.stringify(data, null, 2);
  if (!text) return <span className="text-muted-foreground text-xs italic">(空)</span>;
  return (
    <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-auto max-h-80 leading-relaxed whitespace-pre-wrap break-all">
      {text}
    </pre>
  );
}

function fmtTime(ts?: string) {
  if (!ts) return "-";
  try {
    const d = new Date(ts);
    return d.toLocaleString("zh-CN", { hour12: false });
  } catch { return ts; }
}
function fmtDur(ms?: number) {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  const [replaying, setReplaying] = useState(false);

  async function fetchRun(id: string) {
    setLoading(true);
    setNotFound(false);
    try {
      const r = await fetch(`/api/runs/${id}`, { cache: "no-store" });
      if (!r.ok) {
        if (r.status === 404) setNotFound(true);
        throw new Error(`HTTP ${r.status}`);
      }
      const d = await r.json();
      setRun(d.run);
    } catch {
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    params.then(({ runId }) => {
      if (cancelled) return;
      setRunId(runId);
      fetchRun(runId);
    });
    return () => { cancelled = true; };
  }, [params]);

  async function handleReplay() {
    if (!run || replaying) return;
    setReplaying(true);
    try {
      const r = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: run.question || run.userQuestion, source: (run.source || "run-replay") + ":replay", conversationId: "run-replay-" + run.runId }),
      });
      if (!r.ok || !r.body) {
        alert("重跑失败：HTTP " + r.status);
        return;
      }
      // 读完整 SSE 流直到 done
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let lastDoneData: any = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const events = text.split(/\r?\n\r?\n/);
        for (const ev of events) {
          const lines = ev.split(/\r?\n/);
          let dataStr = "";
          let evName = "";
          for (const ln of lines) {
            if (ln.startsWith("event:")) evName = ln.slice(6).trim();
            else if (ln.startsWith("data:")) dataStr += ln.slice(5).trim();
          }
          if (!dataStr) continue;
          try {
            const obj = JSON.parse(dataStr);
            if (evName === "done" || obj.runId) lastDoneData = obj;
          } catch {}
        }
      }
      if (lastDoneData?.runId) {
        window.location.href = `/runs/${lastDoneData.runId}`;
      } else {
        alert("重跑结束但未拿到 runId");
      }
    } catch (e: any) {
      alert("重跑异常：" + (e?.message || String(e)));
    } finally {
      setReplaying(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />加载中...</div>;
  }
  if (notFound || !run || !runId) {
    return (
      <div className="p-8 space-y-4">
        <Link href="/ops" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> 返回运营中心
        </Link>
        <div className="text-center py-20">
          <h1 className="text-4xl font-bold mb-2">404</h1>
          <p className="text-muted-foreground mb-4">找不到 Run：{runId}</p>
          <p className="text-xs text-muted-foreground">该运行记录可能已被删除，或 runId 无效。</p>
        </div>
      </div>
    );
  }

  const sm = statusMeta[run.status] || statusMeta.error;
  const risk = run.risk || run.riskResult;
  const question = run.question || run.userQuestion || "";

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between">
        <Link href="/ops" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> 返回运营中心
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={handleReplay} disabled={replaying}>
            <Play className={`h-3.5 w-3.5 ${replaying ? "animate-spin" : ""}`} />
            {replaying ? "重跑中..." : "用相同问题重跑"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => runId && fetchRun(runId)}>
            <RefreshCw className="h-3.5 w-3.5" /> 刷新
          </Button>
          <Badge variant="outline" className={`inline-flex items-center gap-1 ${sm.className}`}>
            {sm.icon} {sm.label}
          </Badge>
        </div>
      </div>

      {/* 标题卡 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <CardTitle className="text-lg flex items-center gap-2">
                Run 详情
                <code className="text-xs font-mono text-muted-foreground font-normal">{run.runId}</code>
              </CardTitle>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtTime(run.startedAt)}</span>
                <span>耗时 <b className="text-foreground">{fmtDur(run.durationMs)}</b></span>
                <Badge variant="outline" className="text-xs">{run.source}</Badge>
                {run.tags && run.tags.length > 0 && (
                  <span className="inline-flex items-center gap-1"><Tag className="h-3 w-3" />{run.tags.join(", ")}</span>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 用户问题 */}
          <div className="rounded-lg border bg-orange-50/40 p-4">
            <div className="flex items-start gap-2 text-sm">
              <User className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground mb-1">用户问题</div>
                <div className="text-foreground whitespace-pre-wrap">{question || "(无问题内容)"}</div>
              </div>
            </div>
          </div>

          {/* AI 最终回复 */}
          {run.finalReply && (
            <div className="rounded-lg border bg-primary/5 p-4">
              <div className="flex items-start gap-2 text-sm">
                <Bot className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground mb-1">AI 最终回复</div>
                  <div className="text-foreground whitespace-pre-wrap leading-relaxed">{run.finalReply}</div>
                </div>
              </div>
            </div>
          )}

          {/* 澄清问题 */}
          {run.clarificationQuestion && (
            <div className="rounded-lg border bg-blue-50/40 p-4">
              <div className="text-xs text-blue-700 mb-1 font-medium">澄清问题</div>
              <div className="text-sm">{run.clarificationQuestion}</div>
            </div>
          )}

          {/* 错误 */}
          {run.error && (
            <div className="rounded-lg border bg-red-50 p-4">
              <div className="text-xs text-red-700 mb-1 font-medium inline-flex items-center gap-1">
                <XCircle className="h-3.5 w-3.5" /> 错误
              </div>
              <div className="text-sm text-red-900 whitespace-pre-wrap">{run.error}</div>
            </div>
          )}

          {/* 风控结果 */}
          {risk && (
            <div className={`rounded-lg border p-4 ${
              risk.passed ? "bg-emerald-50/40 border-emerald-200" : "bg-amber-50/40 border-amber-200"
            }`}>
              <div className="flex items-center gap-2 text-sm mb-2">
                <ShieldAlert className={`h-4 w-4 ${risk.passed ? "text-emerald-600" : "text-amber-600"}`} />
                <span className="font-medium">风控审核</span>
                <Badge variant="outline" className={`text-xs ${
                  risk.passed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                }`}>{risk.passed ? "通过" : `未通过 (${risk.riskLevel})`}</Badge>
              </div>
              {risk.issues && risk.issues.length > 0 && (
                <ul className="text-sm space-y-1 pl-6 list-disc">
                  {risk.issues.map((i, idx) => (
                    <li key={idx} className="text-foreground/90">
                      <span className="text-xs text-muted-foreground">[{i.severity || "warning"}·{i.type}]</span> {i.detail}
                    </li>
                  ))}
                </ul>
              )}
              {risk.suggestedFix && (
                <div className="mt-2 text-xs text-amber-700 bg-amber-100/50 rounded p-2">建议：{risk.suggestedFix}</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 执行步骤 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            执行步骤 <span className="text-xs font-normal text-muted-foreground">({(run.trace ?? run.steps ?? []).length} 步)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(run.trace ?? run.steps ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground italic">(无步骤记录)</p>
          )}
          {(run.trace ?? run.steps ?? []).map((step, idx) => {
            const expanded = expandedSteps[idx] ?? (step.status === "failed" || step.status === "error");
            const toggle = () => setExpandedSteps((s) => ({ ...s, [idx]: !expanded }));
            const stepStatus = statusMeta[step.status] || statusMeta.running;
            return (
              <div key={idx} className="border rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={toggle}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30 transition"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-mono text-muted-foreground w-6 text-right shrink-0">
                      {step.stepIndex}
                    </span>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${
                      step.type === "skill" ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-sky-50 text-sky-700 border-sky-200"
                    }`}>{step.type === "skill" ? "Skill" : "Tool"}</Badge>
                    <span className={`inline-flex items-center gap-1 text-xs ${stepStatus.className} border rounded px-1.5 py-0.5 shrink-0`}>
                      {stepStatus.icon}{stepStatus.label}
                    </span>
                    <span className="font-medium text-sm truncate">{step.refName || step.ref}</span>
                    <span className="text-xs text-muted-foreground truncate hidden md:inline">{step.description}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{fmtDur(step.durationMs)}</span>
                </button>
                {expanded && (
                  <div className="border-t px-4 py-3 space-y-3 bg-muted/10">
                    {step.thinking && (
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">思考过程</div>
                        <pre className="text-xs bg-yellow-50/60 rounded-md p-2 whitespace-pre-wrap break-all leading-relaxed">
                          {step.thinking}
                        </pre>
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">输入</div>
                      <JsonBlock data={step.input} />
                    </div>
                    {step.output !== undefined && (
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">输出</div>
                        <JsonBlock data={step.output} />
                      </div>
                    )}
                    {step.error && (
                      <div>
                        <div className="text-xs font-medium text-red-700 mb-1 inline-flex items-center gap-1">
                          <XCircle className="h-3 w-3" />错误
                        </div>
                        <pre className="text-xs bg-red-50 text-red-900 rounded-md p-2 whitespace-pre-wrap break-all">
                          {step.error}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Plan */}
      {run.plan && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">执行计划 (Plan)</CardTitle>
          </CardHeader>
          <CardContent>
            <JsonBlock data={run.plan} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
