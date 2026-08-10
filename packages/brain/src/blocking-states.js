/**
 * blocking-states.js — 阻断类状态位的 TTL 自愈 + 可见性（终结「健康地停摆」）
 *
 * 法源：PRD sprints/08111700-blocking-state-ttl-selfheal。事故实证（2026-08-10）：
 *   ① tick_draining 卡 2h20m —— 排空模式被置位后无人取消，dispatcher 每轮直接
 *      return draining，5 条 P0 harness 任务全程 queued 零派发；同期 /api/brain/alertness
 *      仍报 CALM / "System is healthy"，健康检查完全看不见。
 *   ② machine_vitals_stale_alert 卡 2 天 —— 见 machine-vitals.js（采样恢复即自愈）。
 *
 * 本模块单一职责：把「会阻断派发的状态位」集中成可判读清单 + 给 tick_draining 加 TTL 自愈。
 *   - getBlockingStates(pool)      —— 列出当前所有生效阻断位（供健康端点判读）
 *   - selfHealBlockingStates(pool) —— 每跳跑一次：超 TTL 的 drain 自动解除并留痕告警
 *
 * 边界（PRD）：不改 drain 触发条件、不改 alertness 分级算法、不改 harness slot 判定。
 * 自动解除必须留痕 + 告警——禁止静默自愈（静默会把「为什么卡过」的信息一起吃掉）。
 */
import { emit } from './event-bus.js';
import { raise } from './alerting.js';
import { isDraining, getDrainStartedAt, cancelDrain } from './drain.js';

const DRAIN_KEY = 'tick_draining';
const VITALS_SENTINEL_KEY = 'machine_vitals_stale_alert';
const DEFAULT_DRAINING_TTL_MS = 30 * 60 * 1000; // 默认 30 分钟

// 置位超过此阈值且无人显式续期 → 判为卡死，自动退出该状态。环境变量可覆盖；
// 非法值（NaN / <=0）回退默认，避免误设 0 导致刚置位就被清。
export const DRAINING_TTL_MS = (() => {
  const raw = parseInt(process.env.TICK_DRAINING_TTL_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DRAINING_TTL_MS;
})();

async function readWm(pool, key) {
  const { rows } = await pool.query(
    `SELECT value_json FROM working_memory WHERE key = $1`,
    [key],
  );
  const v = rows[0]?.value_json;
  if (v == null) return null;
  return typeof v === 'string' ? JSON.parse(v) : v;
}

function ageMs(iso) {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t) ? null : Date.now() - t;
}

/**
 * 列出当前所有生效的阻断类状态位（供健康检查判读）。
 * 内存态与 working_memory 任一为真即算活跃（drain 内存态是 dispatcher 实际读的闸；
 * working_memory 是重启后的持久来源，事故里正是它残留）。
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{key,label,since,duration_ms,detail}>>}
 */
export async function getBlockingStates(pool) {
  const states = [];

  // ① tick_draining（排空模式）
  let wmDrain = null;
  try { wmDrain = await readWm(pool, DRAIN_KEY); } catch { /* 读失败按无阻断处理，不让健康端点 500 */ }
  if (isDraining() || wmDrain?.draining === true) {
    const since = wmDrain?.drain_started_at || getDrainStartedAt() || null;
    states.push({
      key: DRAIN_KEY,
      label: '派发排空模式（drain）',
      since,
      duration_ms: since ? ageMs(since) : null,
      detail: '派发被排空模式阻断——in_progress 任务放行，新任务不派发',
    });
  }

  // ② machine_vitals_stale_alert（体征采样陈旧告警）
  let wmVitals = null;
  try { wmVitals = await readWm(pool, VITALS_SENTINEL_KEY); } catch { /* 同上 */ }
  if (wmVitals && !wmVitals.recovered_at) {
    const since = wmVitals.since || null;
    states.push({
      key: VITALS_SENTINEL_KEY,
      label: 'machine-vitals 采样陈旧告警',
      since,
      duration_ms: since ? ageMs(since) : null,
      detail: wmVitals.last_error || 'machine-vitals 采样持续失败',
    });
  }

  return states;
}

/**
 * 每跳跑一次：给阻断类状态位做 TTL 自愈。当前覆盖 tick_draining——
 * 置位超过 TTL 且无人显式续期时自动退出该状态，并记录 auto_recovered 事件 + 发告警。
 * @param {import('pg').Pool} pool
 * @param {{ttlMs?:number}} [opts]
 * @returns {Promise<{recovered:Array<{key,stuck_ms,stuck_minutes}>, checked_at:string}>}
 */
export async function selfHealBlockingStates(pool, opts = {}) {
  const ttlMs = Number.isFinite(opts.ttlMs) && opts.ttlMs > 0 ? opts.ttlMs : DRAINING_TTL_MS;
  const recovered = [];

  let wmDrain = null;
  try { wmDrain = await readWm(pool, DRAIN_KEY); } catch { /* 读失败本轮跳过自愈 */ }
  const drainingActive = isDraining() || wmDrain?.draining === true;

  if (drainingActive) {
    // 以持久化的 drain_started_at 为准（重启后内存态可能刚恢复、时间被刷新）
    const since = wmDrain?.drain_started_at || getDrainStartedAt() || null;
    const stuckMs = since ? ageMs(since) : null;

    if (stuckMs != null && stuckMs > ttlMs) {
      const stuckMin = Math.round(stuckMs / 60000);
      const ttlMin = Math.round(ttlMs / 60000);

      // 解除内存态闸（dispatcher 读 isDraining）+ 清持久化行
      try { await cancelDrain(); } catch (e) { console.error('[blocking-states] cancelDrain 失败:', e.message); }
      // 兜底：cancelDrain 在 _draining=false 时会早退不删库，这里强制清残留行
      try { await pool.query(`DELETE FROM working_memory WHERE key = $1`, [DRAIN_KEY]); } catch (e) { console.error('[blocking-states] 清 working_memory 失败:', e.message); }

      // 留痕（禁止静默自愈）：auto_recovered 事件 + 告警
      try {
        await emit('blocking_state_auto_recovered', 'blocking-states', {
          key: DRAIN_KEY,
          stuck_ms: stuckMs,
          stuck_minutes: stuckMin,
          drain_started_at: since,
          ttl_ms: ttlMs,
        });
      } catch (e) { console.error('[blocking-states] emit auto_recovered 失败:', e.message); }
      try {
        await raise(
          'P1',
          'blocking_state_auto_recovered_tick_draining',
          `排空模式(tick_draining)曾卡住约 ${stuckMin} 分钟(超过 TTL ${ttlMin}min)，已自动解除，派发恢复`,
        );
      } catch (e) { console.error('[blocking-states] raise 告警失败:', e.message); }

      console.log(`[blocking-states] tick_draining 卡住 ${stuckMin}min > TTL ${ttlMin}min，已自动解除并留痕`);
      recovered.push({ key: DRAIN_KEY, stuck_ms: stuckMs, stuck_minutes: stuckMin });
    }
  }

  return { recovered, checked_at: new Date().toISOString() };
}
