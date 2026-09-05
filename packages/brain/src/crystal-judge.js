/**
 * crystal-judge.js — 结晶判官（Crystal 第4件）
 *
 * 对 OpenClaw leadgen 八格逐格聚合六项指标 → 落结晶台账（crystal_ledger）→ 套三态规则出判决
 * （crystal_verdict）→ 生成每日结晶报告（crystal_report）。同步执行、幂等
 * （report_date+grid_key upsert 刷新 created_at）。
 *
 * NFR 数据完整性：判官对数据源只读、best-effort 拉取，只写 crystal_* 表。
 * 数据源（n8n execution_entity / HK 裁决流水采集器 / postcondition 结果）本地库尚未落表
 * （PRD 假设①：外部/未接入）→ 取不到即该格 data_gap=true / n_runs=0，报告标注数据缺口，
 * 不误判为成功/失败（PRD 边界③）。源接入不在本 sprint 范围（接缝 3 logic-done）。
 */

import pool from './db.js';
import { OPENCLAW_LEADGEN_GRIDS } from './crystal/grids.js';
import { classifyCrystalVerdict, CRYSTAL_THRESHOLDS } from './crystal/verdict-engine.js';

const SIX_METRIC_KEYS = ['n_runs', 'success_rate', 'token_cost', 'latency_ms', 'new_branch_rate', 'broken_count'];

/**
 * 计算北京时区（UTC+8）的日期字符串 YYYY-MM-DD，作为 report_date。
 */
export function beijingDateStr(now = new Date()) {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * best-effort 聚合单格六项指标。源未落本地表 → 数据缺口降级（不误判）。
 * 返回结构含判决引擎所需的判定标志（has_postcondition/is_hardened/is_judgment_layer/data_gap）。
 */
async function aggregateGridMetrics(_dbPool, gridKey) {
  // 数据源（n8n execution_entity / 采集器 / postcondition）本地未落表，判官对源只读。
  // 本 sprint 无本地真目标可读 → 该格数据缺口，保持纯 LLM（PRD 边界③ / 接缝 3）。
  return {
    grid_key: gridKey,
    n_runs: 0,
    success_rate: null,
    token_cost: 0,
    latency_ms: null,
    new_branch_rate: 0,
    broken_count: 0,
    has_postcondition: false,
    is_hardened: false,
    is_judgment_layer: false,
    data_gap: true,
  };
}

/** 只挑出报告/台账要落库的六项指标。 */
function pickSixMetrics(m) {
  const out = {};
  for (const k of SIX_METRIC_KEYS) out[k] = m[k] === undefined ? null : m[k];
  return out;
}

/**
 * 触发结晶判官。八格逐格聚合 → 判决 → 落库 → 生成报告。
 * @param {import('pg').Pool} [dbPool]
 * @param {Date} [now]
 * @returns {Promise<{ok:true, report_date:string, grid_count:number, verdicts:Array<{grid_key:string, verdict:string}>}>}
 */
export async function runCrystalJudge(dbPool = pool, now = new Date()) {
  const reportDate = beijingDateStr(now);
  const verdicts = [];
  const suggestions = [];
  const dataGaps = [];
  let gridCount = 0;

  for (const gridKey of OPENCLAW_LEADGEN_GRIDS) {
    try {
      const metrics = await aggregateGridMetrics(dbPool, gridKey);
      const { verdict, basis } = classifyCrystalVerdict(metrics, CRYSTAL_THRESHOLDS);
      const sixMetrics = pickSixMetrics(metrics);

      // 台账：六项指标落库（幂等键 report_date+grid_key，同日重跑刷新 created_at 供时间窗计数）
      await dbPool.query(
        `INSERT INTO crystal_ledger
           (report_date, grid_key, n_runs, success_rate, token_cost, latency_ms, new_branch_rate, broken_count, data_gap, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW(), NOW())
         ON CONFLICT (report_date, grid_key) DO UPDATE SET
           n_runs = EXCLUDED.n_runs,
           success_rate = EXCLUDED.success_rate,
           token_cost = EXCLUDED.token_cost,
           latency_ms = EXCLUDED.latency_ms,
           new_branch_rate = EXCLUDED.new_branch_rate,
           broken_count = EXCLUDED.broken_count,
           data_gap = EXCLUDED.data_gap,
           created_at = NOW(),
           updated_at = NOW()`,
        [
          reportDate,
          gridKey,
          sixMetrics.n_runs,
          sixMetrics.success_rate,
          sixMetrics.token_cost,
          sixMetrics.latency_ms,
          sixMetrics.new_branch_rate,
          sixMetrics.broken_count,
          metrics.data_gap,
        ],
      );

      // 判决：每格有且仅有 1 条（UNIQUE 冲突 upsert，防重复判决），带依据 basis
      await dbPool.query(
        `INSERT INTO crystal_verdict (report_date, grid_key, verdict, basis, created_at, updated_at)
         VALUES ($1,$2,$3,$4::jsonb, NOW(), NOW())
         ON CONFLICT (report_date, grid_key) DO UPDATE SET
           verdict = EXCLUDED.verdict,
           basis = EXCLUDED.basis,
           created_at = NOW(),
           updated_at = NOW()`,
        [reportDate, gridKey, verdict, JSON.stringify(basis)],
      );

      verdicts.push({ grid_key: gridKey, verdict });
      suggestions.push({ grid_key: gridKey, verdict, basis, metrics: sixMetrics });
      if (metrics.data_gap) dataGaps.push(gridKey);
      gridCount++;
    } catch (err) {
      // 单格失败不阻断其余格（失败语义声明）；写 Brain log
      console.warn(`[crystal-judge] grid ${gridKey} 判决失败（跳过）:`, err.message);
    }
  }

  // 每日报告：按 report_date 分日 upsert 全量建议清单
  await dbPool.query(
    `INSERT INTO crystal_report (report_date, grid_count, suggestions, data_gaps, created_at, updated_at)
     VALUES ($1,$2,$3::jsonb,$4::jsonb, NOW(), NOW())
     ON CONFLICT (report_date) DO UPDATE SET
       grid_count = EXCLUDED.grid_count,
       suggestions = EXCLUDED.suggestions,
       data_gaps = EXCLUDED.data_gaps,
       created_at = NOW(),
       updated_at = NOW()`,
    [reportDate, gridCount, JSON.stringify(suggestions), JSON.stringify(dataGaps)],
  );

  return { ok: true, report_date: reportDate, grid_count: gridCount, verdicts };
}

/**
 * scheduler 入口：北京窗口（北京 05:00，UTC 21:00，5min 内）+ 当日去重（当日已有报告则跳过）。
 * @param {import('pg').Pool} [dbPool]
 * @param {Date} [now]
 */
export async function maybeRunCrystalJudge(dbPool = pool, now = new Date()) {
  const inWindow = now.getUTCHours() === 21 && now.getUTCMinutes() < 5;
  if (!inWindow) {
    return { triggered: false, reason: 'outside_window' };
  }
  const reportDate = beijingDateStr(now);
  const { rows } = await dbPool.query(
    `SELECT 1 FROM crystal_report WHERE report_date = $1 LIMIT 1`,
    [reportDate],
  );
  if (rows.length > 0) {
    return { triggered: false, reason: 'already_ran_today' };
  }
  const result = await runCrystalJudge(dbPool, now);
  return { triggered: true, ...result };
}
