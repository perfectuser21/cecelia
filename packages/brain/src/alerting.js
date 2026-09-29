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
import { shouldFire } from './lib/alert-debounce.js';

const VALID_LEVELS = ['P0', 'P1', 'P2', 'P3'];

// P0 rate limiting：同一 eventType 5 分钟内只推一次
const _p0RateLimit = new Map();
const P0_RATE_LIMIT_MS = 5 * 60 * 1000;

// P1/P2 缓冲区（内存为主，镜像到 working_memory，重启后恢复）
const _p1Buffer = [];
const _p2Buffer = [];

// 刷新时间追踪（随缓冲一起持久化，重启后恢复，保证 P2 每日节奏不被部署打断）
let _lastP1FlushAt = 0;
let _lastP2FlushAt = 0;

const P1_FLUSH_INTERVAL_MS = 60 * 60 * 1000;       // 1 小时
const P2_FLUSH_INTERVAL_MS = 24 * 60 * 60 * 1000;  // 24 小时

// ── 持久化（working_memory key=alerting_buffers）──────────────────────────
// 背景：Brain 一天多次部署重启，纯内存缓冲会让 P2 每日汇总永远发不出去。
// 语义：至少一次——flush 发送后才写回清空态；持久化失败只 console.warn，不影响 raise。
// 顺序：所有读写串行在 _persistChain 上；未成功恢复前绝不写库（防空态覆盖库里未发项）。
const PERSIST_KEY = 'alerting_buffers';
const PERSIST_MAX_ITEMS = 500; // 每级最多落库最近 500 条（汇总只展示条数+最近 5 条，防单 key 无限膨胀）
let _restored = false;
let _persistChain = Promise.resolve();

async function _getPool() {
  // 动态 import：避免 alerting ↔ db 在模块加载期形成依赖（dedupe/notifier 等都 import alerting）
  const mod = await import('./db.js');
  return mod.default;
}

function _validItems(arr) {
  return Array.isArray(arr)
    ? arr.filter(e => e && typeof e.message === 'string')
    : [];
}

async function _restoreFromDb(pool) {
  const res = await pool.query('SELECT value_json FROM working_memory WHERE key = $1', [PERSIST_KEY]);
  const saved = res?.rows?.[0]?.value_json;
  if (saved && typeof saved === 'object') {
    // 库里的是重启前的旧项，排在重启后新 raise 的项之前
    _p1Buffer.unshift(..._validItems(saved.p1));
    _p2Buffer.unshift(..._validItems(saved.p2));
    _lastP1FlushAt = Math.max(_lastP1FlushAt, Number(saved.last_p1_flush_at) || 0);
    _lastP2FlushAt = Math.max(_lastP2FlushAt, Number(saved.last_p2_flush_at) || 0);
  }
  _restored = true;
}

async function _writeToDb(pool) {
  const state = {
    p1: _p1Buffer.slice(-PERSIST_MAX_ITEMS),
    p2: _p2Buffer.slice(-PERSIST_MAX_ITEMS),
    last_p1_flush_at: _lastP1FlushAt,
    last_p2_flush_at: _lastP2FlushAt,
  };
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [PERSIST_KEY, JSON.stringify(state)]
  );
}

/**
 * 串行执行一次持久化步骤：未恢复则先恢复；write=true 时再写回当前快照。
 * 永不抛错——失败降级为仅内存。
 */
function _persist({ write }) {
  const step = _persistChain.then(async () => {
    try {
      const pool = await _getPool();
      if (!_restored) await _restoreFromDb(pool);
      if (write) await _writeToDb(pool);
    } catch (e) {
      console.warn(`[alerting] 缓冲持久化失败（降级为仅内存）: ${e.message}`);
    }
  });
  _persistChain = step;
  return step;
}

/**
 * 触发一条报警
 * @param {'P0'|'P1'|'P2'|'P3'} level
 * @param {string} eventType  - 事件类型标识（用于 P0 限流 key）
 * @param {string} message    - 人可读的报警信息
 * @param {Object} [opts]     - { debounce?: { n, cooldownMs } } 连续 N 次才响 + 冷却期（opt-in）
 *                              ⚠️ P0 宕机/熔断类事件禁止套 debounce——P0 的价值是首击即响；
 *                              debounce 只给抖动型事件（每周期重复触发的状态检测）。
 */
async function raise(level, eventType, message, opts = {}) {
  if (!VALID_LEVELS.includes(level)) {
    console.warn(`[alerting] 未知级别 ${level}，忽略`);
    return;
  }

  if (opts.debounce) {
    if (!shouldFire(eventType, opts.debounce)) {
      console.log(`[alerting] ${level} ${eventType} debounce 未达阈值/冷却中，跳过`);
      return;
    }
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
    await _persist({ write: true });
  } else if (level === 'P2') {
    _p2Buffer.push({ eventType, message, ts: Date.now() });
    await _persist({ write: true });
  }
  // P3：只有上面的 console.log，不推送
}

/**
 * 发送一个缓冲区的汇总（发送后才把清空态写回库，崩在中途则重启后重发）
 */
async function _flushBuffer(level, buffer, header, label) {
  await _persist({ write: false }); // 先确保已恢复重启前的未发项
  if (buffer.length === 0) return;
  const items = buffer.splice(0);
  const preview = items.slice(-5).map(e => `• ${e.message}`).join('\n');
  await sendFeishu(`${header} ${items.length} ${label}\n${preview}`).catch(e =>
    console.error(`[alerting] ${level} 刷新推送失败:`, e.message)
  );
  await _persist({ write: true });
}

/**
 * 立即发送 P1 缓冲区（每小时由 flushAlertsIfNeeded 调用）
 */
async function flushP1() {
  await _flushBuffer('P1', _p1Buffer, '⚠️ [P1 每小时汇总]', '条警告');
}

/**
 * 立即发送 P2 缓冲区（每日由 flushAlertsIfNeeded 调用）
 */
async function flushP2() {
  await _flushBuffer('P2', _p2Buffer, '📋 [P2 每日记录]', '条');
}

/**
 * 时间门控刷新（scheduler-jobs 的 alerting-flush 每 60s 调用，自动判断是否到时间）
 * P1 每小时一次，P2 每日一次；上次刷新时间随缓冲持久化，跨重启保持节奏
 */
async function flushAlertsIfNeeded() {
  await _persist({ write: false });
  const now = Date.now();
  const p1Due = now - _lastP1FlushAt >= P1_FLUSH_INTERVAL_MS;
  const p2Due = now - _lastP2FlushAt >= P2_FLUSH_INTERVAL_MS;
  if (p1Due) {
    _lastP1FlushAt = now;
    await flushP1();
  }
  if (p2Due) {
    _lastP2FlushAt = now;
    await flushP2();
  }
  // 缓冲为空时 flush 不写库，这里补写刷新时间，保证节奏跨重启
  if (p1Due || p2Due) await _persist({ write: true });
  return { p1: p1Due, p2: p2Due };
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
