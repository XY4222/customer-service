/**
 * 转人工信号（确定性规则）
 *
 * 为什么需要它：`skills/human-handoff-decision` 是否被判为"需要人工"原本完全依赖模型自觉——
 * 实测「我要投诉！必须给我赔偿」这类明确请求，模型有时不会规划该步骤，课堂演示因此不可复现。
 * 这里给出**确定性**信号表，供两处共用：
 * - `planner.ts`：命中即把 human-handoff-decision 追加进计划（不依赖模型自觉）
 * - `llm.ts` 的 classroom-fixture：命中即返回 needsHuman=true（无模型时也能演示转人工）
 */

/** 触发转人工的关键词（与 skills/human-handoff-decision 的判定清单保持一致） */
export const HANDOFF_SIGNALS = [
  "转人工",
  "人工客服",
  "找客服",
  "真人",
  "投诉",
  "举报",
  "曝光",
  "12315",
  "消协",
  "赔偿",
  "赔付",
  "异物",
  "头发",
  "变质",
  "过期",
  "吃坏",
  "食品安全",
  "过敏反应",
  "身体不适",
  "诈骗",
  "起诉",
  "律师",
];

/** 返回命中的信号词（用于给运营/坐席解释"为什么转人工"） */
export function detectHandoffSignals(question: string): string[] {
  if (!question) return [];
  return HANDOFF_SIGNALS.filter((word) => question.includes(word));
}

/** 是否需要转人工（确定性判定，不调用模型） */
export function needsHandoff(question: string): boolean {
  return detectHandoffSignals(question).length > 0;
}
