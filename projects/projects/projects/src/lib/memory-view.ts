/**
 * 长期记忆的展示层数据（客户端安全：不依赖 fs / server 模块）
 *
 * 画像接口（GET /api/memory/[id] 的 profile）与 SSE 的 memory_recalled 事件字段名不同：
 * 前者给 episodes[]，后者压缩成 recentEpisodes[]。这里统一成一种形状，
 * 避免每个页面各写一份映射（曾因此漏掉 episodes，导致「上次交互」摘要不显示）。
 */

export type MemoryKind = "preference" | "restriction" | "identity" | "budget" | "scenario" | "other";

export const FACT_KIND_LABELS: Record<MemoryKind, string> = {
  preference: "偏好",
  restriction: "忌口/约束",
  identity: "身份",
  budget: "预算",
  scenario: "场景",
  other: "其他",
};

export interface MemoryFactView {
  kind: MemoryKind;
  content: string;
}

export interface MemoryEpisodeView {
  summary: string;
  ts: string;
}

/** 「AI 记住了你」面板的视图数据 */
export interface MemoryInfo {
  interactionCount: number;
  isNewUser: boolean;
  facts: MemoryFactView[];
  recentEpisodes: MemoryEpisodeView[];
}

/** 画像接口 / SSE 事件的原始形状（时间线字段有两种名字） */
export interface MemoryInfoSource {
  interactionCount?: number;
  isNewUser?: boolean;
  facts?: MemoryFactView[];
  /** profile.episodes（GET /api/memory/[id]） */
  episodes?: MemoryEpisodeView[];
  /** memory_recalled 事件里已压缩的字段 */
  recentEpisodes?: MemoryEpisodeView[];
}

/** 归一化成面板数据；无数据时返回 null（面板不渲染） */
export function toMemoryInfo(raw: MemoryInfoSource | null | undefined): MemoryInfo | null {
  if (!raw) return null;
  return {
    interactionCount: raw.interactionCount ?? 0,
    isNewUser: raw.isNewUser ?? true,
    facts: raw.facts ?? [],
    recentEpisodes: raw.recentEpisodes ?? raw.episodes ?? [],
  };
}
