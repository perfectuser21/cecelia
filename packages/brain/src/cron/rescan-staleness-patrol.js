/**
 * rescan-staleness-patrol.js — 地图照相层 rescan 停滞哨兵
 *
 * 病根(2026-09-23 P0 事故 9dfd873a)：MMV crontab 的 rescan-if-changed.sh 连续失败
 * 21.5h，只写 /tmp/registry-scan.log，没人看，直到派发闸连撞 map_stale 触发
 * dispatch_fail_autoblock 才被发现。事实快照(fact_snapshot_headers)停更本身就是
 * "rescan 在失败"最直接的信号——扫描器成功时每轮都会刷新 scanned_at；只要它连续
 * 失败/被挡，四类快照的 scanned_at 就会原地不动、账龄单调增长，完全不需要
 * MMV 侧另开一条失败上报通道。
 *
 * 阈值复用 lib/registry-freshness.js 的 PHOTO_STALE_THRESHOLD_SECONDS(30min)——
 * 与派发闸判定 map_stale 的账龄预算同一口径，防止「这里说没事，派发闸已经在拒」
 * 的两套标准打架（0921 事故的教训，见 registry-freshness.js 注释）。
 *
 * 调度模型：scheduler-jobs.js 60s 轮询 + 本模块自 gate（默认 5min）。
 * P1 经 alerting.js 缓冲，最终按 raise() 既有的每小时汇总节奏推飞书，
 * 不额外造一条推送通道；晨报/日报读 working_memory[RESCAN_STALE_KEY] 出 AMBER
 * （见 lib/rescan-staleness-report.js，形状沿棒 8 skill 分发漂移）。
 */
import { raise } from '../alerting.js';
import { PHOTO_STALE_THRESHOLD_SECONDS } from '../lib/registry-freshness.js';

export const RESCAN_STALE_KEY = 'rescan_staleness';
/** 30min，与派发闸账龄预算同源，见 lib/registry-freshness.js 注释 */
export const RESCAN_STALE_SECONDS = PHOTO_STALE_THRESHOLD_SECONDS;
/** 与 run-all-scans.sh 默认四类扫描器一致 */
export const REQUIRED_KINDS = Object.freeze(['api', 'db_schema', 'graph', 'test']);
const DEFAULT_GATE_MS = 5 * 60 * 1000;
const DEFAULT_REPO = 'cecelia';

let lastCheckAt = 0;

function oldestRow(rows) {
  if (rows.length === 0) return null;
  return rows.reduce((oldest, row) => (
    new Date(row.scanned_at).getTime() < new Date(oldest.scanned_at).getTime() ? row : oldest
  ), rows[0]);
}

/**
 * 周期入口（scheduler-jobs 每 60s 调，自 gate 默认 5min）。
 * @param {import('pg').Pool} pool
 * @param {object} [opts] 供测试注入：now / gateMs / repo / raiseFn
 */
export async function runRescanStalenessPatrol(pool, opts = {}) {
  const {
    now = Date.now,
    gateMs = DEFAULT_GATE_MS,
    repo = DEFAULT_REPO,
    raiseFn = raise,
  } = opts;

  const nowMs = now();
  if (nowMs - lastCheckAt < gateMs) return { skipped: true, reason: 'interval_gate' };
  lastCheckAt = nowMs;

  const { rows } = await pool.query(
    `SELECT kind, scanned_at FROM fact_snapshot_headers WHERE repo = $1`,
    [repo],
  );

  const seenKinds = new Set(rows.map((r) => r.kind));
  const missingKinds = REQUIRED_KINDS.filter((k) => !seenKinds.has(k));
  const oldest = oldestRow(rows);
  const ageSeconds = oldest ? (nowMs - new Date(oldest.scanned_at).getTime()) / 1000 : Infinity;
  const stale = missingKinds.length > 0 || ageSeconds > RESCAN_STALE_SECONDS;
  const ageMinutes = Number.isFinite(ageSeconds) ? Math.round(ageSeconds / 60) : null;

  const state = {
    checked_at: new Date(nowMs).toISOString(),
    repo,
    stale,
    age_minutes: ageMinutes,
    oldest_kind: oldest?.kind ?? null,
    missing_kinds: missingKinds,
  };

  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [RESCAN_STALE_KEY, JSON.stringify(state)],
  );

  if (stale) {
    const thresholdMin = Math.round(RESCAN_STALE_SECONDS / 60);
    const detail = missingKinds.length
      ? `repo=${repo} 缺失快照类型: ${missingKinds.join(',')}（扫描链从未成功跑过或部分类型从未落库）`
      : `repo=${repo} 最旧快照(${state.oldest_kind}) 已 ${ageMinutes} 分钟未更新`;
    await raiseFn(
      'P1',
      'rescan_stale',
      `地图照相层 rescan 停滞超 ${thresholdMin} 分钟: ${detail}`,
    ).catch((e) => console.warn('[rescan-staleness-patrol] raise failed:', e.message));
  }

  return { checked: true, stale, age_minutes: ageMinutes, missing_kinds: missingKinds };
}

/** 测试专用：重置模块级 gate（生产不调） */
export function __resetRescanStalenessGateForTest() {
  lastCheckAt = 0;
}
