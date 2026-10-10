/**
 * qiumi-resource-health.js — 秋米路由出口的资源健康闸（任务 5bf2512a 审查修复）
 *
 * 路由定到一台手机后（device 出口派生 device_job / agent 出口起 openclaw agent），点火前查：
 *   · 这台手机（phone:<serial>）
 *   · 这台手机台账里当前登录的账号（phone_registry.douyin_accounts 里 current=true → account:douyin:<id>）
 * 有 offline / restricted 就不派。账号维度从台账推，不依赖建单方往 payload 写 account_ref。
 *
 * 被挡的单记进进程内备忘（taskId → serial），下一轮先只复查那台手机：仍不健康就直接让位、不再打 Jev，
 * 防每 tick 白路由一次；恢复或备忘过期（默认 30 分钟）才重新路由。重启丢备忘最多多路由一次。
 *
 * fail-safe：台账查询出错只记日志、按没有账号处理；健康闸本身出错放行（见 resource-health-gate.js）。
 */
import { accountKey } from './resource-health.js';
import { resourceHealthGate } from './resource-health-gate.js';

const BLOCKED_ROUTE_TTL_MS = 30 * 60 * 1000;
const BLOCKED_ROUTE_MAX = 500;
const blockedRoutes = new Map();

/** 测试用：清空被挡路由备忘。 */
export function _resetBlockedRouteMemo() {
  blockedRoutes.clear();
}

export function rememberBlockedRoute(taskId, serial, nowMs = Date.now()) {
  if (!taskId || !serial) return;
  if (blockedRoutes.size >= BLOCKED_ROUTE_MAX) blockedRoutes.clear();
  blockedRoutes.set(taskId, { serial, at: nowMs });
}

/** @returns {string|null} 仍在有效期内的被挡手机 serial */
export function recallBlockedRoute(taskId, nowMs = Date.now()) {
  const memo = blockedRoutes.get(taskId);
  if (!memo) return null;
  if (nowMs - memo.at > BLOCKED_ROUTE_TTL_MS) {
    blockedRoutes.delete(taskId);
    return null;
  }
  return memo.serial;
}

export function forgetBlockedRoute(taskId) {
  blockedRoutes.delete(taskId);
}

/**
 * 手机台账里当前登录的账号 → 资源引用。查不到 / 出错 → 空数组（fail-safe）。
 * @returns {Promise<Array<{type: 'account', key: string}>>}
 */
export async function phoneAccountRefs(pool, serial) {
  if (!serial) return [];
  try {
    const { rows } = await pool.query('SELECT douyin_accounts FROM phone_registry WHERE serial = $1', [serial]);
    const accounts = Array.isArray(rows[0]?.douyin_accounts) ? rows[0].douyin_accounts : [];
    return accounts
      .filter((a) => a && a.current === true)
      .map((a) => accountKey('douyin', a.id ?? a.account_id))
      .filter(Boolean)
      .map((key) => ({ type: 'account', key }));
  } catch (err) {
    console.error(`[qiumi-resource-health] 手机台账查询出错，只按手机判（fail-safe） serial=${serial}: ${err.message}`);
    return [];
  }
}

/**
 * 路由定到 serial 这台手机后的健康闸：手机 + 它当前账号 + payload 里原有的引用。
 * @returns {Promise<{blocked: boolean, summary?: string}>}
 */
export async function qiumiRouteHealthGate(task, serial, { pool, payload, tag }) {
  const base = payload ?? task?.payload ?? {};
  const accountRefs = await phoneAccountRefs(pool, serial);
  const resourceRefs = [...(Array.isArray(base.resource_refs) ? base.resource_refs : []), ...accountRefs];
  return resourceHealthGate(task, {
    pool,
    payload: { ...base, ...(serial ? { device_serial: serial } : {}), resource_refs: resourceRefs },
    tag,
  });
}
