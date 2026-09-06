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

/** 数据缺口时的诚实降级值：不误判为成功/失败（件4 PRD 边界③ 语义原样保留）。 */
function gapMetrics(unitKey, extra = {}) {
  return {
    grid_key: unitKey,
    unit_key: unitKey,
    funnel_cell: null,
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
    ...extra,
  };
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 聚合单个判决单位（段）当日六项指标 —— 判官的口粮入口。
 *
 * 数据源 crystal_run_evidence（迁移 438），由 POST /crystal/evidence 从 crystal-verify.mjs
 * 的 verify-*.json 搬运入库。判官对源只读，只写 crystal_* 表（件4 NFR 数据完整性不变）。
 *
 * token_cost 取 baseline_tokens 而非 hot_path_tokens：判决引擎用 n_runs × token_cost 与
 * 固化成本基线比大小，衡量的是「不固化要烧多少」。取热路径会把收益算小一个数量级
 * （实测 696 vs 10158，差 14.6 倍），导致永远达不到基线、永远晋升不了。
 * 缺 baseline 时记 data_gap，不拿热路径顶替、不臆造。
 *
 * @param {import('pg').Pool} dbPool
 * 聚合窗口是**滚动的**，不按自然日切断：minRuns=20 的语义是「最近 windowDays 天内累计
 * 跑够 20 次」。曾经用 `report_date = $2` 只捞当天，等价于要求「单日内跑够 20 次」——
 * 今天 10 次明天 10 次会永远停在 10，promote 路径实质是死的（主理人 2026-09-06 指出）。
 * 窗口默认取 demoteWindowDays，让晋升与降级用同一把尺，不出现一个看单日一个看窗口。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} unitKey 判决单位键（段名，如 search_account；历史漏斗格 og1..og8 同样有效）
 * @param {string} reportDate YYYY-MM-DD（北京时区），窗口右端
 * @param {number} [windowDays] 滚动窗口天数，默认与降级观察窗一致
 */
export async function aggregateUnitMetrics(
  dbPool,
  unitKey,
  reportDate,
  windowDays = CRYSTAL_THRESHOLDS.demoteWindowDays,
) {
  let rows = [];
  try {
    const r = await dbPool.query(
      `SELECT unit_key, funnel_cell, runs, passes, baseline_tokens, hot_path_tokens,
              avg_ms, crystallized, has_postcondition, new_branch_count, broken_count
         FROM crystal_run_evidence
        WHERE unit_key = $1
          AND report_date <= $2::date
          AND report_date > ($2::date - $3::int)`,
      [unitKey, reportDate, windowDays],
    );
    rows = r?.rows ?? [];
  } catch (err) {
    // 表缺失/源不可达 → 降级数据缺口，绝不误判（件4 PRD 边界③）
    console.warn('[crystal-judge] 证据读取失败（降级 data_gap）unit=%s: %s', unitKey, err.message);
    return gapMetrics(unitKey);
  }

  if (rows.length === 0) return gapMetrics(unitKey);

  let runs = 0;
  let passes = 0;
  let broken = 0;
  let newBranch = 0;
  let msWeighted = 0;
  let baselineWeighted = 0;
  let baselineMissing = false;
  let hasPostcondition = false;
  let isHardened = false;
  let funnelCell = null;

  for (const row of rows) {
    const n = toNum(row.runs) ?? 0;
    runs += n;
    passes += toNum(row.passes) ?? 0;
    broken += toNum(row.broken_count) ?? 0;
    newBranch += toNum(row.new_branch_count) ?? 0;

    const ms = toNum(row.avg_ms);
    if (ms !== null) msWeighted += ms * (n || 1);

    const base = toNum(row.baseline_tokens);
    if (base === null) baselineMissing = true;
    else baselineWeighted += base * (n || 1);

    if (row.has_postcondition) hasPostcondition = true;
    if (row.crystallized) isHardened = true;
    if (!funnelCell && row.funnel_cell) funnelCell = row.funnel_cell;
  }

  const weight = runs || rows.length;

  // 缺 baseline 无法衡量固化收益 → 诚实记缺口，不用热路径成本顶替
  if (baselineMissing) {
    return gapMetrics(unitKey, {
      funnel_cell: funnelCell,
      has_postcondition: hasPostcondition,
      is_hardened: isHardened,
    });
  }

  return {
    grid_key: unitKey,
    unit_key: unitKey,
    funnel_cell: funnelCell,
    n_runs: runs,
    success_rate: runs > 0 ? passes / runs : null,
    token_cost: baselineWeighted / weight,
    latency_ms: msWeighted > 0 ? msWeighted / weight : null,
    new_branch_rate: runs > 0 ? newBranch / runs : 0,
    broken_count: broken,
    has_postcondition: hasPostcondition,
    is_hardened: isHardened,
    // 判定层标志由证据显式携带；未标注即非判定层（INV-1 仅在显式标注时生效）
    is_judgment_layer: false,
    data_gap: false,
  };
}

