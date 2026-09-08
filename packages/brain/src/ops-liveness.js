// 流程活性判定：每条流程按自己的历史节奏算基线，而不是一刀切阈值。
// 起因：2026-09-08 查出业务流程已停跑 20.4 小时无人察觉——四表看板只显示"跑过多少次"，
// 不显示"还会不会跑"。而各流程节奏差百倍（通道类 4 秒/次 vs 编码流水线 2.4 小时/次），
// 统一阈值必然两头不讨好：高频流程死透了还显示正常，低频流程天天误报。
// 决策：失联判定按各流程近 30 天中位间隔自动算（黄 5 倍 / 红 20 倍）。

/** 冷启动门槛：运行次数不足此值时基线不可信，一律不告警 */
export const COLD_START_RUNS = 10;
/** 黄线倍数 */
export const WARN_MULTIPLIER = 5;
/** 红线倍数 */
export const DEAD_MULTIPLIER = 20;
/** 黄线绝对下限：高频流程的正常空档不该立刻变黄 */
export const WARN_FLOOR_SEC = 5 * 60;
/** 红线绝对下限：同上，通道类空 80 秒不代表死了 */
export const DEAD_FLOOR_SEC = 15 * 60;
/** 红线绝对上限：再低频的流程，一个月不动也该报 */
export const DEAD_CEIL_SEC = 30 * 86400;

const toMs = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));

/**
 * 从运行开始时间列表算「正常节奏」= 相邻运行的中位间隔（秒）。
 * 用中位不用平均：一次长空档（比如停机维护）会把平均带偏一倍以上，中位不受影响。
 * @returns {number|null} 秒；样本不足或全是同一时刻时返回 null
 */
export function computeIntervalBaseline(startedAtList) {
  if (!Array.isArray(startedAtList) || startedAtList.length < 2) return null;
  const ts = startedAtList
    .map(toMs)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < ts.length; i += 1) {
    const gap = (ts[i] - ts[i - 1]) / 1000;
    // 同秒并发触发会产生 0 间隔；留着会把中位拉到 0，任何静默都判红
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
  return Math.round(median);
}

/**
 * 判定一条流程是活着、慢了、还是死了。
 * @returns {{liveness:'ok'|'warn'|'dead'|'cold', silent_sec:number|null,
 *            warn_after_sec:number|null, dead_after_sec:number|null}}
 *   透出阈值本身，让看板能显示「停了 6 小时，超过 5.8 小时判黄」而不是只给个颜色。
 */
export function classifyLiveness({ lastRunAt, baselineSec, runCount, now } = {}) {
  const nowMs = Number.isFinite(now) ? now : toMs(now) || Date.now();
  const lastMs = lastRunAt == null ? null : toMs(lastRunAt);
  const silentSec = Number.isFinite(lastMs) ? Math.round((nowMs - lastMs) / 1000) : null;

  const noBaseline = !Number.isFinite(baselineSec) || baselineSec <= 0;
  const tooFew = !Number.isFinite(runCount) || runCount < COLD_START_RUNS;
  if (noBaseline || tooFew || silentSec === null) {
    return { liveness: 'cold', silent_sec: silentSec, warn_after_sec: null, dead_after_sec: null };
  }

  const warnAfter = Math.max(baselineSec * WARN_MULTIPLIER, WARN_FLOOR_SEC);
  const deadAfter = Math.min(Math.max(baselineSec * DEAD_MULTIPLIER, DEAD_FLOOR_SEC), DEAD_CEIL_SEC);

  let liveness = 'ok';
  if (silentSec >= deadAfter) liveness = 'dead';
  else if (silentSec >= warnAfter) liveness = 'warn';

  return {
    liveness,
    silent_sec: silentSec,
    warn_after_sec: Math.round(warnAfter),
    dead_after_sec: Math.round(deadAfter),
  };
}

/**
 * 采集器接线用：给一条流程的 run 列表，直接得出可落盘的活性字段。
 * 把「算基线 → 找最后一次 → 判定」三步收在一起，避免调用方各写一遍。
 * @param {Array<{started_at:*}>} runs 该流程的运行记录（顺序不限）
 * @param {number} now 当前时间戳
 */
export function summarizeLiveness(runs = [], now = Date.now()) {
  const list = (Array.isArray(runs) ? runs : []).filter((r) => r?.started_at);
  const started = list.map((r) => r.started_at);
  const baseline = computeIntervalBaseline(started);
  const lastRunAt = started.length
    ? started.reduce((a, b) => (toMs(a) >= toMs(b) ? a : b))
    : null;
  return {
    baseline_interval_sec: baseline,
    ...classifyLiveness({ lastRunAt, baselineSec: baseline, runCount: list.length, now }),
  };
}
