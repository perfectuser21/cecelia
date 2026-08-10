/**
 * credential-freshness.js
 *
 * 派发前**只读**凭据新鲜度闸。
 *
 * 事故背景（2026-08-10）：provider 凭据 access token 过期期间，kernel 仍照常派发
 * attempt，每次 384ms 死在 "Not logged in · Please run /login"，零 token 消耗纯空转，
 * 三条 run 因此被判 terminal（callback_runner_failure）。根因是 dispatch 前没有对目标
 * account 的本地 credentials 文件做新鲜度校验。
 *
 * 本模块提供纯只读检查：读取 `claudeAiOauth.expiresAt`，计算剩余有效期，低于阈值
 * （默认 10 分钟，可用 HARNESS_CREDENTIAL_FRESHNESS_THRESHOLD_MS 覆盖）或文件缺失/
 * 无法解析/缺 claudeAiOauth 时判「不新鲜」。capability gate 据此在派发前拦截该 account，
 * 走既有 infrastructure backoff 语义（不消耗 attempt、按 POLL_INTERVAL_MS 退避、由
 * deadline 收敛），凭据恢复新鲜后 run 自行继续。
 *
 * 红线：**纯只读**——只 readFileSync，绝不写入/重命名/触发刷新（token 刷新由
 * infrastructure 的 refresh-claude-tokens.sh 独占，受决策 4ce29c14 约束，见任务边界）。
 */

import { readFileSync } from 'node:fs';

export const DEFAULT_CREDENTIAL_FRESHNESS_THRESHOLD_MS = 10 * 60 * 1000; // 10 分钟
export const CREDENTIAL_FRESHNESS_THRESHOLD_ENV = 'HARNESS_CREDENTIAL_FRESHNESS_THRESHOLD_MS';

export const CREDENTIAL_FRESHNESS_REASONS = Object.freeze({
  FRESH: 'fresh',
  EXPIRING_SOON: 'credential_expiring_soon',
  EXPIRED: 'credential_expired',
  FILE_MISSING: 'credential_file_missing',
  PARSE_ERROR: 'credential_parse_error',
  OAUTH_MISSING: 'credential_oauth_missing',
});

// 非 fresh 的所有原因（capability gate 用来判定 fallback_reason 是否是凭据类拦截）
export const CREDENTIAL_FRESHNESS_BLOCK_REASONS = Object.freeze(new Set([
  CREDENTIAL_FRESHNESS_REASONS.EXPIRING_SOON,
  CREDENTIAL_FRESHNESS_REASONS.EXPIRED,
  CREDENTIAL_FRESHNESS_REASONS.FILE_MISSING,
  CREDENTIAL_FRESHNESS_REASONS.PARSE_ERROR,
  CREDENTIAL_FRESHNESS_REASONS.OAUTH_MISSING,
]));

/**
 * 解析阈值（毫秒）。env 覆盖非法（空 / 非数字 / 负数）时回落默认值。
 * @param {Record<string, string|undefined>} [env]
 * @returns {number}
 */
export function resolveCredentialFreshnessThresholdMs(env = process.env) {
  const raw = env?.[CREDENTIAL_FRESHNESS_THRESHOLD_ENV];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return DEFAULT_CREDENTIAL_FRESHNESS_THRESHOLD_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_CREDENTIAL_FRESHNESS_THRESHOLD_MS;
  }
  return parsed;
}

/**
 * 只读检查单个 credentials 文件的新鲜度。
 *
 * @param {object} args
 * @param {string} args.credentialPath 目标 credentials.json 绝对路径
 * @param {(() => number)|number} [args.now] 当前时刻（ms），默认 Date.now
 * @param {number} [args.thresholdMs] 阈值（ms），默认 10 分钟
 * @param {(p: string) => string} [args.readFile] 只读读取器（默认 readFileSync utf8）——
 *        注入点仅暴露读能力，从设计上杜绝写入
 * @returns {{ fresh: boolean, reason: string, remainingMs?: number, expiresAtMs?: number,
 *            credentialPath: string, message?: string }}
 */
