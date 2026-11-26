// 共享模型进程的原始 JSONL 错误与计费解析。
/** stdout 里能解析为 JSON 的事件（每行一个，非 JSON 行忽略）。 */
function events(stdout) {
  const out = [];
  for (const line of String(stdout).split('\n')) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // 非 JSON 行（日志等）
    }
  }
  return out;
}

/**
 * 会话自身的错误文本：出错的 `type:"result"` 事件（is_error 或 subtype 非 success）的 subtype 与 result，
 * 以及 `type:"error"` / Codex `type:"turn.failed"` 事件的消息。不含 tool_result 里的业务输出，供鉴权判定使用。
 */
export function claudeOwnErrorText(stdout) {
  const parts = [];
  for (const event of events(stdout)) {
    if (event?.type === 'result' && (event.is_error === true || (event.subtype && event.subtype !== 'success'))) {
      parts.push(String(event.subtype ?? ''), typeof event.result === 'string' ? event.result : '');
    } else if (event?.type === 'error' || event?.type === 'turn.failed') {
      parts.push(String(event.error?.message ?? event.message ?? ''));
    }
  }
  return parts.filter(Boolean).join('\n');
}

/** 原生会话费用；Codex JSONL 只给 token usage，美元费用未知，不估价。 */
export function sessionCostUsd(stdout) {
  const rows = events(stdout);
  if (rows.some((event) => /^(thread|turn|item)\./.test(event?.type ?? ''))) return null;
  let cost = 0; // 保留旧 Claude 缺计费事件的兼容口径；Codex 空输出由 provider 显式给 null。
  for (const event of rows) {
    if (event?.type === 'result' && Number.isFinite(event.total_cost_usd)) cost = event.total_cost_usd;
  }
  return cost;
}

