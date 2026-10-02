"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, RefreshCw, Send, UserRound } from "lucide-react";
import type { DraftCandidate } from "@/lib/store";

interface RunSummary {
  runId: string;
  question?: string;
  createdAt?: string;
  status?: string;
  handoffToHuman?: boolean;
  handoffReason?: string;
  selectedCandidateId?: string | null;
  sentAt?: string | null;
}

interface RunDetail extends RunSummary {
  draftCandidates?: DraftCandidate[];
  draftUsedFallback?: boolean;
  selectedBy?: string | null;
  selectedAt?: string | null;
  risk?: { passed?: boolean; riskLevel?: string; issues?: Array<{ type?: string; detail?: string } | string> };
}

const RISK_LABEL: Record<string, string> = { low: "低风险", medium: "需确认", high: "高风险" };

export default function HandoffPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [recent, setRecent] = useState<RunSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [operator, setOperator] = useState("演示坐席");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/runs?limit=200");
      const data = await res.json();
      const all: RunSummary[] = data.runs ?? data.list ?? [];
      setRuns(all.filter((r) => r.handoffToHuman));
      setRecent(all.filter((r) => !r.handoffToHuman).slice(0, 8));
    } catch {
      toast.error("加载会话列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
      const data = await res.json();
      setDetail(data.run ?? null);
    } catch {
      toast.error("加载会话详情失败");
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  /** 把某个会话标记为待人工（演示用：即使没有模型，也能造出待人工会话） */
  const markHandoff = async (runId: string, reason: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("已标记为待人工");
      await load();
      setSelectedId(runId);
    } catch {
      toast.error("标记失败");
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(selectedId)}/draft-candidates`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      toast.success(data.usedFallback ? "已用规则模板生成 3 条候选（未调用模型）" : "已生成 3 条候选");
      await loadDetail(selectedId);
      await load();
    } catch (e) {
      toast.error((e as Error).message || "生成候选失败");
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: "select" | "mark-sent", candidateId?: string) => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(selectedId)}/draft-candidates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, candidateId, operator }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      toast.success(action === "select" ? "已选定候选（尚未发送）" : "已由坐席标记发送");
      await loadDetail(selectedId);
      await load();
    } catch (e) {
      toast.error((e as Error).message || "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const pending = runs.filter((r) => !r.selectedCandidateId);
  const chosen = runs.filter((r) => r.selectedCandidateId);
  const sent = runs.filter((r) => r.sentAt);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <UserRound className="w-6 h-6 text-primary" />
            坐席工作台
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI 只起草候选话术，<span className="text-foreground font-medium">发送由坐席决定</span>——系统不会自动发出任何消息
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-semibold">{pending.length}</div>
            <div className="text-xs text-muted-foreground mt-1">待人工（未选择候选）</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-semibold">{chosen.length}</div>
            <div className="text-xs text-muted-foreground mt-1">已选候选（待发送）</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-semibold">{sent.length}</div>
            <div className="text-xs text-muted-foreground mt-1">坐席已标记发送</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* 待人工会话列表 */}
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">待人工会话</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <div className="text-sm text-muted-foreground py-6 text-center">加载中...</div>
            ) : runs.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4">
                暂无待人工会话。可在下方「最近会话」里把某个会话标记为待人工来演示。
              </div>
            ) : (
              <ul className="space-y-1.5">
                {runs.map((r) => (
                  <li key={r.runId}>
                    <button
                      onClick={() => setSelectedId(r.runId)}
                      className={`w-full text-left rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                        selectedId === r.runId ? "border-primary/50 bg-primary/[0.06]" : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-mono text-muted-foreground truncate">{r.runId}</span>
                        {r.sentAt ? (
                          <Badge variant="secondary" className="text-[10px]">坐席已发送</Badge>
                        ) : r.selectedCandidateId ? (
                          <Badge variant="secondary" className="text-[10px] bg-blue-100 text-blue-700">已选候选</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px]">待人工</Badge>
                        )}
                      </div>
                      <div className="truncate">{r.question ?? "（无问题文本）"}</div>
                      <div className="text-muted-foreground/80 truncate mt-0.5">原因：{r.handoffReason ?? "—"}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 候选与操作 */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">
                {detail ? `候选话术 · ${detail.runId}` : "候选话术"}
              </CardTitle>
              {detail && (
                <div className="flex items-center gap-2">
                  <Input
                    value={operator}
                    onChange={(e) => setOperator(e.target.value)}
                    placeholder="坐席标识"
                    className="h-8 w-32 text-xs rounded-lg"
                  />
                  <Button size="sm" variant={detail.draftCandidates?.length ? "outline" : "default"} onClick={generate} disabled={busy}>
                    {detail.draftCandidates?.length ? "重新生成" : "生成候选"}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {!detail ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                从左侧选择一个待人工会话，生成 3 条候选话术
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-border p-2.5 text-xs space-y-1">
                  <div>用户问题：{detail.question ?? "—"}</div>
                  <div className="text-muted-foreground">转人工原因：{detail.handoffReason ?? "—"}</div>
                  {detail.risk?.issues?.length ? (
                    <div className="text-muted-foreground">
                      系统判定：{detail.risk.issues.map((i) => (typeof i === "string" ? i : i.detail ?? i.type)).join("；")}
                    </div>
                  ) : null}
                </div>

                {detail.draftUsedFallback && detail.draftCandidates?.length ? (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    本次候选由规则模板兜底生成（未调用模型）
                  </div>
                ) : null}

                {!detail.draftCandidates?.length ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">
                    还没有候选。点右上角「生成候选」为坐席起草 3 条差异化话术。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {detail.draftCandidates.map((c) => {
                      const isSelected = detail.selectedCandidateId === c.id;
                      return (
                        <div
                          key={c.id}
                          className={`rounded-lg border p-3 text-sm transition-colors ${
                            isSelected ? "border-primary/50 bg-primary/[0.06]" : "border-border"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <Badge variant="secondary" className="text-[10px]">{c.style}</Badge>
                            <Badge
                              variant="secondary"
                              className={`text-[10px] ${
                                c.riskLevel === "high"
                                  ? "bg-red-100 text-red-700"
                                  : c.riskLevel === "medium"
                                    ? "bg-amber-100 text-amber-700"
                                    : ""
                              }`}
                            >
                              {RISK_LABEL[c.riskLevel] ?? c.riskLevel}
                            </Badge>
                            {isSelected && (
                              <span className="text-[11px] text-primary flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> 坐席已选定
                              </span>
                            )}
                          </div>
                          <p className="leading-relaxed">{c.content}</p>
                          <p className="text-xs text-muted-foreground mt-1.5">发送前确认：{c.riskNote}</p>
                          <div className="mt-2 flex items-center gap-2">
                            <Button size="sm" variant={isSelected ? "secondary" : "outline"} disabled={busy || isSelected} onClick={() => act("select", c.id)}>
                              {isSelected ? "已选定" : "选这条"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 留痕 + 发送动作（由人执行） */}
                <div className="rounded-lg border border-border p-2.5 text-xs space-y-1.5">
                  <div className="font-medium">留痕</div>
                  <div className="text-muted-foreground">
                    选择：{detail.selectedCandidateId ? `${detail.selectedCandidateId} · ${detail.selectedBy ?? "—"} · ${detail.selectedAt ?? "—"}` : "未选择"}
                  </div>
                  <div className="text-muted-foreground">
                    发送：{detail.sentAt ? `坐席已标记发送 · ${detail.sentAt}` : "未发送（系统不会自动发送）"}
                  </div>
                  <Button
                    size="sm"
                    disabled={busy || !detail.selectedCandidateId || !!detail.sentAt}
                    onClick={() => act("mark-sent")}
                  >
                    <Send className="w-3.5 h-3.5 mr-1" />
                    {detail.sentAt ? "已标记发送" : "坐席已发送（标记）"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 演示用：把最近会话标记为待人工（无模型时也能造出待人工会话） */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">最近会话（演示用：标记为待人工）</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无最近会话。</div>
          ) : (
            <ul className="space-y-1.5">
              {recent.map((r) => (
                <li key={r.runId} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground w-40 truncate">{r.runId}</span>
                  <span className="flex-1 truncate">{r.question ?? "（无问题文本）"}</span>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => markHandoff(r.runId, "演示：人工介入")}>
                    标记为待人工
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
