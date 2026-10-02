"use client";

import { useCallback, useEffect, useState } from "react";
import { toMemoryInfo, type MemoryInfo, type MemoryInfoSource } from "@/lib/memory-view";
import { getOrCreateVisitorId } from "@/lib/visitor-id";

/**
 * 前台长期记忆数据源：恢复/生成 visitorId、拉取已有画像、接收 SSE memory_recalled 事件。
 * Agent 执行页与 Demo 聊天页共用同一个 visitorId，因此两个入口记得的是同一个访客。
 */
export function useVisitorMemory() {
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [memoryInfo, setMemoryInfo] = useState<MemoryInfo | null>(null);

  useEffect(() => {
    const vid = getOrCreateVisitorId();
    setVisitorId(vid);
    let alive = true;
    fetch(`/api/memory/${encodeURIComponent(vid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setMemoryInfo(toMemoryInfo(d?.profile));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /** 处理 SSE memory_recalled 事件（事件里带的是压缩后的 recentEpisodes） */
  const applyMemoryEvent = useCallback((payload: unknown) => {
    setMemoryInfo(toMemoryInfo(payload as MemoryInfoSource));
  }, []);

  return { visitorId, memoryInfo, applyMemoryEvent };
}
