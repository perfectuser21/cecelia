/**
 * coding-evidence.js — 编码线格子成败 → 判官口粮（判官口粮第二铲）
 *
 * 病灶（2026-09-07 实测）：crystal_verdict 里 og1..og8 全是 keep_llm{"rule":"data_gap"}，
 * 判官在空账上判案。根因不是判官坏了——是编码线九格的执行证据从来没人搬：
 *   - `harness_attempts`：3400+ 条 phase×status（planning/gan/generate/evaluate/judge/publish），
 *     每条就是一次「某格跑了一趟，成了还是没成」，带起止时刻可算耗时。
 *   - `sequencer_ledger`：回家序列器（home-sequencer）的监工裁定台账，新一代格序的成败源。
 *     今天是空表，接上后自动生效——不必等它有数才接线。
 * 本模块把两代格序归一成同一判决单位，聚合成 crystal_run_evidence 行（判官唯一口粮）。
 *
 * 三条纪律：
 *   ① 只补账不代判：本模块只写 crystal_run_evidence，判决仍由 crystal-judge 出。
 *   ② 缺的维度留空不臆造：编码线没有 token 源（task_run_metrics 08-23 断流，
 *      kernel attempt 不记 token）→ baseline_tokens 留 null。判官因此记成本缺口
 *      （cost_gap）判 keep_llm，与「没有成本证据就不许固化」的 INV 语义一致。
 *   ③ 幂等：行键 (unit_key, verified_at)，verified_at 由 (格, 北京日) 唯一确定，
 *      重跑只刷新数值不长行。
 */

import pool from '../db.js';
import { CODING_GRIDS, codingUnitKey, gridForKernelPhase, gridHasPostcondition } from './coding-grids.js';

/** 默认回填/同步窗口（天）。 */
export const CODING_EVIDENCE_DEFAULT_DAYS = 30;

/** scheduler 自 gate 间隔：源表是本地库，10 分钟足够新鲜，不必每轮 60s 全扫。 */
const SYNC_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 计入账本的终态。
 * `cancelled` 不入账：取消是人/父 run 的动作，不是这一格的表现，算进失败会冤枉格子。
 * 在途状态（queued/starting/running）同理不入账——还没有成败可言。
 */
export const CODING_TERMINAL_STATUSES = Object.freeze([
  'completed', 'completed_with_concerns', 'needs_context', 'blocked', 'failed',
]);

/**
 * 只有干净完成才算通过。`completed_with_concerns` 计入次数但不计通过——
 * 蒸馏要的是「这一格闭眼睛也能跑对」的确定性，带关切的完成够不上；宁可晋升慢，不可误固化。
 */
function isPass(status) {
  return status === 'completed';
}

function toFiniteNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 该北京日的证据时刻锚：北京 00:00。幂等键的另一半，必须是 (格, 日) 的确定函数——
 * 取 NOW() 会让每次同步都新长一行，账本瞬间被自己灌爆。
 * @param {string} reportDate YYYY-MM-DD（北京日）
 * @returns {string} ISO 时刻
 */
export function verifiedAtForDate(reportDate) {
  return new Date(`${reportDate}T00:00:00+08:00`).toISOString();
}

/** kernel attempt 行 → 归一记录（认不出的相丢弃，不硬塞某一格）。 */
export function normalizeKernelAttempt(row = {}) {
  const grid = gridForKernelPhase(row.phase);
  if (!grid) return null;
  return {
    report_date: row.report_date,
    grid,
    status: row.status,
    duration_ms: toFiniteNumber(row.duration_ms),
  };
}

/** sequencer_ledger 行 → 归一记录。监工裁定词映射到同一套成败语义。 */
export function normalizeSequencerRecord(row = {}) {
  const grid = typeof row.stage_id === 'string' && CODING_GRIDS.includes(row.stage_id) ? row.stage_id : null;
  if (!grid) return null;
  // accepted=这一格过了；retry=没过要重来；blocked=打转熔断。
  // stopped 是人为收摊，与 cancelled 同理不入账。
  const map = { accepted: 'completed', retry: 'failed', blocked: 'blocked' };
  const status = map[row.verdict];
  if (!status) return null;
  return { report_date: row.report_date, grid, status, duration_ms: null };
}

/**
 * 聚合成 crystal_run_evidence 行：一格一日一行（纯函数，无 DB、无时钟）。
 *
 * 为什么按日聚合而不是一 attempt 一行：行键是 (unit_key, verified_at)，
 * 逐 attempt 落行要拿完成时刻当键，两次尝试同一毫秒完成就会互相覆盖、静默少记一次跑。
 * 按 (格, 北京日) 聚合让键天然唯一，且与台账的按日语义对齐。
 *
 * @param {Array<{report_date:string, grid:string, status:string, duration_ms:number|null}>} records
 * @returns {Array<object>} 按 (日期, 单位) 稳定排序
 */
