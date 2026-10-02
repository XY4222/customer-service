"use client";

import { Brain } from "lucide-react";
import type { MemoryInfo } from "@/lib/memory-view";

/** 对话区上方展示「AI 记住了你」：无记忆时不渲染（两个前台入口共用） */
export function MemoryPanel({ info }: { info: MemoryInfo | null }) {
  if (!info || info.interactionCount === 0) return null;
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-2.5 text-xs">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Brain className="w-3.5 h-3.5 text-primary" />
        <span className="font-medium">AI 记住了你</span>
        <span className="text-muted-foreground">
          · 第 {info.interactionCount} 次来访
          {info.isNewUser ? " · 新客" : " · 老客"}
        </span>
      </div>
      {info.facts.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {info.facts.slice(0, 6).map((f, i) => (
            <span
              key={`mf-${i}`}
              className="inline-flex items-center px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/15"
            >
              {f.content}
            </span>
          ))}
        </div>
      )}
      {info.recentEpisodes.length > 0 && (
        <div className="text-muted-foreground leading-relaxed">
          上次：{info.recentEpisodes[0]?.summary}
        </div>
      )}
    </div>
  );
}
