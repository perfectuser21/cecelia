/**
 * rescan-staleness-report.js — rescan 停滞哨兵的读取与渲染（晨报一行 / 日报板块）。
 * 数据由 cron/rescan-staleness-patrol.js 每 5min 写入 working_memory[rescan_staleness]；
 * 形状沿棒 8 skill 分发漂移（lib/skill-dist-report.js）：stale → 🟡 AMBER，
 * 无数据（job 从未跑）→ 不出；读取 best-effort，失败返回 null，不拖垮晨报/日报。
 */
import { RESCAN_STALE_KEY } from '../cron/rescan-staleness-patrol.js';

export { RESCAN_STALE_KEY };
/** 数据超过这个时长没刷新：检测本身停了，也要 AMBER。job 每 5min 跑一次，1h = 错过 12 轮。 */
export const STALE_DETECTION_STOPPED_MS = 60 * 60 * 1000;
const QUERY_TIMEOUT_MS = 10_000;

/** @returns {Promise<object|null>} 最近一次核对结果；缺失/查询失败/超时 → null */
export async function readRescanStalenessState(pool) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('query timeout')), QUERY_TIMEOUT_MS); });
    const res = await Promise.race([
      pool.query('SELECT value_json FROM working_memory WHERE key = $1', [RESCAN_STALE_KEY]),
      timeout,
    ]);
    let v = res?.rows?.[0]?.value_json;
    if (typeof v === 'string') v = JSON.parse(v);
    // 形状校验：别的 key/夹具的 value_json 不是本 job 的结果，宁可当无数据也不出错误的 AMBER
    return v && typeof v.checked_at === 'string' && typeof v.stale === 'boolean' ? v : null;
  } catch (err) {
    console.warn(`[rescan-staleness-report] 读取失败（非阻断）: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function ageHoursSinceCheck(state, now) {
  const t = Date.parse(state?.checked_at);
  return Number.isFinite(t) ? (now - t) / 3600_000 : Infinity;
}

/** 晨报一行；无需告警返回 null。 */
export function renderRescanStalenessLine(state, now = Date.now()) {
  if (!state) return null;
  const detectionAge = ageHoursSinceCheck(state, now);
  if (detectionAge > STALE_DETECTION_STOPPED_MS / 3600_000) {
    return `🟡 AMBER rescan 停滞检测已过期：上次核对在 ${Number.isFinite(detectionAge) ? Math.floor(detectionAge) : '?'} 小时前未更新（检测 job 停了？）`;
  }
  if (!state.stale) return null;
  if (state.missing_kinds?.length) {
    return `🟡 AMBER 地图照相层 rescan 停滞：repo=${state.repo} 缺失快照类型 ${state.missing_kinds.join(',')}`;
  }
  return `🟡 AMBER 地图照相层 rescan 停滞：repo=${state.repo} 最旧快照(${state.oldest_kind}) 已 ${state.age_minutes} 分钟未更新`;
}

/** 日报板块；无数据返回空串。 */
export function renderRescanStalenessSection(state, now = Date.now()) {
  if (!state) return '';
  const lines = ['== 地图照相层 rescan 停滞哨兵 =='];
  const detectionAge = ageHoursSinceCheck(state, now);
  if (detectionAge > STALE_DETECTION_STOPPED_MS / 3600_000) {
    lines.push(`🟡 AMBER 检测已过期：上次核对在 ${Number.isFinite(detectionAge) ? Math.floor(detectionAge) : '?'} 小时前，检测 job 可能停了`);
    return lines.join('\n');
  }
  if (!state.stale) {
    lines.push(`✓ repo=${state.repo} 四类快照均在预算内，上次核对 ${state.checked_at}`);
    return lines.join('\n');
  }
  if (state.missing_kinds?.length) {
    lines.push(`🟡 AMBER repo=${state.repo} 缺失快照类型: ${state.missing_kinds.join(',')}`);
  } else {
    lines.push(`🟡 AMBER repo=${state.repo} 最旧快照(${state.oldest_kind}) 已 ${state.age_minutes} 分钟未更新`);
  }
  return lines.join('\n');
}
