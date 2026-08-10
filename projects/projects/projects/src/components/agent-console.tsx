"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RotateCcw } from "lucide-react";

interface PlanStep {
  step: number;
  type: "skill" | "tool";
  ref: string;
  description: string;
  input: Record<string, unknown>;
}

interface Plan {
  steps: PlanStep[];
  reasoning: string;
}

interface StepState {
  step: number;
  stepIndex?: number;
  type: "skill" | "tool";
  ref: string;
  refName: string;
  description: string;
  status: "pending" | "running" | "success" | "error" | "degraded";
  input: Record<string, unknown>;
  output: unknown;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

const CITATION_LABELS: Record<string, string> = {
  query_products: "商品数据",
  query_activities: "活动数据",
  query_coupons: "优惠券数据",
  calculate_price: "价格计算",
  query_order: "订单数据",
  query_return_policy: "售后政策",
};

function extractCitationItems(toolId: string, output: unknown): string[] {
  if (!output || typeof output !== "object") return [];
  const o = output as Record<string, unknown>;
  if (toolId === "query_products") {
    const ps = (o.products as Array<{ name?: string; price?: number }>) ?? [];
    return ps.slice(0, 3).map((p) => `${p.name ?? ""}（¥${p.price ?? "-"}）`);
  }
  if (toolId === "query_coupons") {
    const cs = (o.coupons as Array<{ name?: string }>) ?? [];
    return cs.slice(0, 3).map((c) => c.name ?? "");
  }
  if (toolId === "query_activities") {
    const as = (o.activities as Array<{ name?: string }>) ?? [];
    return as.slice(0, 3).map((a) => a.name ?? "");
  }
  if (toolId === "calculate_price") {
    const lines: string[] = [];
    if (typeof o.finalPrice === "number") lines.push(`最终到手价 ¥${o.finalPrice}`);
    if (Array.isArray(o.items)) {
      (o.items as Array<{ productName?: string; finalPrice?: number }>).slice(0, 3).forEach((it) => {
        if (it.productName) lines.push(`${it.productName} ¥${it.finalPrice ?? "-"}`);
      });
    }
    return lines.slice(0, 3);
  }
  if (toolId === "query_order") return [`订单 ${(o.orderId as string) ?? ""}`].filter(Boolean);
  if (toolId === "query_return_policy") {
    const ps = Array.isArray(o.policies) ? (o.policies as Array<{ title?: string }>) : [];
    return ps.slice(0, 3).map((p) => p.title ?? "");
  }
  return [];
}

const PRESET_QUESTIONS = [
  "我想买点办公室零食，要麻辣口味的，预算 30 元左右",
  "我是新客，有没有适合送女朋友的礼盒推荐？",
  "我想买点健康的小零食，预算 50 元，能用优惠券吗？",
  "有没有适合小孩吃的糖果？预算 20 元",
];

export function AgentConsole() {
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [finalReply, setFinalReply] = useState<unknown>(null);
  const [riskResult, setRiskResult] = useState<unknown>(null);
  const [citations, setCitations] = useState<
    Array<{ toolId: string; label: string; items: string[] }>
  >([]);
  const [handoffNote, setHandoffNote] = useState<string | null>(null);
  const [handoffToHuman, setHandoffToHuman] = useState(false);
  const [messages, setMessages] = useState<
    { role: "user" | "assistant" | "system"; content: string; ts: number }[]
  >([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  type Turn = {
    id: string;
    role: "user" | "assistant";
    content: string;
    blocked?: boolean;
    riskIssues?: Array<{ type?: string; detail?: string } | string>;
    citations?: Array<{ toolId: string; label: string; items: string[] }>;
    handoff?: string | null;
    error?: string;
  };
  const [turns, setTurns] = useState<Turn[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [planReady, setPlanReady] = useState(false);
  const [planThinking, setPlanThinking] = useState(false);
  const [planThought, setPlanThought] = useState<string | null>(null);
  const finalRef = useRef<{ reply: unknown; risk: unknown; citations: typeof citations; handoff: string | null }>({
    reply: null,
    risk: null,
    citations: [],
    handoff: null,
  });
  const stepsScrollRef = useRef<HTMLDivElement>(null);
  const [addedToEval, setAddedToEval] = useState<Record<string, boolean>>({});
  const [runtimeInfo, setRuntimeInfo] = useState<{
    label: string;
    description: string;
    isFixture: boolean;
    model: string;
    degraded?: boolean;
    requested?: string | null;
    reason?: string | null;
  } | null>(null);

  useEffect(() => {
    fetch("/api/runtime")
      .then((r) => r.json())
      .then((d) => {
        setRuntimeInfo({
          ...(d.llm || {}),
          degraded: d.fallback?.degraded || false,
          requested: d.fallback?.requested || null,
          reason: d.fallback?.reason || null,
        });
      })
      .catch(() => setRuntimeInfo(null));
  }, []);

  // 支持从后台"复跑"跳转过来自动填充问题
  useEffect(() => {
    const replay = sessionStorage.getItem("replay_question");
    if (replay) {
      sessionStorage.removeItem("replay_question");
      setQuestion(replay);
      // 等待一帧再自动执行
      setTimeout(() => {
        runRef.current?.();
      }, 200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runRef = useRef<(() => void) | null>(null);

  const handleNewConversation = useCallback(() => {
    setTurns([]);
    setCurrentRunId(null);
    setPlan(null);
    setPlanReady(false);
    setPlanThinking(false);
    setPlanThought(null);
    setSteps([]);
    setFinalReply(null);
    setRiskResult(null);
    setCitations([]);
    setError('');
    setHandoffToHuman(false);
    setHandoffNote(null);
    setQuestion('');
    toast.success('已开启新对话');
  }, []);

  const handleSend = useCallback(() => {
    runRef.current?.();
  }, []);

  const consumeSSE = useCallback(async (response: Response, opts?: { isRetry?: boolean }) => {
    if (!response.body) throw new Error('响应体为空');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let localFinalReply: unknown = null;
    let localRisk: unknown = null;
    let localCitations: Array<{ toolId: string; label: string; items: string[] }> = opts?.isRetry ? [...citations] : [];
    let localRunId: string | null = null;

    const stepByIndex = (idx: number) =>
      (steps.length ? steps : []).find((s) => (s.stepIndex ?? s.step) === idx);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        if (!part.trim()) continue;
        const lines = part.split('\n');
        let event = 'message';
        let dataStr = '';
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
        }
        if (!dataStr) continue;
        try {
          const parsed = JSON.parse(dataStr);
          if (event === 'run_id' || parsed.runId) {
            localRunId = parsed.runId ?? localRunId;
            if (localRunId) setCurrentRunId(localRunId);
          }
          if (event === 'plan_ready') {
            const wrapper = parsed as { plan?: Plan; reasoning?: string };
            const p = wrapper?.plan;
            if (p && Array.isArray(p.steps)) {
              setPlan(p);
              setPlanReady(true);
              if (wrapper.reasoning) setPlanThought(wrapper.reasoning);
              setSteps(
                p.steps.map(
                  (s, i): StepState => ({
                    step: s.step ?? i,
                    stepIndex: i,
                    type: s.type,
                    ref: s.ref,
                    refName: s.ref,
                    description: s.description,
                    status: "pending",
                    input: s.input ?? {},
                    output: null,
                  }),
                ),
              );
            }
          } else if (event === 'planner_thinking') {
            setPlanThinking(true);
            if (parsed.delta) setPlanThought((prev) => (prev ?? '') + parsed.delta);
          } else if (event === 'step_started') {
            const idx = parsed.stepIndex as number;
            setSteps((prev) => {
              const exists = prev.find((s) => (s.stepIndex ?? s.step) === idx);
              const base = exists ?? ({
                step: idx,
                stepIndex: idx,
                type: parsed.type ?? 'tool',
                ref: parsed.ref ?? parsed.stepId ?? `step_${idx}`,
                refName: parsed.ref ?? parsed.stepId ?? `step_${idx}`,
                description: parsed.description ?? '',
                input: parsed.input ?? {},
                output: null,
              } as StepState);
              return exists
                ? prev.map((s) => ((s.stepIndex ?? s.step) === idx ? { ...s, status: 'running', input: parsed.input ?? s.input } : s))
                : [...prev, { ...base, status: 'running' }];
            });
          } else if (event === 'step_output' || event === 'step_completed') {
            const idx = parsed.stepIndex as number;
            const out = parsed.output ?? null;
            const status: StepState['status'] = parsed.status === 'degraded' ? 'degraded' : 'success';
            setSteps((prev) =>
              prev.map((s) => ((s.stepIndex ?? s.step) === idx ? { ...s, status, output: out, finishedAt: new Date().toISOString() } : s)),
            );
            if (parsed.type === 'tool' && out && typeof out === 'object') {
              const toolId = parsed.ref as string;
              const items = extractCitationItems(toolId, out);
              if (items.length > 0) {
                localCitations = localCitations.filter((c) => c.toolId !== toolId);
                localCitations.push({ toolId, label: CITATION_LABELS[toolId] ?? toolId, items });
                setCitations(localCitations);
              }
            }
          } else if (event === 'step_error') {
            const idx = parsed.stepIndex as number;
            setSteps((prev) =>
              prev.map((s) => ((s.stepIndex ?? s.step) === idx ? { ...s, status: 'error', error: parsed.error ?? String(parsed) } : s)),
            );
          } else if (event === 'final_reply') {
            localFinalReply = parsed.finalReply;
            localRisk = parsed.risk;
            setFinalReply(localFinalReply);
            setRiskResult(localRisk);
          } else if (event === 'done') {
            if (parsed.finalReply) { localFinalReply = parsed.finalReply; setFinalReply(localFinalReply); }
            if (parsed.risk) { localRisk = parsed.risk; setRiskResult(localRisk); }
            if (parsed.runId) { localRunId = parsed.runId; setCurrentRunId(parsed.runId); }
          } else if (event === 'error') {
            setError(parsed.message || '执行出错');
          }
        } catch (e) {
          console.error('SSE parse error', e, dataStr);
        }
      }
    }

    finalRef.current = { reply: localFinalReply, risk: localRisk, citations: localCitations, handoff: finalRef.current.handoff };

    // 风控硬拦截
    const risk =
      localRisk && typeof localRisk === 'object'
        ? (localRisk as { passed?: boolean; issues?: string[] })
        : null;
    if (risk && risk.passed === false) {
      const issues = risk.issues ?? [];
      setHandoffNote(`风控未通过：${issues.join('；')}`);
      setHandoffToHuman(true);
      if (localRunId) {
        fetch(`/api/runs/${localRunId}/handoff`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'risk_blocked', issues }),
        }).catch(() => {});
      }
    }
  }, [citations, steps]);

  const handleRetryFrom = useCallback(async (fromStepIndex: number) => {
    if (!currentRunId) {
      toast.error('当前没有可重试的运行');
      return;
    }
    setError(null);
    setRunning(true);
    setPlanReady(true);
    setFinalReply(null);
    setRiskResult(null);
    setHandoffNote(null);
    setHandoffToHuman(false);
    // 截断到重试步之前
    setSteps((prev) => prev.filter((s) => (s.stepIndex ?? s.step) < fromStepIndex));
    try {
      const response = await fetch('/api/run/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: currentRunId, stepIndex: fromStepIndex }),
      });
      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new Error(text || '重试接口异常');
      }
      await consumeSSE(response, { isRetry: true });
      toast.success('重试完成');
    } catch (e) {
      setError(e instanceof Error ? e.message : '重试失败');
      toast.error('重试失败');
    } finally {
      setRunning(false);
      const { reply, risk, citations: cs } = finalRef.current;
      const r = risk && typeof risk === 'object' ? (risk as { passed?: boolean; issues?: string[] }) : null;
      const blocked = !!(r && r.passed === false);
      const content = typeof reply === 'string' ? reply : reply ? JSON.stringify(reply, null, 2) : '';
      if (content || blocked) {
        setTurns((prev) => {
          // 替换最后一条 assistant 消息
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'assistant') {
              next[i] = { ...next[i], content, blocked, riskIssues: r?.issues, citations: cs };
              return next;
            }
          }
          next.push({ id: `a_${Date.now()}`, role: 'assistant', content, blocked, riskIssues: r?.issues, citations: cs });
          return next;
        });
      }
    }
  }, [consumeSSE, currentRunId]);

  const handleRun = useCallback(async () => {
    const q = question.trim();
    if (!q || running) return;
    setError(null);
    setRunning(true);
    // 注意：多轮模式下不重置 turns（会话区保持历史），只重置本轮右侧轨迹/结果
    setPlan(null);
    setSteps([]);
    setFinalReply(null);
    setRiskResult(null);
    setCitations([]);
    setHandoffNote(null);
    setHandoffToHuman(false);
    setPlanReady(false);
    setPlanThinking(false);
    setPlanThought(null);
    setCurrentRunId(null);
    finalRef.current = { reply: null, risk: null, citations: [], handoff: null };

    // 先把用户这条消息加入 turns
    setTurns((prev) => [...prev, { id: `u_${Date.now()}`, role: "user", content: q }]);

    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          conversationHistory: turns.slice(-10).map((t) => ({
            role: t.role,
            content: t.content,
          })),
        }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(text || `请求失败：${res.status}`);
      }

      await consumeSSE(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setTurns((prev) => [
        ...prev,
        { id: `e_${Date.now()}`, role: "assistant", content: "", error: msg },
      ]);
    } finally {
      setRunning(false);
      const { reply, risk, citations: cs, handoff: hn } = finalRef.current;
      const r =
        risk != null && typeof risk === "object"
          ? (risk as { passed?: boolean; issues?: string[] })
          : null;
      const blocked = !!(r && r.passed === false);
      const content =
        typeof reply === "string"
          ? reply
          : reply
            ? JSON.stringify(reply, null, 2)
            : "";
      if (content || blocked || hn) {
        setTurns((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && (last.content || last.blocked || last.handoff)) return prev;
          return [
            ...prev,
            {
              id: `a_${Date.now()}`,
              role: "assistant",
              content,
              blocked,
              riskIssues: r?.issues,
              citations: cs,
              handoff: hn,
            },
          ];
        });
      }
    }
  }, [question, running, turns, consumeSSE]);

  useEffect(() => {
    runRef.current = handleRun;
  }, [handleRun]);

  // 将引用角标插入到最终回复文本中
  const renderTextWithCitations = (
    text: string,
    citations: Turn["citations"],
  ): React.ReactNode => {
    if (!citations || citations.length === 0) return <>{text}</>;
    const seen = new Set<string>();
    const pairs: Array<{ kw: string; idx: number }> = [];
    citations.forEach((c, idx) => {
      (c.items || []).forEach((it) => {
        if (it && it.length >= 2 && !seen.has(it)) {
          seen.add(it);
          pairs.push({ kw: it, idx });
        }
      });
    });
    if (pairs.length === 0) return <>{text}</>;
    pairs.sort((a, b) => b.kw.length - a.kw.length);
    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    let buf = "";
    const flush = () => {
      if (buf) {
        nodes.push(buf);
        buf = "";
      }
    };
    while (cursor < text.length) {
      let hit: { kw: string; idx: number } | null = null;
      let hitLen = 0;
      for (const p of pairs) {
        if (text.startsWith(p.kw, cursor)) {
          hit = p;
          hitLen = p.kw.length;
          break;
        }
      }
      if (hit) {
        flush();
        nodes.push(
          <span key={`m-${cursor}`}>
            {hit.kw}
            <sup className="text-primary font-semibold text-[0.65rem] ml-0.5">[{hit.idx + 1}]</sup>
          </span>,
        );
        cursor += hitLen;
      } else {
        buf += text[cursor];
        cursor++;
      }
    }
    flush();
    return <>{nodes}</>;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* 左侧：对话 + 输入 */}
      <div className="lg:col-span-2 space-y-4">
        {runtimeInfo && (
          <div
            className={cn(
              "rounded-xl px-3 py-2 text-xs flex items-center gap-2 border",
              runtimeInfo.isFixture
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : "bg-success/10 border-success/20 text-success"
            )}
          >
            <span
              className={cn(
                "inline-block w-2 h-2 rounded-full",
                runtimeInfo.isFixture ? "bg-amber-500" : "bg-success"
              )}
            />
            <span className="font-medium">
              当前运行模式：{runtimeInfo.label}
            </span>
            <span className="opacity-75 truncate">({runtimeInfo.model})</span>
            {runtimeInfo.isFixture && (
              <span className="ml-auto opacity-80 truncate">
                {runtimeInfo.degraded && runtimeInfo.reason
                  ? `自动降级：${runtimeInfo.reason}`
                  : "预生成/确定性输出 · 演示用"}
              </span>
            )}
          </div>
        )}
        <Card className="p-0 overflow-hidden flex flex-col" style={{ maxHeight: "70vh" }}>
          {/* 对话历史 */}
          <div
            ref={(el) => {
              if (el) {
                requestAnimationFrame(() => {
                  el.scrollTop = el.scrollHeight;
                });
              }
            }}
            className="flex-1 overflow-y-auto p-5 space-y-3 bg-muted/10"
          >
            {turns.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-8">
                你好呀，我是小食铺 AI 客服，选一个常见问题或自己输入来开始对话。
              </div>
            )}
            {turns.map((t) => (
              <div
                key={t.id}
                className={cn(
                  "flex gap-2 items-end",
                  t.role === "user" ? "justify-end flex-row-reverse" : "justify-start"
                )}
              >
                {/* 头像占位 */}
                <div
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0",
                    t.role === "user"
                      ? "bg-secondary text-secondary-foreground"
                      : t.error || t.blocked
                        ? "bg-destructive/10 text-destructive"
                        : t.handoff
                          ? "bg-success/10 text-success"
                          : "bg-primary/10 text-primary"
                  )}
                >
                  {t.role === "user" ? "我" : "食"}
                </div>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm border",
                    t.role === "user"
                      ? "bg-primary text-primary-foreground border-primary/30 rounded-tr-sm"
                      : t.error
                        ? "bg-destructive/10 text-destructive border-destructive/30 rounded-tl-sm"
                        : t.blocked
                          ? "bg-destructive/5 text-destructive border-destructive/30 rounded-tl-sm"
                          : t.handoff
                            ? "bg-success/10 text-success border-success/30 rounded-tl-sm"
                            : "bg-card text-card-foreground border-border rounded-tl-sm"
                  )}
                >
                  {t.error ? (
                    <>
                      <div className="font-medium mb-1">执行失败</div>
                      <div className="text-xs opacity-90">{t.error}</div>
                    </>
                  ) : t.blocked ? (
                    <>
                      <div className="font-medium mb-1">回复被风控拦截</div>
                      {t.content && <div className="mb-1 whitespace-pre-wrap opacity-80">{t.content}</div>}
                      {t.riskIssues && t.riskIssues.length > 0 && (
                        <ul className="list-disc list-inside text-xs space-y-0.5 mt-1">
                          {t.riskIssues.map((iss, i) => (
                            <li key={`risk-${t.id}-${i}`}>
                              {typeof iss === "string" ? iss : iss.detail || iss.type || ""}
                            </li>
                          ))}
                        </ul>
                      )}
                      {t.handoff && <div className="mt-2 text-xs">{t.handoff}</div>}
                    </>
                  ) : t.handoff ? (
                    <div>{t.handoff}</div>
                  ) : (
                    <>
                      <div className="whitespace-pre-wrap">
                        {renderTextWithCitations(t.content, t.citations)}
                      </div>
                      {t.citations && t.citations.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-border/60 flex flex-wrap gap-1">
                          {t.citations.map((c, ci) => (
                            <span
                              key={c.toolId}
                              className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                            >
                              <sup className="text-primary font-semibold not-italic">[{ci + 1}]</sup>
                              {c.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {t.role === "assistant" && t.content && !t.error && currentRunId && !running && (
                  <div className="mt-1 flex gap-1.5 self-end">
                    <button
                      type="button"
                      disabled={!!addedToEval[t.id]}
                      onClick={async () => {
                        try {
                          const lastUser = [...turns].reverse().find((x) => x.role === "user");
                          const resp = await fetch("/api/eval/cases", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              question: lastUser?.content || "",
                              expectedReply: t.content,
                              sourceRunId: currentRunId,
                              expectRiskPassed: !t.blocked,
                            }),
                          });
                          const j = await resp.json();
                          if (resp.ok) setAddedToEval((s) => ({ ...s, [t.id]: true }));
                          else console.warn("加入评测集失败", j);
                        } catch (e) {
                          console.warn(e);
                        }
                      }}
                      className={cn(
                        "text-[11px] px-2 py-0.5 rounded-full border transition whitespace-nowrap",
                        addedToEval[t.id]
                          ? "bg-success/10 text-success border-success/30 cursor-default"
                          : "bg-muted/60 text-muted-foreground border-border hover:bg-muted",
                      )}
                    >
                      {addedToEval[t.id] ? "已加入评测集" : "加入评测集"}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {running && (
              <div className="flex justify-start gap-2 items-end">
                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                  食
                </div>
                <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "120ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "240ms" }} />
                </div>
              </div>
            )}
          </div>

          {/* 输入区 */}
          <div className="border-t border-border p-4 space-y-2 bg-card">
            <Textarea
              placeholder="继续提问或说点什么（Enter 发送 / Shift+Enter 换行）..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (question.trim() && !running) handleRun();
                }
              }}
              disabled={running}
              rows={Math.min(5, Math.max(2, question.split("\n").length))}
              className="resize-none leading-relaxed"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {PRESET_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={running}
                    onClick={() => setQuestion(q)}
                    className="text-xs px-2 py-1 rounded-full bg-muted hover:bg-muted/70 transition-colors text-muted-foreground disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {messages.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={handleNewConversation} disabled={running}>
                    新对话
                  </Button>
                )}
                {handoffToHuman && (
                  <span className="text-xs text-primary/80">人工客服已接入</span>
                )}
                <Button
                  onClick={handleRun}
                  disabled={!question.trim() || running}
                  size="sm"
                >
                  {running ? "执行中..." : "发送"}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* 右侧：计划 + 执行轨迹 */}
      <div className="lg:col-span-3 space-y-4">
        {!plan && !running && (
          <Card className="p-10 text-center text-muted-foreground">
            <div className="text-3xl mb-2 opacity-30">↳</div>
            <p className="text-sm">提交问题后，Planner 会先分析需求并生成执行计划</p>
            <p className="text-xs mt-1 opacity-70">
              Executor 将按计划逐步调用 Skill 和 Tool，每步都会记录输入输出
            </p>
          </Card>
        )}

        {(plan || running) && (
          <>
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium">Planner 生成的执行计划</h2>
                  <Badge variant="outline" className="font-normal">
                    {plan?.steps.length ?? 0} 步
                  </Badge>
                </div>
              </div>
              {plan?.reasoning && (
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                  {plan.reasoning}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {plan?.steps.map((s) => (
                  <div
                    key={s.step}
                    className={cn(
                      "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border",
                      s.type === "skill"
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-accent border-accent-foreground/10 text-accent-foreground"
                    )}
                  >
                    <span className="font-mono opacity-60">#{s.step + 1}</span>
                    <span className="font-medium">{s.ref}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-medium mb-3">执行轨迹</h2>
              <ScrollArea className="h-[560px] pr-3" ref={stepsScrollRef}>
                <div className="space-y-3">
                  {steps.map((s) => (
                    <StepCard
                      key={s.stepIndex ?? s.step}
                      step={s}
                      canRetry={!running && currentRunId !== null && (s.status === "error" || s.status === "degraded")}
                      onRetry={() => handleRetryFrom(s.stepIndex ?? s.step)}
                    />
                  ))}
                  {running && steps.length === 0 && (
                    <div className="space-y-3">
                      <Skeleton className="h-24 w-full" />
                      <Skeleton className="h-24 w-full" />
                    </div>
                  )}
                </div>
              </ScrollArea>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function StepCard({
  step,
  canRetry,
  onRetry,
}: {
  step: StepState;
  canRetry?: boolean;
  onRetry?: () => void;
}) {
  const isSkill = step.type === "skill";
  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors border-l-4",
        step.status === "running" && "border-primary bg-primary/5 border-l-primary",
        step.status === "success" && "border-border bg-card border-l-chart-2/40",
        step.status === "error" && "border-destructive bg-destructive/5 border-l-destructive",
        step.status === "degraded" && "border-amber-500/40 bg-amber-50/40 border-l-amber-500",
        step.status === "pending" && "border-dashed border-border border-l-transparent"
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className={cn(
            "text-xs font-mono px-1.5 py-0.5 rounded",
            isSkill
              ? "bg-primary/15 text-primary"
              : "bg-accent text-accent-foreground"
          )}
        >
          #{(step.stepIndex ?? step.step) + 1}
        </span>
        <Badge
          variant={isSkill ? "default" : "secondary"}
          className="font-normal"
        >
          {isSkill ? "Skill" : "Tool"}
        </Badge>
        <span className="text-sm font-medium">{step.refName}</span>
        <span className="text-xs text-muted-foreground truncate flex-1">
          {step.description}
        </span>
        <StatusBadge status={step.status} />
        {canRetry && (
          <button
            onClick={onRetry}
            className="text-[11px] px-2 py-0.5 rounded-full border border-primary/40 text-primary hover:bg-primary/10 transition"
          >
            从此步重试
          </button>
        )}
      </div>

      {step.status === "degraded" && (
        <div className="mb-2 text-xs text-amber-700 bg-amber-100/60 border border-amber-200 rounded-md px-2 py-1">
          此 Tool 调用失败，已使用空结果兜底继续执行，最终回复可能缺少相关事实依据。
        </div>
      )}
      {step.status !== "pending" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-muted-foreground mb-1">输入</div>
            <pre className="bg-muted/50 rounded-md p-2 overflow-x-auto font-mono text-[11px] leading-relaxed max-h-40 overflow-y-auto">
              {JSON.stringify(step.input, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-muted-foreground mb-1">输出</div>
            {step.status === "error" ? (
              <pre className="bg-destructive/10 text-destructive rounded-md p-2 overflow-x-auto font-mono text-[11px] leading-relaxed">
                {step.error}
              </pre>
            ) : (
              <pre className="bg-muted/50 rounded-md p-2 overflow-x-auto font-mono text-[11px] leading-relaxed max-h-40 overflow-y-auto">
                {step.output === undefined
                  ? "（无）"
                  : typeof step.output === "string"
                    ? step.output
                    : JSON.stringify(step.output, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: StepState["status"] }) {
  const map = {
    pending: { label: "等待", className: "bg-muted text-muted-foreground" },
    running: { label: "执行中", className: "bg-primary text-primary-foreground animate-pulse" },
    success: { label: "完成", className: "bg-chart-2/20 text-chart-2" },
    error: { label: "失败", className: "bg-destructive text-destructive-foreground" },
    degraded: { label: "降级", className: "bg-amber-500/90 text-white" },
  };
  const m = map[status];
  return (
    <span
      className={cn(
        "text-[10px] px-2 py-0.5 rounded-full font-medium",
        m.className
      )}
    >
      {m.label}
    </span>
  );
}

function RiskBadge({ riskResult }: { riskResult: unknown }) {
  if (riskResult == null) {
    return <Badge variant="outline" className="font-normal">未审核</Badge>;
  }
  const r = riskResult as { passed?: boolean; issues?: string[] };
  if (r.passed) {
    return (
      <Badge className="font-normal bg-chart-2/20 text-chart-2 hover:bg-chart-2/30">
        风控通过
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="font-normal">
      风控未通过{r.issues && r.issues.length > 0 ? ` · ${r.issues.length} 项` : ""}
    </Badge>
  );
}
