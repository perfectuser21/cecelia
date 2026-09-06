/**
 * Crystal 结晶判官路由（挂在 /api/brain/crystal）
 *
 * POST /run              — 触发判官：八格聚合→三态判决→每日报告落库（同步、幂等）
 * GET  /report[?date=]   — 查询每日结晶报告（八格建议 + 三态 + 依据 + 六项指标），缺省最近一日
 * POST /locator          — registry 回写（复合键 model|app_version|density，缺一即 400）
 * POST /evidence/validate — 证据留存规范校验（缺 trial/timestamp→400；复用覆盖→409）
 * POST /evidence         — 运行证据入库（判官口粮通道，幂等键 unit_key+verified_at）
 *
 * 决策 28ca1f69：判定层不蒸馏 / 探针强制 / registry是数据 / 证据留痕 / 固化优先级。
 */

import { Router } from 'express';
import pool from '../db.js';
import { runCrystalJudge, beijingDateStr } from '../crystal-judge.js';
import { parseEvidenceFilename, assertNoOverwrite } from '../crystal/evidence.js';

const router = Router();

/**
 * POST /api/brain/crystal/run
 * 触发结晶判官，同步返回本轮八格判决摘要。
 */
router.post('/run', async (_req, res) => {
  try {
    const result = await runCrystalJudge(pool);
    return res.json(result);
  } catch (err) {
    console.error('[crystal] /run failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/crystal/report?date=YYYY-MM-DD
 * 缺省取最近一日报告。无报告 → 404 no_report_for_date。
 */
router.get('/report', async (req, res) => {
  try {
    const { date } = req.query;
    const { rows } = date
      ? await pool.query(
          `SELECT report_date, grid_count, suggestions, data_gaps
           FROM crystal_report WHERE report_date = $1 LIMIT 1`,
          [date],
        )
      : await pool.query(
          `SELECT report_date, grid_count, suggestions, data_gaps
           FROM crystal_report ORDER BY report_date DESC, created_at DESC LIMIT 1`,
        );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'no_report_for_date' });
    }

    const row = rows[0];
    const reportDate =
      row.report_date instanceof Date
        ? row.report_date.toISOString().slice(0, 10)
        : String(row.report_date);

    return res.json({
      ok: true,
      report_date: reportDate,
      grid_count: row.grid_count,
      suggestions: row.suggestions,
      data_gaps: row.data_gaps,
    });
  } catch (err) {
    console.error('[crystal] /report failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/crystal/locator
 * registry 回写：复合键 model|app_version|density 缺一即 400（INV-3 禁半键落库）。
 */
router.post('/locator', async (req, res) => {
  try {
    const { model, app_version, density, locator } = req.body || {};
    if (!model || !app_version || !density) {
      return res.status(400).json({ error: 'missing_registry_key_component' });
    }
    await pool.query(
      `INSERT INTO crystal_locator_registry (model, app_version, density, locator, created_at, updated_at)
       VALUES ($1,$2,$3,$4::jsonb, NOW(), NOW())
       ON CONFLICT (model, app_version, density) DO UPDATE SET
         locator = EXCLUDED.locator,
         updated_at = NOW()`,
      [model, app_version, density, JSON.stringify(locator || {})],
    );
    return res.json({ ok: true, key: `${model}|${app_version}|${density}` });
  } catch (err) {
    console.error('[crystal] /locator failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/crystal/evidence/validate
 * 证据留存规范：缺 trial/timestamp → 400；命中 existing（复用覆盖）→ 409。
 */
router.post('/evidence/validate', async (req, res) => {
  try {
    const { filename, existing } = req.body || {};
    if (typeof filename !== 'string' || filename.length === 0) {
      return res.status(400).json({ error: 'evidence_filename_missing_trial_or_timestamp' });
    }
    const parsed = parseEvidenceFilename(filename);
    if (!parsed.valid) {
      return res.status(400).json({ error: 'evidence_filename_missing_trial_or_timestamp' });
    }
    try {
      assertNoOverwrite(Array.isArray(existing) ? existing : [], filename);
    } catch {
      return res.status(409).json({ error: 'evidence_filename_overwrite_forbidden' });
    }
    return res.json({ ok: true, trial: parsed.trial, timestamp: parsed.timestamp });
  } catch (err) {
    console.error('[crystal] /evidence/validate failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/crystal/evidence
 * 运行证据入库 —— 判官的口粮通道。接收 crystal-verify.mjs 产出的 verify-*.json。
 *
 * 判官原先读不到任何真实运行数据（aggregateGridMetrics 是返回空值的桩），
 * 台账恒为 n_runs=0/data_gap=true。本端点就是那根缺失的管子。
 *
 * baseline_tokens（不固化则需消耗的 LLM token）是选填但**判官必需**：缺了判官会
 * 诚实记 data_gap 而非拿热路径成本顶替——因为判决引擎的 cost_benefit =
 * n_runs × token_cost 衡量的是「不固化要烧多少」，取错方向差一个数量级。
 *
 * 幂等：同一段同一次校验重复上报走 (unit_key, verified_at) upsert，不产生重复行。
 */
router.post('/evidence', async (req, res) => {
  try {
    const b = req.body || {};
    const unitKey = b.unit_key || b.sequence;
    const verifiedAt = b.verified_at;
    const runs = Number(b.runs);
    const passes = Number(b.passes);

    const missing = [];
    if (!unitKey) missing.push('unit_key|sequence');
    if (!verifiedAt) missing.push('verified_at');
    if (!Number.isFinite(runs)) missing.push('runs');
    if (!Number.isFinite(passes)) missing.push('passes');
    if (missing.length) {
      return res.status(400).json({ error: 'missing_required_fields', missing });
    }
    if (passes > runs) {
      return res.status(400).json({ error: 'passes_exceeds_runs', runs, passes });
    }

    const reportDate = b.report_date || beijingDateStr(new Date(verifiedAt));

    const { rows } = await pool.query(
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
         device = EXCLUDED.device,
         crystallized = EXCLUDED.crystallized,
         pure_hot_path = EXCLUDED.pure_hot_path,
         has_postcondition = EXCLUDED.has_postcondition,
         new_branch_count = EXCLUDED.new_branch_count,
         broken_count = EXCLUDED.broken_count,
         raw = EXCLUDED.raw
       RETURNING id, unit_key, report_date, runs, passes, baseline_tokens`,
      [
        unitKey,
        b.funnel_cell ?? null,
        reportDate,
        runs,
        passes,
        b.baseline_tokens ?? null,
        b.hot_path_tokens ?? b.avg_tokens ?? null,
        b.avg_ms ?? null,
        b.device ?? null,
        b.crystallized === true,
        b.pure_hot_path === true,
        b.has_postcondition === true,
        Number(b.new_branch_count) || 0,
        Number(b.broken_count) || Math.max(0, runs - passes),
        JSON.stringify(b),
        verifiedAt,
      ],
    );

    const row = rows[0];
    return res.json({
      ok: true,
      evidence: row,
      // 明说判官会不会吃到，避免"入库了却仍 data_gap"这种静默困惑
      judge_usable: row.baseline_tokens !== null,
      note: row.baseline_tokens === null
        ? '缺 baseline_tokens：判官将记 data_gap（不拿热路径成本顶替）'
        : undefined,
    });
  } catch (err) {
    console.error('[crystal] /evidence failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
