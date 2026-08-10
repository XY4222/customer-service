"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Send, Loader2, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import React from "react";

/**
 * 轻量 Markdown 渲染（客服对话场景）：
 * - **粗体** → <strong>
 * - *斜体* / _斜体_ → <em>
 * - `- ` / `* ` 开头 → 列表项（•）
 * - `\n\n` → 段落分段；`\n` → <br/>
 * - 裸文本里的 `*` 符号直接吃掉（避免 LLM 未闭合时漏出来）
 * - 不支持代码块/链接/标题（客服场景不需要）
 */
function renderChatText(text: string): React.ReactNode {
  if (!text) return null;

  // 拆成段落（按空行）
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const renderInline = (s: string, keyPrefix: string): React.ReactNode[] => {
    // 支持 **bold** / *italic* / _italic_，按出现顺序切分
    const nodes: React.ReactNode[] = [];
    const regex = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(_([^_]+)_)/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = regex.exec(s)) !== null) {
      if (m.index > lastIndex) {
        nodes.push(s.slice(lastIndex, m.index));
      }
      if (m[1]) {
        nodes.push(<strong key={`${keyPrefix}-b-${i}`} className="font-semibold">{m[2]}</strong>);
      } else if (m[3]) {
        nodes.push(<em key={`${keyPrefix}-i-${i}`} className="not-italic font-medium">{m[4]}</em>);
      } else if (m[5]) {
        nodes.push(<em key={`${keyPrefix}-u-${i}`} className="not-italic font-medium">{m[6]}</em>);
      }
      lastIndex = m.index + m[0].length;
      i++;
    }
    if (lastIndex < s.length) {
      nodes.push(s.slice(lastIndex));
    }
    return nodes;
  };

  return (
    <>
      {paragraphs.map((para, pIdx) => {
        // 段落内如果是多行（单 \n）
        const lines = para.split(/\n/);
        // 识别列表：如果某行以 - 或 * 开头作为列表项
        const isList = lines.every((l) => /^[-*•]\s+/.test(l.trim()));
        if (isList) {
          return (
            <ul key={`p-${pIdx}`} className="list-none pl-0 my-1 space-y-1">
              {lines.map((l, lIdx) => {
                const content = l.replace(/^[-*•]\s+/, "");
                return (
                  <li key={`li-${pIdx}-${lIdx}`} className="flex gap-2">
                    <span className="text-muted-foreground select-none mt-[2px]">•</span>
                    <span className="flex-1">{renderInline(content, `p${pIdx}-l${lIdx}`)}</span>
                  </li>
                );
              })}
            </ul>
          );
        }
        return (
          <p key={`p-${pIdx}`} className={pIdx > 0 ? "mt-2" : ""}>
            {lines.map((l, lIdx) => (
              <React.Fragment key={`ln-${pIdx}-${lIdx}`}>
                {lIdx > 0 && <br />}
                {renderInline(l, `p${pIdx}-l${lIdx}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

type MsgRole = "user" | "assistant" | "system";

interface ChatMessage {
  id: string;
  role: MsgRole;
  content: string;
  typing?: boolean;
  time: number;
}

const QUICK_QUESTIONS = [
  "有什么办公室零食推荐吗？预算 30 元",
  "我是新客，想送女朋友一份礼盒",
  "小孩能吃的健康零食有哪些？",
];

type Rating = 1 | 2 | 3 | 4 | 5 | null;

export function DemoChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "你好呀，我是小食铺客服～想挑点什么零食？可以直接说需求，比如"
        + "「办公室吃不胖的小零食」「送给女朋友的礼盒」",
      time: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [rating, setRating] = useState<Rating>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [conversationId] = useState(() => `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, showRating]);

  const triggerIdleRating = useCallback(() => {
    if (!showRating && !ratingSubmitted) {
      setShowRating(true);
    }
  }, [showRating, ratingSubmitted]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(triggerIdleRating, 90_000);
  }, [triggerIdleRating]);

  useEffect(() => {
    resetIdleTimer();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [resetIdleTimer]);

  const pushMessage = useCallback(
    (msg: Omit<ChatMessage, "time"> & { time?: number }) => {
      setMessages((prev) => [
        ...prev,
        { ...msg, time: msg.time ?? Date.now() },
      ]);
    },
    []
  );

  const sendToAgent = useCallback(
    async (question: string) => {
      if (!question.trim() || sending) return;
      setSending(true);
      resetIdleTimer();

      // 1. 用户消息
      pushMessage({ id: `u_${Date.now()}`, role: "user", content: question });
      setInput("");

      // 2. 打字中占位
      const typingId = `t_${Date.now()}`;
      pushMessage({ id: typingId, role: "assistant", content: "", typing: true });

      // 等 ~1s"正在输入" 真实感
      await new Promise((r) => setTimeout(r, 900));

      // 3. SSE 流式调用 Agent
      // emptyTimer 提前声明，供 try/catch/finally 共同访问
      let emptyTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        const resp = await fetch("/api/agent/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
          },
          body: JSON.stringify({ question, source: "demo", conversationId }),
          // @ts-expect-error Node fetch supports duplex for streamed request compatibility.
          duplex: "half",
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        if (!resp.body) throw new Error("无响应");
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullReply = "";
        let eventName = "message";
        let eventData = "";
        let eventCount = 0;

        // 移除 typing 占位
        setMessages((prev) => prev.filter((m) => m.id !== typingId));

        const aiId = `a_${Date.now()}`;
        pushMessage({ id: aiId, role: "assistant", content: "" });

        // 兜底：30s 后若气泡还是空，显示一个排错提示
        emptyTimer = setTimeout(() => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiId && !m.content
                ? {
                    ...m,
                    content:
                      "（build v2024-11-15b · 30秒过去气泡仍是空，后端事件没进来。请检查浏览器控制台是否有 SSE 报错。）",
                  }
                : m
            )
          );
        }, 30000);

        const updateAi = (next: { content: string; status?: string }) => {
          if (next.content) if (emptyTimer) clearTimeout(emptyTimer);
          setMessages((prev) =>
            prev.map((m) => (m.id === aiId ? { ...m, ...next } : m))
          );
        };

        const STEP_LABEL: Record<string, string> = {
          "need-extraction": "解析需求",
          "query_products": "查找商品",
          "query_activities": "查找活动",
          "recommendation-decision": "匹配推荐",
          "recommendation-reason": "生成推荐理由",
          "response-generator": "组织回复",
          "risk-check": "风险审核",
          "allergy-risk-reminder": "过敏提醒",
          "clarification-question": "生成追问",
          "human-handoff-decision": "人工路由",
          "after-sales-classification": "售后分类",
          "complaint-triage": "投诉分诊",
          "conversation-summary": "对话摘要",
          "product-substitution": "商品替代",
          "gift-scenario-advisor": "送礼建议",
        };
        const labelOf = (ref: string | undefined) =>
          (ref && STEP_LABEL[ref]) || ref || "处理中";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // 标准 SSE：事件以空行（\n\n）分隔
          const parts = buffer.split(/\r?\n\r?\n/);
          buffer = parts.pop() ?? "";
          for (const block of parts) {
            if (!block.trim()) continue;
            const lines = block.split(/\r?\n/);
            eventName = "message";
            eventData = "";
            for (const line of lines) {
              if (line.startsWith("event:")) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                const piece = line.slice(5).replace(/^\s/, "");
                eventData += (eventData ? "\n" : "") + piece;
              } else if (line.startsWith(":")) {
                // SSE 注释/心跳，忽略
              }
            }
            if (!eventData) continue;
            eventCount++;
            let evt: any;
            try {
              evt = JSON.parse(eventData);
            } catch {
              continue;
            }
            // 把 eventName 塞进 evt，后面统一看 evt.type
            if (!evt.type) evt.type = eventName;
            try {
              if (evt.type === "planner_thinking" || eventName === "planner_thinking") {
                updateAi({ content: "🤔 正在分析问题，生成执行计划…", status: "thinking" });
              } else if (evt.type === "plan_ready" || evt.type === "plan_done" || eventName === "plan_ready" || eventName === "plan_done") {
                const steps: any[] = evt.plan?.steps || [];
                const total = steps.length;
                const firstLabel = labelOf(steps[0]?.ref);
                updateAi({
                  content: `📋 已规划 ${total} 步，先从「${firstLabel}」开始…`,
                  status: "planned",
                });
              } else if (evt.type === "step_started" || eventName === "step_started") {
                const idx = (evt.stepIndex ?? evt.step ?? 0) + 1;
                const total = (evt as any).totalSteps;
                const label = labelOf(evt.ref);
                updateAi({
                  content:
                    total != null
                      ? `⏳ 第 ${idx}/${total} 步：${label}…`
                      : `⏳ 正在执行：${label}…`,
                  status: "running",
                });
              } else if (evt.type === "step_completed" || eventName === "step_completed") {
                const idx = (evt.stepIndex ?? evt.step ?? 0) + 1;
                const label = labelOf(evt.ref);
                updateAi({ content: `✅ 第 ${idx} 步「${label}」完成…`, status: "running" });
              } else if (evt.type === "step_error" || eventName === "step_error") {
                const idx = (evt.stepIndex ?? evt.step ?? 0) + 1;
                const label = labelOf(evt.ref);
                updateAi({
                  content: `⚠️ 第 ${idx} 步「${label}」遇到问题，自动兜底中…`,
                  status: "running",
                });
              } else if (evt.type === "final_reply" || eventName === "final_reply") {
                fullReply = evt.finalReply ?? evt.reply ?? "";
                updateAi({ content: fullReply, status: "done" });
              } else if (evt.type === "error" || eventName === "error") {
                updateAi({
                  content:
                    evt.message || "抱歉，出了点小问题，你可以稍后再试或换个说法～",
                  status: "done",
                });
              } else if (eventName === "run_saved" || eventName === "done") {
                // 只在还没拿到 finalReply 时用 done 的 runId 标记
                if (!fullReply && eventName === "done" && evt.status && evt.status !== "success") {
                  updateAi({
                    content:
                      evt.status === "risk_failed"
                        ? "抱歉，本次回复未通过审核，请换个问法再试。"
                        : `抱歉，本次执行未完成（${evt.status}），请稍后再试。`,
                    status: "done",
                  });
                }
              }
            } catch (err) {
              console.warn("[demo-chat] event handle error:", err);
            }
          }
        }
        if (emptyTimer) clearTimeout(emptyTimer);
        // 如果循环结束但一个事件都没收到，显示错误
        if (eventCount === 0) {
          updateAi({
            content: "（build v2024-11-15b · 没有收到任何 SSE 事件，请检查浏览器控制台或刷新页面重试。）",
            status: "done",
          });
        } else if (!fullReply) {
          updateAi({
            content: `（build v2024-11-15b · 收到 ${eventCount} 个事件但没有 finalReply，请刷新页面重试。）`,
            status: "done",
          });
        }
      } catch (e) {
        if (emptyTimer) clearTimeout(emptyTimer);
        setMessages((prev) => prev.filter((m) => m.id !== typingId));
        pushMessage({
          id: `err_${Date.now()}`,
          role: "system",
          content: "网络异常，请稍后重试。",
        });
      } finally {
        setSending(false);
      }
    },
    [conversationId, pushMessage, resetIdleTimer, sending]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendToAgent(input);
  };

  const submitRating = async (r: Rating) => {
    setRating(r);
    setRatingSubmitted(true);
    setShowRating(false);
    // 记录评分到后端（异步不阻塞）
    try {
      await fetch(`/api/ratings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          rating: r,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
    } catch {
      /* ignore */
    }
    pushMessage({
      id: `r_${Date.now()}`,
      role: "system",
      content:
        r === 1
          ? "非常抱歉这次体验不好，你的反馈已进入改进队列，我们会尽快优化。"
          : "感谢你的评价，祝你吃得开心～",
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] max-w-2xl mx-auto w-full px-4">
      {/* 顶部状态 */}
      <div className="py-4 flex items-center gap-3 border-b border-border shrink-0">
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-lg font-semibold text-primary">
            食
          </div>
          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-success ring-2 ring-background" />
        </div>
        <div>
          <div className="font-semibold">零食小助手</div>
          <div className="text-xs text-success flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
            在线 · 秒回
            <span className="ml-1 text-muted-foreground/60 text-[10px]">· build v2024-11-15b</span>
          </div>
        </div>
      </div>

      {/* 消息区 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto py-4 px-1 space-y-3"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex gap-2 items-end",
              m.role === "user" ? "flex-row-reverse" : ""
            )}
          >
            {m.role === "system" ? (
              <div className="mx-auto max-w-[80%] text-xs text-muted-foreground text-center py-1 px-3">
                {m.content}
              </div>
            ) : (
              <>
                {/* 头像占位 */}
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0",
                    m.role === "user"
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-primary/10 text-primary"
                  )}
                >
                  {m.role === "user" ? "我" : "食"}
                </div>
                <div
                  className={cn(
                    "max-w-[78%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-md"
                      : "bg-card border border-border rounded-tl-md"
                  )}
                >
                  {m.typing ? (
                    <div className="flex items-center gap-1 py-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" />
                    </div>
                  ) : m.role === "assistant" ? (
                    renderChatText(m.content)
                  ) : (
                    m.content
                  )}
                </div>
              </>
            )}
          </div>
        ))}

        {/* 评分卡片 */}
        {showRating && !ratingSubmitted && (
          <div className="flex justify-center">
            <div className="bg-card border border-border rounded-2xl px-5 py-4 shadow-sm max-w-sm text-center">
              <div className="text-sm text-foreground mb-1">
                这次服务怎么样？
              </div>
              <div className="text-xs text-muted-foreground mb-3">
                1 分会进入 Bad Case 改进队列
              </div>
              <div className="flex justify-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => submitRating(n as Rating)}
                    className="p-1.5 hover:scale-110 transition-transform"
                  >
                    <Star
                      className={cn(
                        "w-6 h-6 transition-colors",
                        (rating ?? 0) >= n
                          ? "fill-primary text-primary"
                          : "text-muted-foreground/40"
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 常见问题 */}
      {messages.length <= 1 && !sending && (
        <div className="flex flex-wrap gap-2 pb-3 shrink-0">
          {QUICK_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => sendToAgent(q)}
              className="text-xs border border-border rounded-full px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* 输入框 */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 py-4 border-t border-border shrink-0 items-center"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="说点什么…（回车发送）"
          disabled={sending || ratingSubmitted}
          className="rounded-xl"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!input.trim() || sending || ratingSubmitted}
          className="rounded-xl shrink-0"
        >
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
