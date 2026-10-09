// 派发失败原因结构化：dispatcher autoblock detail / task_events / executor 返回体共用。
// 精确码（needs_rebase / map_thrash / 重锚定调用契约违约码）优先于前缀码；按非单词字符分词后整段取 token，
// 不做贪婪子串匹配（避免 map_revision_mismatch_needs_rebase 被吞成复合串、map_scope_v2 被截成 map_scope_v）。
const EXACT_CODES = ['needs_rebase', 'map_thrash', 'task_metadata_missing', 'receipt_task_mismatch', 'receipt_superseded'];
const PREFIX_TOKEN = /^(map|impact|credential)_[a-z0-9_]+$/;

/** 派发语义码白名单：只有这些码允许从 err.code 直采。 */
export const KNOWN_REASON_CODES = Object.freeze(new Set(EXACT_CODES));

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

/**
 * 把异常翻译成派发失败返回体的三个字段（纯函数，executor 各 catch 共用）。
 * err.code 是个拥挤的命名空间——pg 错误码（'23505'）、node 网络码（'ECONNREFUSED'）都住在里面，
 * 只有白名单内的码才是派发语义码，其余一律退回文本分类，避免 DB/网络故障被伪装成契约违约。
 * @param {{code?: unknown, message?: unknown, detail?: unknown}} [err]
 * @returns {{reason: string, reason_code: string, detail: unknown}}
 */
export function dispatchFailureFromError(err = {}) {
  const reasonCode = typeof err?.code === 'string' && KNOWN_REASON_CODES.has(err.code)
    ? err.code
    : classifyDispatchReasonCode({ error: err?.message });
  return {
    // needs_rebase 是「分支有产出但 base_sha 落后」的停车信号，不是执行故障（任务 d9c405e2）。
    reason: reasonCode === 'needs_rebase' ? 'needs_rebase' : 'kernel_authority_not_created',
    reason_code: reasonCode,
    detail: err?.detail ?? null,
  };
}
