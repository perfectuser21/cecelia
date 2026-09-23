// 派发失败原因结构化：dispatcher autoblock detail / task_events / executor 返回体共用。
const KNOWN_PREFIX = /(map_[a-z_]+|impact_[a-z_]+|credential_[a-z_]+|needs_rebase|map_thrash)/;

export function classifyDispatchReasonCode(execResult = {}) {
  const explicit = execResult?.reason_code;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const text = String(execResult?.error || execResult?.reason || '');
  const matched = text.match(KNOWN_PREFIX);
  return matched ? matched[1] : 'executor_failed';
}