export function inspectCredentialFreshness({
  credentialPath,
  now = Date.now,
  thresholdMs = DEFAULT_CREDENTIAL_FRESHNESS_THRESHOLD_MS,
  readFile = (p) => readFileSync(p, 'utf8'),
} = {}) {
  const nowMs = typeof now === 'function' ? now() : Number(now);

  let raw;
  try {
    raw = readFile(credentialPath);
  } catch (err) {
    // ENOENT 或任何读失败 → 目标凭据不可用，按缺失拦截（绝不尝试创建/修复）
    return {
      fresh: false,
      reason: CREDENTIAL_FRESHNESS_REASONS.FILE_MISSING,
      credentialPath,
      message: `credentials file unreadable: ${err?.message ?? String(err)}`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      fresh: false,
      reason: CREDENTIAL_FRESHNESS_REASONS.PARSE_ERROR,
      credentialPath,
      message: `credentials JSON parse error: ${err?.message ?? String(err)}`,
    };
  }

  const oauth = parsed?.claudeAiOauth;
  const expiresAtMs = oauth?.expiresAt;
  if (oauth == null || typeof expiresAtMs !== 'number' || !Number.isFinite(expiresAtMs)) {
    return {
      fresh: false,
      reason: CREDENTIAL_FRESHNESS_REASONS.OAUTH_MISSING,
      credentialPath,
      message: 'credentials missing claudeAiOauth.expiresAt',
    };
  }

  const remainingMs = expiresAtMs - nowMs;
  if (remainingMs <= 0) {
    return {
      fresh: false,
      reason: CREDENTIAL_FRESHNESS_REASONS.EXPIRED,
      remainingMs,
      expiresAtMs,
      credentialPath,
      message: `token expired ${Math.abs(Math.round(remainingMs / 1000))}s ago`,
    };
  }
  if (remainingMs < thresholdMs) {
    return {
      fresh: false,
      reason: CREDENTIAL_FRESHNESS_REASONS.EXPIRING_SOON,
      remainingMs,
      expiresAtMs,
      credentialPath,
      message: `token expires in ${Math.round(remainingMs / 1000)}s (< threshold ${Math.round(thresholdMs / 1000)}s)`,
    };
  }

  return {
    fresh: true,
    reason: CREDENTIAL_FRESHNESS_REASONS.FRESH,
    remainingMs,
    expiresAtMs,
    credentialPath,
  };
}

/**
 * 构造 account 级新鲜度检查器（供 capability gate / 生产 wiring 注入）。
 *
 * resolveCredentialPath 返回 null 时表示该 provider 无本地 OAuth 凭据（如 codex/grok），
 * 直接跳过（视为 fresh，skipped=true）——本闸只管 Claude OAuth 凭据（事故当事方）。
 *
 * @param {object} args
 * @param {(provider: string, account: string) => (string|null)} args.resolveCredentialPath
 * @param {(() => number)|number} [args.now]
 * @param {number} [args.thresholdMs] 显式阈值；缺省时从 env 解析
 * @param {Record<string, string|undefined>} [args.env]
 * @param {(p: string) => string} [args.readFile]
 * @returns {(target: { provider: string, account: string, machine?: string }) => object}
 */
export function createCredentialFreshnessCheck({
  resolveCredentialPath,
  now = Date.now,
  thresholdMs,
  env = process.env,
  readFile,
} = {}) {
  if (typeof resolveCredentialPath !== 'function') {
    throw new Error('createCredentialFreshnessCheck requires resolveCredentialPath');
  }
  const resolvedThreshold = thresholdMs ?? resolveCredentialFreshnessThresholdMs(env);

  return function checkCredentialFreshness({ provider, account, machine } = {}) {
    let credentialPath;
    try {
      credentialPath = resolveCredentialPath(provider, account);
    } catch (err) {
      return {
        fresh: false,
        reason: CREDENTIAL_FRESHNESS_REASONS.FILE_MISSING,
        provider,
        account,
        machine,
        message: `cannot resolve credential path: ${err?.message ?? String(err)}`,
      };
    }

    if (!credentialPath) {
      // provider 无本地凭据 → 不由本闸管辖
      return {
        fresh: true,
        reason: CREDENTIAL_FRESHNESS_REASONS.FRESH,
        skipped: true,
        provider,
        account,
        machine,
      };
    }

    const detail = inspectCredentialFreshness({
      credentialPath,
      now,
      thresholdMs: resolvedThreshold,
      ...(readFile ? { readFile } : {}),
    });
    return { ...detail, provider, account, machine };
  };
}
