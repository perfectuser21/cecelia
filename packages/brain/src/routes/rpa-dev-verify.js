/**
 * RPA 开发快验通道 — Brain 代理端点
 *
 * 设计文档: docs/architecture/2026-07-13-rpa-target-environment-axis/design.md
 *
 * POST /api/brain/rpa/dev-verify
 *
 * 接收容器/开发者的快验请求，校验白名单后代理到 ZenithJoy Agent
 * （默认 http://localhost:5200/api/agent-ops/rpa/dev-verify），
 * 同步返回完整 stdout + exit_code。
 *
 * 三条线（wechat / douyin / publish）共享同一端点，action 白名单按 line 隔离。
 */

import { Router } from 'express';

const router = Router();

// ─── 安全白名单：按 line 限制允许的 action ────────────────────────────────────

const ACTION_WHITELIST = {
  wechat: new Set(['health_check', 'send_message', 'screenshot', 'click', 'read_inbox']),
  douyin: new Set(['health_check', 'broadcast', 'status']),
  publish: new Set(['health_check', 'cdp_click', 'cdp_screenshot', 'cdp_navigate']),
};

const VALID_LINES = Object.keys(ACTION_WHITELIST);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;

// ─── 依赖注入接口（测试用）────────────────────────────────────────────────────

let _fetchFn = globalThis.fetch;
export function _injectFetch(fn) { _fetchFn = fn; }
export function _resetFetch() { _fetchFn = globalThis.fetch; }

export function getAgentUrl() {
  return (process.env.RPA_AGENT_URL || 'http://localhost:5200').replace(/\/$/, '');
}

export function isEnabled() {
  return process.env.RPA_DEV_VERIFY_ENABLED !== 'false';
}

// ─── POST /dev-verify ────────────────────────────────────────────────────────

router.post('/dev-verify', async (req, res) => {
  if (!isEnabled()) {
    return res.status(503).json({ ok: false, error: 'rpa_dev_verify_disabled' });
  }

  const { line, action, params = {}, timeout_ms: rawTimeout } = req.body || {};

  // 参数校验
  if (!line || !VALID_LINES.includes(line)) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_line',
      valid_lines: VALID_LINES,
    });
  }

  if (!action || typeof action !== 'string') {
    return res.status(400).json({ ok: false, error: 'action_required' });
  }

  const allowedActions = ACTION_WHITELIST[line];
  if (!allowedActions.has(action)) {
    return res.status(400).json({
      ok: false,
      error: 'action_not_allowed',
      action,
      allowed: [...allowedActions],
    });
  }

  if (params && typeof params !== 'object') {
    return res.status(400).json({ ok: false, error: 'params_must_be_object' });
  }

  const timeoutMs = Math.min(
    typeof rawTimeout === 'number' && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );

  const agentUrl = `${getAgentUrl()}/api/agent-ops/rpa/dev-verify`;
  const startMs = Date.now();

  let agentRes;
  try {
    agentRes = await _fetchFn(agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line, action, params, timeout_ms: timeoutMs }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const elapsed_ms = Date.now() - startMs;
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return res.status(504).json({ ok: false, error: 'timeout', timeout_ms: timeoutMs, elapsed_ms });
    }
    return res.status(502).json({
      ok: false,
      error: 'agent_unreachable',
      message: err instanceof Error ? err.message : String(err),
      elapsed_ms,
    });
  }

  const elapsed_ms = Date.now() - startMs;
  let body;
  try {
    body = await agentRes.json();
  } catch {
    return res.status(502).json({ ok: false, error: 'agent_invalid_json', elapsed_ms });
  }

  if (!agentRes.ok) {
    return res.status(502).json({
      ok: false,
      ...(body || {}),
      error: 'agent_error',
      agent_status: agentRes.status,
      elapsed_ms,
    });
  }

  return res.status(200).json({ ok: true, elapsed_ms, ...body });
});

export default router;
