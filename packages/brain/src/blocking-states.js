/**
 * blocking-states.js — 阻断类状态位 TTL 自愈 + 可见性
 *
 * 事故实证（2026-08-10）：会阻断派发的状态位没有 TTL、没有自愈、没有告警，系统可以
 * 长时间「健康地」停摆而无人察觉——tick_draining 卡 2h20m（5 条 P0 零派发、健康检查
 * 报 healthy），machine_vitals_stale_alert 卡 2 天。共性：进程活着、健康检查绿、日志无
 * 异常，系统安静停在错误状态里，比崩溃难发现。
 *
 * 本模块提供三件事（machine_vitals_stale_alert 的采样自愈在 machine-vitals.js 内）：
 *   1) reconcileBlockingStates() — TTL 自愈：排空超 TTL 无人续期则自动解除 + 留痕 + 告警
 *   2) getBlockingStates()       — 列出当前生效的阻断位及持续时长（供健康端点可判读）
 *   3) maybeLogDrainSummary()    — 可观测兜底：排空生效期每 N 轮打印一条汇总日志
 *
 * 边界：只做「阻断类状态位的 TTL 自愈 + 可见性」，不改 drain 触发条件、不改 alertness
 * 分级算法、不改 harness slot 判定。自动解除必须留痕并告警——禁止静默自愈（静默自愈会
 * 把「为什么卡过」这个信息也一起吃掉）。
 */

import pool from './db.js';
import { isDraining, getDrainStartedAt, cancelDrain } from './drain.js';
import { emit } from './event-bus.js';
import { raise } from './alerting.js';

// TTL 默认 30 分钟（PRD），DRAIN_TTL_MS 环境变量可覆盖。drain 的合法生命周期只有几分钟，
// 30 分钟远超正常上限，超过必是「无人取消的残留」。
export const DEFAULT_DRAIN_TTL_MS = 30 * 60 * 1000;

// 排空汇总日志的轮次间隔（PRD「每 N 轮」），DRAIN_SUMMARY_EVERY_N 可覆盖，默认 5。
const DEFAULT_DRAIN_SUMMARY_EVERY_N = 5;

// machine-vitals 采样持续失败的哨兵键（与 machine-vitals.js SENTINEL_KEY 对齐）。
const VITALS_SENTINEL_KEY = 'machine_vitals_stale_alert';

// 排空生效期间累计跑过的轮数（供 maybeLogDrainSummary 的「每 N 轮」判断）。
let _drainRounds = 0;

