/**
 * Alerting - 分级报警系统
 *
 * 四级：
 *   P0 - 立即发飞书（系统宕机、熔断、连续失败）
 *   P1 - 每小时汇总（核心功能降级、任务隔离）
 *   P2 - 每日汇总（单次任务失败、非关键报错）
 *   P3 - 只写日志，不推送
 *
 * 使用方式：
 *   import { raise } from './alerting.js';
 *   raise('P0', 'circuit_open_cecelia-run', '熔断触发：连续失败 3 次');
 *   raise('P2', 'task_failed', '任务失败：Build feature (abc-123)');
 */

import { sendFeishu } from './notifier.js';

const VALID_LEVELS = ['P0', 'P1', 'P2', 'P3'];

// P0 rate limiting：同一 eventType 5 分钟内只推一次
const _p0RateLimit = new Map();
const P0_RATE_LIMIT_MS = 5 * 60 * 1000;

// P1/P2 缓冲区
const _p1Buffer = [];
const _p2Buffer = [];

// 刷新时间追踪（in-memory，Brain 重启后清零）
let _lastP1FlushAt = 0;
let _lastP2FlushAt = 0;

const P1_FLUSH_INTERVAL_MS = 60 * 60 * 1000;       // 1 小时
const P2_FLUSH_INTERVAL_MS = 24 * 60 * 60 * 1000;  // 24 小时

/**
 * 触发一条报警
 * @param {'P0'|'P1'|'P2'|'P3'} level
 * @param {string} eventType  - 事件类型标识（用于 P0 限流 key）
 * @param {string} message    - 人可读的报警信息
 */
async function raise(level, eventType, message) {
  if (!VALID_LEVELS.includes(level)) {
    console.warn(`[alerting] 未知级别 ${level}，忽略`);
    return;
  }

  console.log(`[alerting] ${level} ${eventType}: ${message}`);

  if (level === 'P0') {
    const now = Date.now();
    const last = _p0RateLimit.get(eventType) || 0;
    if (now - last >= P0_RATE_LIMIT_MS) {
      _p0RateLimit.set(eventType, now);
      sendFeishu(`🚨 [P0] ${message}`).catch(e =>
        console.error('[alerting] P0 推送失败:', e.message)
      );
    } else {
      console.log(`[alerting] P0 ${eventType} 限流中，跳过推送`);
    }
  } else if (level === 'P1') {
    _p1Buffer.push({ eventType, message, ts: Date.now() });
  } else if (level === 'P2') {
    _p2Buffer.push({ eventType, message, ts: Date.now() });
  }
  // P3：只有上面的 console.log，不推送
}

/**
 * 立即发送 P1 缓冲区（每小时由 flushAlertsIfNeeded 调用）
 */
async function flushP1() {
  if (_p1Buffer.length === 0) return;
  const items = _p1Buffer.splice(0);
  const preview = items.slice(-5).map(e => `• ${e.message}`).join('\n');
  const text = `⚠️ [P1 每小时汇总] ${items.length} 条警告\n${preview}`;
  await sendFeishu(text).catch(e =>
    console.error('[alerting] P1 刷新推送失败:', e.message)
  );
}

/**
 * 立即发送 P2 缓冲区（每日由 flushAlertsIfNeeded 调用）
 */
async function flushP2() {
  if (_p2Buffer.length === 0) return;
  const items = _p2Buffer.splice(0);
  const preview = items.slice(-5).map(e => `• ${e.message}`).join('\n');
  const text = `📋 [P2 每日记录] ${items.length} 条\n${preview}`;
  await sendFeishu(text).catch(e =>
    console.error('[alerting] P2 刷新推送失败:', e.message)
  );
}

/**
 * 时间门控刷新（在 tick 中调用，自动判断是否到时间）
 * P1 每小时一次，P2 每日一次
 */
async function flushAlertsIfNeeded() {
  const now = Date.now();
  if (now - _lastP1FlushAt >= P1_FLUSH_INTERVAL_MS) {
    _lastP1FlushAt = now;
    await flushP1();
  }
  if (now - _lastP2FlushAt >= P2_FLUSH_INTERVAL_MS) {
    _lastP2FlushAt = now;
    await flushP2();
  }
}

/**
 * 获取当前缓冲区状态（供 API 查询）
 */
function getStatus() {
  const p0Entries = {};
  for (const [key, ts] of _p0RateLimit.entries()) {
    p0Entries[key] = new Date(ts).toISOString();
  }
  return {
    p1_pending: _p1Buffer.length,
    p2_pending: _p2Buffer.length,
    p0_rate_limited: p0Entries,
    last_p1_flush: _lastP1FlushAt ? new Date(_lastP1FlushAt).toISOString() : null,
    last_p2_flush: _lastP2FlushAt ? new Date(_lastP2FlushAt).toISOString() : null,
  };
}

export { raise, flushP1, flushP2, flushAlertsIfNeeded, getStatus };
