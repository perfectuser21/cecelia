/**
 * supervisor-parse.mjs — codex/grok headless supervisor 共享解析纯函数
 *
 * 对齐真实 CLI 输出（2026-07-23 实跑 fixture 锁死于
 * tests/regression/codex-grok-launcher-supervisor/__fixtures__/）：
 *
 * codex `exec --json`：JSONL 事件流，agent 回复嵌在 item.completed 事件的
 *   item.text 字符串里（模型被要求回 {"decision":...} 时，它也只是 text 里的
 *   JSON 字符串，不会出现在事件顶层）；session 在 thread.started 的顶层 thread_id。
 *
 * grok `-p ... --output-format json`：单个多行 pretty JSON 对象（非 JSONL，
 *   逐行 parse 必失败），决策嵌在 .text，session 字段是驼峰 sessionId。
 *
 * 三态协议：'continue' | 'complete' | 'blocked'；无法解析保守 fallback 'continue'，
 * session 提取失败返回 null，均不抛异常。
 */

// ─── 三态字段映射 ─────────────────────────────────────────────────────────────

function decisionFromObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.decision === 'continue' || obj.status === 'continue') return 'continue';
  if (obj.decision === 'complete' || obj.status === 'complete' || obj.status === 'completed') return 'complete';
  if (obj.decision === 'blocked' || obj.status === 'blocked') return 'blocked';
  if (obj.outcome === 'complete' || obj.outcome === 'completed') return 'complete';
  if (obj.outcome === 'blocked') return 'blocked';
  if (obj.outcome === 'continue') return 'continue';
  return null;
}

/**
 * 从 agent 自由文本里抽三态决策：取第一个 {...} JSON 子串（容忍 ```json 围栏、
 * 前后缀散文），parse 后走三态字段映射。无命中 → null。
 */
export function extractDecisionFromText(text) {
  if (typeof text !== 'string' || !text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return decisionFromObject(JSON.parse(m[0]));
  } catch {
    return null;
  }
}

// ─── Codex ────────────────────────────────────────────────────────────────────

/**
 * codex exec --json（JSONL 事件流）→ 三态。
 * 顶层字段兼容保留（未来 CLI 若直出顶层 decision 仍可用）；
 * agent_message 嵌套决策以最后一条命中为准（最终答复优先）。
 */
export function parseCodexDecision(stdout) {
  const lines = String(stdout ?? '').split('\n').filter(Boolean);
  let nested = null;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const top = decisionFromObject(obj);
      if (top) return top;
      if (obj.type === 'item.completed' && obj.item?.type === 'agent_message') {
        const d = extractDecisionFromText(obj.item.text);
        if (d) nested = d; // 最后命中优先
      }
    } catch {
      // 非 JSON 行，跳过
    }
  }

  // 默认：无法解析 → continue（保守策略）
  return nested ?? 'continue';
}

export function extractCodexSessionId(stdout) {
  const lines = String(stdout ?? '').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const sid = obj.thread_id ?? obj.thread?.id ?? obj.session_id ?? obj.session?.id;
      if (sid) return String(sid);
    } catch {
      // skip
    }
  }
  return null;
}

// ─── Grok ─────────────────────────────────────────────────────────────────────

/**
 * grok --output-format json（单个多行 pretty JSON 对象）→ 三态。
 * 先整块 parse：顶层字段 → 嵌套 .text；整块失败退回逐行 JSONL 兜底（向前兼容）。
 */
export function parseGrokDecision(stdout) {
  const raw = String(stdout ?? '');

  try {
    const obj = JSON.parse(raw.trim());
    const top = decisionFromObject(obj);
    if (top) return top;
    const nested = extractDecisionFromText(obj.text);
    if (nested) return nested;
    return 'continue';
  } catch {
    // 整块不是 JSON → 逐行 JSONL 兜底
  }

  const lines = raw.split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const d = decisionFromObject(obj) ?? extractDecisionFromText(obj.text);
      if (d) return d;
    } catch {
      // skip non-JSON
    }
  }

  return 'continue';
}

export function extractGrokSessionId(stdout) {
  const raw = String(stdout ?? '');

  try {
    const obj = JSON.parse(raw.trim());
    const sid = obj.sessionId ?? obj.session_id ?? obj.session?.id ?? obj.thread_id;
    if (sid) return String(sid);
    return null;
  } catch {
    // 整块不是 JSON → 逐行兜底
  }

  const lines = raw.split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const sid = obj.sessionId ?? obj.session_id ?? obj.session?.id ?? obj.thread_id;
      if (sid) return String(sid);
    } catch {
      // skip
    }
  }
  return null;
}
