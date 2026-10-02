/**
 * 访客标识（visitorId）
 *
 * 前台 Agent 执行页与 Demo 聊天页共用同一个 localStorage key，
 * 因此访客在两条入口之间切换时，长期记忆仍然是同一份画像。
 * 只能在客户端组件的事件/副作用里调用（内部访问 localStorage）。
 */

export const VISITOR_ID_STORAGE_KEY = "snackops_visitor_id";

/** 读取或生成访客标识；localStorage 不可用（隐私模式等）时退回「本次页面会话内稳定」的 id */
export function getOrCreateVisitorId(): string {
  try {
    const saved = localStorage.getItem(VISITOR_ID_STORAGE_KEY);
    if (saved) return saved;
  } catch {
    /* 读不到就当场生成，且不再尝试持久化 */
  }
  const created = `cu_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  try {
    localStorage.setItem(VISITOR_ID_STORAGE_KEY, created);
  } catch {
    /* 忽略：写不进去也不影响本次使用 */
  }
  return created;
}