/** 读 TTL：非法值（NaN / <=0）回退默认，避免误配把自愈关死。 */
export function getDrainTtlMs() {
  const raw = parseInt(process.env.DRAIN_TTL_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DRAIN_TTL_MS;
}

/** 读汇总轮次：非法值回退默认。 */
export function getDrainSummaryEveryN() {
  const raw = parseInt(process.env.DRAIN_SUMMARY_EVERY_N || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DRAIN_SUMMARY_EVERY_N;
}

/** ISO 字符串距 now 的毫秒数；不可解析返回 null（无法证明超时则保守不动）。 */
function ageMs(sinceIso, now = Date.now()) {
  const t = Date.parse(sinceIso ?? '');
  return Number.isNaN(t) ? null : now - t;
}

/** 毫秒 → 人可读时长（如 "2h20m" / "5m" / "45s"），用于告警/日志的「曾卡多久」。 */
function humanizeMs(ms) {
  if (ms == null || ms < 0) return 'unknown';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${sec > 0 ? sec + 's' : ''}`;
  return `${sec}s`;
}

/**
 * 列出当前生效的阻断类状态位及持续时长（供 /api/brain/alertness 等健康端点可判读）。
 * 覆盖：tick_draining（内存态）+ machine_vitals_stale_alert（working_memory 哨兵）。
 *
 * @param {import('pg').Pool} [dbPool]
 * @returns {Promise<Array<{key,since,duration_ms,duration_human,detail}>>}
 */
export async function getBlockingStates(dbPool = pool) {
  const now = Date.now();
  const states = [];

  // ① 排空模式（内存态，dispatcher 每轮 return draining 的源头）
  if (isDraining()) {
    const since = getDrainStartedAt();
    const dur = ageMs(since, now);
    states.push({
      key: 'tick_draining',
      since,
      duration_ms: dur,
      duration_human: dur == null ? 'unknown' : humanizeMs(dur),
      detail: 'dispatch paused (draining)',
    });
  }

  // ② machine-vitals 采样持续失败哨兵（DB 持久化，跨重启存活）
  try {
    const r = await dbPool.query(
      `SELECT value_json FROM working_memory WHERE key = $1`,
      [VITALS_SENTINEL_KEY],
    );
    const row = r.rows?.[0]?.value_json;
    const v = typeof row === 'string' ? JSON.parse(row) : row;
    if (v && (v.since || v.last_error)) {
      const dur = ageMs(v.since, now);
      states.push({
        key: VITALS_SENTINEL_KEY,
        since: v.since ?? null,
        duration_ms: dur,
        duration_human: dur == null ? 'unknown' : humanizeMs(dur),
        detail: v.last_error ?? 'machine vitals sampling stale',
      });
    }
  } catch (err) {
    // 可观测降级：DB 读失败不影响已知的内存态阻断位上报
    console.warn(`[blocking-states] sentinel read failed (non-fatal): ${err.message}`);
  }

  return states;
}

/**
 * TTL 自愈：排空置位超过 TTL 且无人续期 → 自动退出排空 + 记 auto_recovered 事件 + 发告警。
 * 由 dispatcher.dispatchNextTask() 每轮开头调用（drain 闸之前），因此同一轮解除后 queued
 * 任务即可被派发。禁止静默——解除必留痕（cecelia_events）并告警（说明曾卡多久、已解除）。
 *
 * @param {import('pg').Pool} [_dbPool] 保留形参以对齐调用方（drain/告警走各自的 pool，本函数不直接查库）
 * @returns {Promise<{auto_recovered: Array}>}
 */
export async function reconcileBlockingStates(_dbPool = pool) {
  const now = Date.now();
  const autoRecovered = [];

  if (isDraining()) {
    const since = getDrainStartedAt();
    const age = ageMs(since, now);
    const ttl = getDrainTtlMs();
    // age 不可解析（null）时保守不动——无法证明超时，不误清合法排空
    if (age != null && age > ttl) {
      await cancelDrain();
      const record = {
        key: 'tick_draining',
        since,
        stuck_ms: age,
        stuck_human: humanizeMs(age),
        ttl_ms: ttl,
        recovered_at: new Date(now).toISOString(),
      };
      autoRecovered.push(record);

      console.log(
        `[blocking-states] tick_draining 卡 ${record.stuck_human} 超 TTL ${humanizeMs(ttl)}，已自动解除并留痕告警`,
      );
      // 留痕：cecelia_events（emit 内部已 try/catch，不抛）
      await emit('auto_recovered', 'blocking-state-ttl', record);
      // 告警：说明曾卡多久、已自动解除（禁静默）
      await raise(
        'P1',
        'blocking_state_auto_recovered',
        `阻断位 tick_draining 曾卡住 ${record.stuck_human}（超 TTL ${humanizeMs(ttl)}），已自动解除，派发恢复`,
      );
    }
  }

  // 排空已结束（本轮解除或此前已被取消）→ 轮次计数归零，下次排空重新计数
  if (!isDraining()) _drainRounds = 0;

  return { auto_recovered: autoRecovered };
}

/**
 * 可观测兜底：排空生效期间每 N 轮打印一条汇总日志（已排空多久 + 挡住多少候选），
 * 消除「排空期间日志里什么都没有」的排障黑洞（事故①：连 slot_check 日志都不出现）。
 * 仅在 draining 时由 dispatcher 调用。
 *
 * @param {import('pg').Pool} [dbPool]
 * @returns {Promise<boolean>} 是否打印了汇总
 */
export async function maybeLogDrainSummary(dbPool = pool) {
  _drainRounds += 1;
  const everyN = getDrainSummaryEveryN();
  if (_drainRounds % everyN !== 0) return false;

  // 被挡候选数 = 当前 queued 任务数（查询失败降级为未知，不阻断）
  let blocked = null;
  try {
    const r = await dbPool.query(`SELECT count(*)::int AS n FROM tasks WHERE status = 'queued'`);
    blocked = r.rows?.[0]?.n ?? null;
  } catch (err) {
    console.warn(`[dispatch] drain summary queued count failed (non-fatal): ${err.message}`);
  }

  const age = ageMs(getDrainStartedAt(), Date.now());
  console.log(
    `[dispatch] drain summary: 已排空 ${age == null ? 'unknown' : humanizeMs(age)}，` +
      `本轮阻断 ${blocked == null ? '?' : blocked} 个候选（第 ${_drainRounds} 轮）`,
  );
  return true;
}

/**
 * 健康摘要：存在活跃阻断位时 healthy=false（不得报 healthy/CALM）。
 * 纯函数，供 /api/brain/alertness 组装返回体。
 *
 * @param {Array} blockingStates getBlockingStates() 的结果
 * @returns {{healthy:boolean, blocked:boolean, blocking_summary:(string|null)}}
 */
export function summarizeHealth(blockingStates) {
  const blocked = Array.isArray(blockingStates) && blockingStates.length > 0;
  if (!blocked) return { healthy: true, blocked: false, blocking_summary: null };
  const summary = blockingStates
    .map((b) => `${b.key}(${b.duration_human ?? (b.duration_ms != null ? b.duration_ms + 'ms' : 'unknown')})`)
    .join(', ');
  return { healthy: false, blocked: true, blocking_summary: summary };
}

/**
 * 组装 /api/brain/alertness 返回体中与「阻断可见性」相关的字段（供路由 spread）。
 * 存在活跃阻断位时：healthy=false，且把上报等级抬到至少 AWARE、覆盖 CALM 上报，
 * reason 换成阻断摘要——把「静默停摆」暴露给健康检查（禁止再报 healthy/CALM）。
 *
 * 等级常量由调用方注入（避免本模块反向依赖 alertness/index.js，便于单测）。
 *
 * @param {{level:number, levelName:string, reason:string}} alertness getCurrentAlertness()
 * @param {Array} blockingStates getBlockingStates() 结果
 * @param {{ALERTNESS_LEVELS:object, LEVEL_NAMES:string[]}} levels 等级常量注入
 */
export function buildAlertnessView(alertness, blockingStates, levels) {
  const { ALERTNESS_LEVELS, LEVEL_NAMES } = levels;
  const health = summarizeHealth(blockingStates);
  if (!health.blocked) {
    return { healthy: true, blocking_states: blockingStates };
  }
  const effLevel = Math.max(alertness?.level ?? 0, ALERTNESS_LEVELS.AWARE);
  return {
    healthy: false,
    level: effLevel,
    levelName: LEVEL_NAMES[effLevel],
    reason: `阻断状态位生效：${health.blocking_summary}`,
    blocking_states: blockingStates,
  };
}

/** 测试 hook：复位轮次计数。 */
export function _resetBlockingStatesForTest() {
  _drainRounds = 0;
}
