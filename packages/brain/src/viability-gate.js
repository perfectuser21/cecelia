/**
 * Dispatch Viability Gate — 派发前执行依赖可行性检查
 *
 * 背景（learning_id b90b042d）：executor 依赖外部服务的系统必须在派发前验证依赖可行性，
 * 否则任何依赖失效（token 过期、payload 缺失）都会产生无效派发，累计 162 次。
 *
 * 与 pre-flight-check.js 的分工：
 *   pre-flight-check  → 任务描述质量（title/description/priority/insight 约束）
 *   viability-gate    → 执行依赖可行性（外部服务状态、payload 完整性、账号 auth）
 *
 * 检查项（按优先级）：
 *   1. content_publish platform 必须存在且合法
 *   2. content_publish export_path 必须非空（发布内容未准备好则无法执行）
 *   3. content_publish wechat：今日 auth_fail 次数 ≥ 阈值 → 阻断，避免 token 失效风暴
 *   4. payload.account_id 指定账号处于 auth 熔断 → 阻断
 *
 * 所有检查失败均返回 { viable: false, reason, check }，
 * 调用方（dispatcher.js）据此跳过该任务并落 metadata + 告警。
 */

import pool from './db.js';
import { isAuthFailed } from './account-usage.js';
import { raise } from './alerting.js';

/** 微信 access_token 失效错误码（同 publish-monitor.js 保持一致） */
const WECHAT_TOKEN_ERROR_CODES = ['40001', '40014', '42001', '42007'];

/** 今日 wechat auth_fail 次数达到此阈值时，阻断新 wechat 任务派发 */
const WECHAT_AUTH_FAIL_DISPATCH_THRESHOLD = 2;

/** content_publish 已知合法平台列表（同 executor.js publisherSkillMap 保持一致） */
const KNOWN_PLATFORMS = new Set([
  'douyin', 'kuaishou', 'toutiao', 'weibo', 'xiaohongshu', 'zhihu', 'wechat', 'shipinhao',
]);

/**
 * 检查任务的执行依赖可行性。
 *
 * @param {object} task - 任务对象（含 id / task_type / payload 等）
 * @param {import('pg').Pool} [dbPool] - 可选 pg pool（测试注入用）
 * @returns {Promise<{viable:boolean, reason?:string, check?:string}>}
 */
export async function checkDispatchViability(task, dbPool) {
  const db = dbPool || pool;

  if (task.task_type === 'content_publish') {
    const platform = task.payload?.platform;

    if (!platform) {
      return {
        viable: false,
        check: 'content_publish_platform_missing',
        reason: 'content_publish: payload.platform 缺失，无法路由到对应发布器',
      };
    }

    if (!KNOWN_PLATFORMS.has(platform)) {
      return {
        viable: false,
        check: 'content_publish_platform_unknown',
        reason: `content_publish: 未知 platform="${platform}"，不在已知平台列表`,
      };
    }

    const exportPath = task.payload?.export_path;
    if (!exportPath || String(exportPath).trim() === '') {
      return {
        viable: false,
        check: 'content_publish_export_path_missing',
        reason: 'content_publish: payload.export_path 缺失，发布内容文件未准备好',
      };
    }

    if (platform === 'wechat') {
      try {
        const failCount = await countWechatAuthFailsToday(db);
        if (failCount >= WECHAT_AUTH_FAIL_DISPATCH_THRESHOLD) {
          return {
            viable: false,
            check: 'wechat_auth_fail_storm',
            reason: `wechat access_token 失效中（今日 ${failCount} 次 auth_fail ≥ 阈值 ${WECHAT_AUTH_FAIL_DISPATCH_THRESHOLD}），阻断派发避免无效执行风暴`,
          };
        }
      } catch (err) {
        console.warn('[viability-gate] wechat auth_fail check failed (non-fatal):', err.message);
      }
    }
  }

  const accountId = task.payload?.account_id;
  if (accountId && isAuthFailed(accountId)) {
    return {
      viable: false,
      check: 'account_auth_failed',
      reason: `账号 ${accountId} auth 已熔断，等凭据恢复后再派发`,
    };
  }

  return { viable: true };
}

/**
 * 查询今日微信 content_publish auth_fail 次数。
 * 与 publish-monitor.js fetchWechatAuthFailsToday 逻辑等价，
 * 此处返回计数（不返回行），减少数据传输。
 *
 * @param {import('pg').Pool} db
 * @returns {Promise<number>}
 */
async function countWechatAuthFailsToday(db) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS cnt
     FROM tasks
     WHERE task_type = 'content_publish'
       AND payload->>'platform' = 'wechat'
       AND status = 'failed'
       AND DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE
       AND (
         payload->>'failure_type' = 'auth_fail'
         OR payload->>'error_code' = ANY($1::text[])
       )`,
    [WECHAT_TOKEN_ERROR_CODES],
  );
  return rows[0]?.cnt || 0;
}

/**
 * Viability Gate 阻断后推送飞书告警（P2 单次，不累积）。
 * 失败不应反向影响 dispatch 主流程。
 *
 * @param {import('pg').Pool} dbPool
 * @param {object} task
 * @param {{viable:boolean, reason:string, check:string}} viabilityResult
 */
export async function alertOnViabilityBlock(dbPool, task, viabilityResult) {
  try {
    const title = task.title || '(untitled)';
    const msg = `Viability Gate 阻断任务 "${title}" (${task.id}): ${viabilityResult.reason}`;
    await raise('P2', `viability_gate_${viabilityResult.check || 'blocked'}`, msg);
  } catch (err) {
    console.warn('[viability-gate] alertOnViabilityBlock failed (non-fatal):', err?.message || err);
  }
}
