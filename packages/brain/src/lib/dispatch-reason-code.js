// 派发失败原因结构化：dispatcher autoblock detail / task_events / executor 返回体共用。
// 精确码（needs_rebase / map_thrash）优先于前缀码；按非单词字符分词后整段取 token，
// 不做贪婪子串匹配（避免 map_revision_mismatch_needs_rebase 被吞成复合串、map_scope_v2 被截成 map_scope_v）。
const EXACT_CODES = ['needs_rebase', 'map_thrash'];
const PREFIX_TOKEN = /^(map|impact|credential)_[a-z0-9_]+$/;

/**
 * @param {{reason_code?: string, error?: unknown, reason?: unknown}} [execResult]
 * @returns {string} 显式 reason_code；否则 error/reason 文本里的精确码或以 map_ / impact_ / credential_ 开头的整段 token；兜底 'executor_failed'
 */
export function classifyDispatchReasonCode(execResult = {}) {
  const explicit = execResult?.reason_code;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const text = String(execResult?.error || execResult?.reason || '');
  const exact = EXACT_CODES.find((code) => text.includes(code));
  if (exact) return exact;
  const tokens = text.split(/[^a-z0-9_]+/i).filter(Boolean);
  const prefixed = tokens.find((token) => PREFIX_TOKEN.test(token));
  return prefixed ?? 'executor_failed';
}
