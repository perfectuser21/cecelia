/**
 * cap-marking middleware — Brain v2 Layer 3 attempt-loop 内循环第 e 步。
 * 见 docs/design/brain-orchestrator-v2.md §5.2。
 *
 * 职责：检测 runDocker result 的 stdout/stderr 是否含 429 / spending cap 特征，若含
 * 且 opts.env.CECELIA_CREDENTIALS 可知，调 markSpendingCap 标记该账号为 capped。
 * 下次 attempt-loop 迭代时 account-rotation 自动换号。
 *
 * v2 P2 PR 5（本 PR）：建立模块 + 单测，暂不接线到 executeInDocker。
 * 未来 attempt-loop 整合 PR 在 runDocker 返回后调用它。
 *
 * 检测模式（任一命中即视为 capped）：
 *   - stdout/stderr 含 `api_error_status:429`
 *   - stdout/stderr 含 `"type":"rate_limit_error"`
 *   - stdout/stderr 含 `credit balance is too low`
 *
 * @param {object} result  runDocker 返回 { exit_code, stdout, stderr, ... }
 * @param {object} opts    executeInDocker 输入 { env: { CECELIA_CREDENTIALS } }
 * @param {object} ctx     { deps? } — 测试注入 { markSpendingCap }
 * @returns {Promise<{ capped: boolean, account: string|null, reason: string|null }>}
 */
const CAP_PATTERNS = [
  /api_error_status:\s*429/i,
  /"type"\s*:\s*"rate_limit_error"/i,
  /credit balance is too low/i,
];

export async function checkCap(result, opts, ctx = {}) {
  if (!result || typeof result !== 'object') {
    return { capped: false, account: null, reason: null };
  }
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  let matchedPattern = null;
  for (const p of CAP_PATTERNS) {
    if (p.test(combined)) {
      matchedPattern = p.source;
      break;
    }
  }
  if (!matchedPattern) {
    return { capped: false, account: null, reason: null };
  }
  const account = opts?.env?.CECELIA_CREDENTIALS || null;
  if (!account) {
    console.warn(`[cap-marking] detected cap pattern but no CECELIA_CREDENTIALS to mark`);
    return { capped: true, account: null, reason: matchedPattern };
  }
  try {
    let markFn;
    if (ctx.deps?.markSpendingCap) {
      markFn = ctx.deps.markSpendingCap;
    } else {
      const mod = await import('../../account-usage.js');
      markFn = mod.markSpendingCap;
    }
    markFn(account);
    console.log(`[cap-marking] marked ${account} as capped (pattern: ${matchedPattern})`);
  } catch (err) {
    console.warn(`[cap-marking] failed to mark ${account}: ${err.message}`);
  }
  return { capped: true, account, reason: matchedPattern };
}

/**
 * checkAuthFailure — 401/凭据失效检测（harness 根因 2，2026-06-10）。
 *
 * 职责：检测容器输出是否含 401 / authentication_error / OAuth 过期 / claude CLI
 * "Not logged in" 特征，若含且账号可知，调 markAuthFailure 熔断该账号。
 * 下次 resolveAccount（attempt-loop 或 harness fix-round 重 spawn）自动换号。
 *
 * 与 checkCap 同构：本模块是 markSpendingCap/markAuthFailure 的唯一合法调用点
 * （见 README §5 禁忌），harness awaitCallbackNode 通过本函数标记，不直接调。
 *
 * @param {object} result  { stdout, stderr }（callback payload 或 runDocker 返回）
 * @param {object} opts    { env: { CECELIA_CREDENTIALS } }
 * @param {object} ctx     { deps? } — 测试注入 { markAuthFailure }
 * @returns {Promise<{ authFailed: boolean, account: string|null, reason: string|null }>}
 */
const AUTH_PATTERNS = [
  /api_error_status:\s*401/i,
  /"type"\s*:\s*"authentication_error"/i,
  /OAuth token (has )?(expired|been revoked)/i,
  /Not logged in/i,
  /invalid (api key|bearer token)/i,
];

export async function checkAuthFailure(result, opts, ctx = {}) {
  if (!result || typeof result !== 'object') {
    return { authFailed: false, account: null, reason: null };
  }
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  let matchedPattern = null;
  for (const p of AUTH_PATTERNS) {
    if (p.test(combined)) {
      matchedPattern = p.source;
      break;
    }
  }
  if (!matchedPattern) {
    return { authFailed: false, account: null, reason: null };
  }
  const account = opts?.env?.CECELIA_CREDENTIALS || null;
  if (!account) {
    console.warn('[cap-marking] detected auth failure pattern but no CECELIA_CREDENTIALS to mark');
    return { authFailed: true, account: null, reason: matchedPattern };
  }
  try {
    let markFn;
    if (ctx.deps?.markAuthFailure) {
      markFn = ctx.deps.markAuthFailure;
    } else {
      const mod = await import('../../account-usage.js');
      markFn = mod.markAuthFailure;
    }
    markFn(account, null, 'api_error');
    console.log(`[cap-marking] marked ${account} as auth-failed (pattern: ${matchedPattern})`);
  } catch (err) {
    console.warn(`[cap-marking] failed to mark auth failure ${account}: ${err.message}`);
  }
  return { authFailed: true, account, reason: matchedPattern };
}
