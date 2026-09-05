/**
 * Crystal 结晶判官路由（挂在 /api/brain/crystal）
 *
 * POST /run              — 触发判官：八格聚合→三态判决→每日报告落库（同步、幂等）
 * GET  /report[?date=]   — 查询每日结晶报告（八格建议 + 三态 + 依据 + 六项指标），缺省最近一日
 * POST /locator          — registry 回写（复合键 model|app_version|density，缺一即 400）
 * POST /evidence/validate — 证据留存规范校验（缺 trial/timestamp→400；复用覆盖→409）
 *
 * 决策 28ca1f69：判定层不蒸馏 / 探针强制 / registry是数据 / 证据留痕 / 固化优先级。
 */

import { Router } from 'express';
import pool from '../db.js';
import { runCrystalJudge } from '../crystal-judge.js';
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

export default router;
