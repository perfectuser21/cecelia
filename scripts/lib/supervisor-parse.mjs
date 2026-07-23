/**
 * supervisor-parse.mjs — codex/grok headless supervisor 共享解析纯函数
 *
 * 从 codex-supervisor.mjs / grok-supervisor.mjs 内联函数原样抽出（commit-1 红阶段：
 * 逻辑逐行拷贝、未修复），供行为测试直接 import（supervisor 模块顶部有
 * HARNESS_TASK_ID 缺失即 process.exit 的副作用，不能被测试 import）。
 *
 * 三态协议：'continue' | 'complete' | 'blocked'；无法解析保守 fallback 'continue'。
 */

// ─── 三态字段映射（codex/grok 内联体原本相同的部分）─────────────────────────

function decisionFromObject(obj) {
  if (obj.decision === 'continue' || obj.status === 'continue') return 'continue';
  if (obj.decision === 'complete' || obj.status === 'complete' || obj.status === 'completed') return 'complete';
  if (obj.decision === 'blocked' || obj.status === 'blocked') return 'blocked';
  if (obj.outcome === 'complete' || obj.outcome === 'completed') return 'complete';
  if (obj.outcome === 'blocked') return 'blocked';
  if (obj.outcome === 'continue') return 'continue';
  return null;
}

// ─── Codex ────────────────────────────────────────────────────────────────────

export function parseCodexDecision(stdout) {
  const lines = stdout.split('\n').filter(Boolean);

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const d = decisionFromObject(obj);
      if (d) return d;
    } catch {
      // 非 JSON 行，跳过
    }
  }

  // 默认：无法解析 → continue（保守策略）
  return 'continue';
}

export function extractCodexSessionId(stdout) {
  const lines = stdout.split('\n').filter(Boolean);
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

export function parseGrokDecision(stdout) {
  const lines = stdout.split('\n').filter(Boolean);

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const d = decisionFromObject(obj);
      if (d) return d;
    } catch {
      // skip non-JSON
    }
  }

  return 'continue';
}

export function extractGrokSessionId(stdout) {
  const lines = stdout.split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const sid = obj.session_id ?? obj.session?.id ?? obj.thread_id;
      if (sid) return String(sid);
    } catch {
      // skip
    }
  }
  return null;
}
