/**
 * 裁判结果查询（五块模型·裁判，决策 de6dff5d）。只读，不需鉴权（同 GET /spans）。
 *
 * GET /api/brain/activities/:activityId/judgments/latest   最新一条裁判（activity_judgments）；没有 → 404
 * GET /api/brain/activities/:activityId/judgments?limit=20  裁判历史，新→旧，limit 1..100
 * GET /api/brain/activities/:activityId/version-compare?candidate=<版本id>&baseline=<版本id>&min_runs=5&max_runs=50&tolerance=0
 *     同一 Activity 两个定义版本对比（lib/activity-version-compare.js compareActivityVersions），晋级门调用；
 *     发布线迁移后 candidate/baseline 可为内容版本 id 或构建 id，样本按内容合并；baseline 省略取生产版；min_runs > max_runs → 400；verdict = not_worse / worse / insufficient_data，带每项指标数字依据。
 */
import { Router } from 'express';
import pool from '../db.js';
import { getLatestJudgment, listJudgments } from '../lib/activity-judge.js';
import { compareActivityVersions, DEFAULT_MIN_RUNS } from '../lib/activity-version-compare.js';

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const intIn = (v, def, min, max) => {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const badId = (req, res) => {
  if (UUID.test(req.params.activityId || '')) return false;
  res.status(400).json({ error: 'activityId must be a uuid' });
  return true;
};

router.get('/activities/:activityId/judgments/latest', async (req, res) => {
  if (badId(req, res)) return;
  try {
    const judgment = await getLatestJudgment(pool, req.params.activityId);
    if (!judgment) return res.status(404).json({ error: 'no_judgment', activity_id: req.params.activityId });
    return res.json({ judgment });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.get('/activities/:activityId/judgments', async (req, res) => {
  if (badId(req, res)) return;
  const limit = intIn(req.query.limit, 20, 1, 100);
  if (limit === null) return res.status(400).json({ error: 'limit must be an integer in 1..100' });
  try {
    const judgments = await listJudgments(pool, req.params.activityId, { limit });
    return res.json({ judgments, total: judgments.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.get('/activities/:activityId/version-compare', async (req, res) => {
  if (badId(req, res)) return;
  const { candidate, baseline } = req.query;
  if (!UUID.test(candidate || '')) return res.status(400).json({ error: 'candidate must be an activity definition version uuid' });
  if (baseline !== undefined && baseline !== '' && !UUID.test(baseline)) return res.status(400).json({ error: 'baseline must be a uuid' });
  const minRuns = intIn(req.query.min_runs, DEFAULT_MIN_RUNS, 1, 1000);
  const maxRuns = intIn(req.query.max_runs, 50, 1, 1000);
  const tolerance = req.query.tolerance === undefined || req.query.tolerance === '' ? 0 : Number(req.query.tolerance);
  if (minRuns === null || maxRuns === null) return res.status(400).json({ error: 'min_runs / max_runs must be integers in 1..1000' });
  if (minRuns > maxRuns) return res.status(400).json({ error: `min_runs (${minRuns}) must not exceed max_runs (${maxRuns})` });
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) return res.status(400).json({ error: 'tolerance must be a number in 0..1' });
  try {
    return res.json(await compareActivityVersions(pool, req.params.activityId, {
      candidateVersionId: candidate, baselineVersionId: baseline || null, minRuns, maxRuns, tolerance,
    }));
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