export function aggregateCodingEvidence(records = []) {
  const buckets = new Map();

  for (const r of records) {
    if (!r || !r.report_date || !r.grid) continue;                 // 无归属的行绝不入账
    if (!CODING_TERMINAL_STATUSES.includes(r.status)) continue;    // 在途/取消不是成败

    const id = `${r.report_date}|${r.grid}`;
    let b = buckets.get(id);
    if (!b) {
      b = { report_date: r.report_date, grid: r.grid, runs: 0, passes: 0, msSum: 0, msCount: 0 };
      buckets.set(id, b);
    }
    b.runs += 1;
    if (isPass(r.status)) b.passes += 1;

    const ms = toFiniteNumber(r.duration_ms);
    if (ms !== null) {
      b.msSum += ms;
      b.msCount += 1;
    }
  }

  return [...buckets.values()]
    .sort((a, b) => (a.report_date === b.report_date
      ? a.grid.localeCompare(b.grid)
      : a.report_date.localeCompare(b.report_date)))
    .map((b) => ({
      unit_key: codingUnitKey(b.grid),
      funnel_cell: null,                                  // 编码线不属于获客漏斗
      report_date: b.report_date,
      runs: b.runs,
      passes: b.passes,
      broken_count: b.runs - b.passes,
      // 无时长样本留 null 而非 0：0ms 是假事实，null 才是「没测到」
      avg_ms: b.msCount > 0 ? b.msSum / b.msCount : null,
      // 无 token 源 → 两条腿都留空，绝不拿耗时或别的数顶替（见文件头纪律②）
      baseline_tokens: null,
      hot_path_tokens: null,
      new_branch_count: 0,                                // 无源，记 0 不臆造
      crystallized: false,                                // 编码九格今天全是纯 LLM
      has_postcondition: gridHasPostcondition(b.grid),    // INV-2：认交接件契约，不认自我声明
      verified_at: verifiedAtForDate(b.report_date),
    }));
}

/** kernel attempt 源：终态 attempt 的相/成败/耗时，北京日在 SQL 里算好避开进程时区歧义。 */
async function fetchKernelAttempts(dbPool, days) {
  const { rows } = await dbPool.query(
    `SELECT to_char(COALESCE(completed_at, updated_at) AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS report_date,
            phase,
            status,
            CASE WHEN started_at IS NOT NULL AND COALESCE(completed_at, updated_at) > started_at
                 THEN EXTRACT(EPOCH FROM (COALESCE(completed_at, updated_at) - started_at)) * 1000
            END AS duration_ms
       FROM harness_attempts
      WHERE status = ANY($2)
        AND COALESCE(completed_at, updated_at) IS NOT NULL
        AND COALESCE(completed_at, updated_at) > NOW() - ($1 || ' days')::interval`,
    [String(days), [...CODING_TERMINAL_STATUSES]],
  );
  return rows;
}

/** home-sequencer 源：监工逐格裁定台账（今天空表，接上即生效）。 */
async function fetchSequencerRecords(dbPool, days) {
  const { rows } = await dbPool.query(
    `SELECT to_char(created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS report_date,
            stage_id,
            verdict
       FROM sequencer_ledger
      WHERE created_at > NOW() - ($1 || ' days')::interval`,
    [String(days)],
  );
  return rows;
}

/** upsert 一行证据。冲突键 (unit_key, verified_at) → 重跑刷新数值，不长行。 */
async function upsertEvidenceRow(dbPool, row) {
  await dbPool.query(
    `INSERT INTO crystal_run_evidence
       (unit_key, funnel_cell, report_date, runs, passes, baseline_tokens, hot_path_tokens,
        avg_ms, device, crystallized, pure_hot_path, has_postcondition,
        new_branch_count, broken_count, raw, verified_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16, NOW())
     ON CONFLICT (unit_key, verified_at) DO UPDATE SET
       funnel_cell = EXCLUDED.funnel_cell,
       report_date = EXCLUDED.report_date,
       runs = EXCLUDED.runs,
       passes = EXCLUDED.passes,
       baseline_tokens = EXCLUDED.baseline_tokens,
       hot_path_tokens = EXCLUDED.hot_path_tokens,
       avg_ms = EXCLUDED.avg_ms,
       crystallized = EXCLUDED.crystallized,
       has_postcondition = EXCLUDED.has_postcondition,
       new_branch_count = EXCLUDED.new_branch_count,
       broken_count = EXCLUDED.broken_count,
       raw = EXCLUDED.raw`,
    [
      row.unit_key,
      row.funnel_cell,
      row.report_date,
      row.runs,
      row.passes,
      row.baseline_tokens,
      row.hot_path_tokens,
      row.avg_ms,
      null,                       // device：编码线跑在容器/机队，无单一设备键
      row.crystallized,
      false,                      // pure_hot_path：纯 LLM，不是热路径
      row.has_postcondition,
      row.new_branch_count,
      row.broken_count,
      JSON.stringify({ source: 'coding-evidence', ...row }),
      row.verified_at,
    ],
  );
}

let lastRunAt = 0;

/**
 * 同步编码线证据：两源取数 → 归一 → 聚合 → upsert。
 *
 * @param {{days?:number, dryRun?:boolean, force?:boolean, dbPool?:import('pg').Pool, now?:Date}} opts
 * @returns {Promise<object>} 摘要（skipped=true 表示被自 gate 挡住）
 */
export async function syncCodingEvidence({
  days = CODING_EVIDENCE_DEFAULT_DAYS,
  dryRun = false,
  force = false,
  dbPool = pool,
  now = new Date(),
} = {}) {
  const nowMs = now.getTime();
  if (!force && nowMs - lastRunAt < SYNC_INTERVAL_MS) {
    return { skipped: true, reason: 'within_interval' };
  }
  lastRunAt = nowMs;

  const [attempts, sequencer] = await Promise.all([
    fetchKernelAttempts(dbPool, days),
    fetchSequencerRecords(dbPool, days),
  ]);

  const records = [
    ...attempts.map(normalizeKernelAttempt),
    ...sequencer.map(normalizeSequencerRecord),
  ].filter(Boolean);

  const rows = aggregateCodingEvidence(records);

  if (!dryRun) {
    for (const row of rows) {
      await upsertEvidenceRow(dbPool, row);
    }
  }

  return {
    days,
    dry_run: dryRun,
    source_records: { harness_attempts: attempts.length, sequencer_ledger: sequencer.length },
    dropped_unmapped: attempts.length + sequencer.length - records.length,
    evidence_rows: rows.length,
    rows,
  };
}