/** 只挑出报告/台账要落库的六项指标。 */
function pickSixMetrics(m) {
  const out = {};
  for (const k of SIX_METRIC_KEYS) out[k] = m[k] === undefined ? null : m[k];
  return out;
}

/**
 * 判一个段：聚合窗口内证据 → 三态判决 → upsert 台账与判决两表。
 *
 * 每日全量报告与「证据入库即重判」共用这一条路径，避免两处各写一份判决逻辑而漂移。
 * 曾经判决只在北京 05:00 那一次窗口里发生，当天跑够也要等次日才知道结果
 * （主理人 2026-09-06 指出）；现在 POST /crystal/evidence 入库成功后就地调用本函数。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} unitKey 判决单位键（段名或历史漏斗格）
 * @param {string} reportDate YYYY-MM-DD（北京时区）
 * @returns {Promise<{unit_key:string, verdict:string, basis:object, metrics:object, data_gap:boolean}>}
 */
export async function judgeUnit(dbPool, unitKey, reportDate) {
  const metrics = await aggregateUnitMetrics(dbPool, unitKey, reportDate);
  const { verdict, basis } = classifyCrystalVerdict(metrics, CRYSTAL_THRESHOLDS);
  const sixMetrics = pickSixMetrics(metrics);

  // 台账：六项指标落库（幂等键 report_date+grid_key，同日重跑刷新 created_at 供时间窗计数）
  await dbPool.query(
    `INSERT INTO crystal_ledger
       (report_date, grid_key, n_runs, success_rate, token_cost, latency_ms, new_branch_rate, broken_count, data_gap, funnel_cell, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW(), NOW())
     ON CONFLICT (report_date, grid_key) DO UPDATE SET
       funnel_cell = EXCLUDED.funnel_cell,
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
      unitKey,
      sixMetrics.n_runs,
      sixMetrics.success_rate,
      sixMetrics.token_cost,
      sixMetrics.latency_ms,
      sixMetrics.new_branch_rate,
      sixMetrics.broken_count,
      metrics.data_gap,
      metrics.funnel_cell ?? null,
    ],
  );

  // 判决：每段每日有且仅有 1 条（UNIQUE 冲突 upsert，防重复判决），带依据 basis
  await dbPool.query(
    `INSERT INTO crystal_verdict (report_date, grid_key, verdict, basis, funnel_cell, created_at, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,$5, NOW(), NOW())
     ON CONFLICT (report_date, grid_key) DO UPDATE SET
       verdict = EXCLUDED.verdict,
       basis = EXCLUDED.basis,
       funnel_cell = EXCLUDED.funnel_cell,
       created_at = NOW(),
       updated_at = NOW()`,
    [reportDate, unitKey, verdict, JSON.stringify(basis), metrics.funnel_cell ?? null],
  );

  return { unit_key: unitKey, verdict, basis, metrics: sixMetrics, data_gap: metrics.data_gap };
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

  // 判决单位 = 漏斗八格（件4 第一批被告，无证据则诚实记 data_gap）
  //          ∪ 当日有运行证据的段（决策 28ca1f69 第④条：蒸馏分段进行，判决粒度是段）
  const judgedUnits = [...OPENCLAW_LEADGEN_GRIDS];
  try {
    const { rows } = await dbPool.query(
      `SELECT DISTINCT unit_key FROM crystal_run_evidence WHERE report_date = $1`,
      [reportDate],
    );
    for (const r of rows ?? []) {
      if (r.unit_key && !judgedUnits.includes(r.unit_key)) judgedUnits.push(r.unit_key);
    }
  } catch (err) {
    // 证据表不可读 → 只审八格，保持件4 原行为，不阻断
    console.warn('[crystal-judge] 段清单读取失败（只审漏斗八格）:', err.message);
  }

  for (const gridKey of judgedUnits) {
    try {
      const r = await judgeUnit(dbPool, gridKey, reportDate);
      verdicts.push({ grid_key: gridKey, verdict: r.verdict });
      suggestions.push({ grid_key: gridKey, verdict: r.verdict, basis: r.basis, metrics: r.metrics });
      if (r.data_gap) dataGaps.push(gridKey);
      gridCount++;
    } catch (err) {
      // 单段失败不阻断其余段（失败语义声明）；写 Brain log
      console.warn('[crystal-judge] 单段判决失败（跳过）unit=%s: %s', gridKey, err.message);
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
