/**
 * 发布线接口（决策 de6dff5d 第 3 步，迁移 541）。读接口不需鉴权（同 GET /spans）；写接口 internalAuthOrLoopback。
 *
 * GET  /api/brain/activities/:id/release              生产版 / 最新 / 候选 / 是否受保护 / 事件 / 各目标机最近 release 的版本
 * GET  /api/brain/activities/:id/release-events?limit=
 * GET  /api/brain/activities/:id/content-versions     内容版本列表（构建数、最新构建）
 * GET  /api/brain/workflows/:id/production-recipe?commit=
 * GET  /api/brain/workflows/:id/production-recipes?limit=
 * POST /api/brain/activities/:id/promotions           {candidate_version_id, actor, required_green?, min_runs?, max_runs?, tolerance?, force?, reason?}
 * POST /api/brain/release-line/group-promotions       {actor, members:[{activity_id, candidate_version_id}], ...}
 * POST /api/brain/activities/:id/rollbacks            {actor, reason, to_version_id?}
 * POST /api/brain/release-line/reconcile              幂等补账（构建映射 / 缺失指针 / 配方）
 */
import { Router } from 'express';
import pool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { reconcileReleaseLine } from '../lib/release-line.js';
import { promoteActivity, groupPromote } from '../lib/release-line-gate.js';
import { rollbackActivity } from '../lib/release-line-rollback.js';
import { getActivityRelease, listReleaseEvents, listContentVersions, getProductionRecipe, listProductionRecipes } from '../lib/release-line-query.js';

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const badId = (req, res) => {
  if (UUID.test(req.params.id || '')) return false;
  res.status(400).json({ error: 'id must be a uuid' });
  return true;
};
const limitOf = (v) => {
  if (v === undefined || v === '') return 20;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 200 ? n : null;
};
const sendError = (res, e) => res.status(e.status || 500).json({ error: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) });

router.get('/activities/:id/release', async (req, res) => {
  if (badId(req, res)) return;
  try {
    const out = await getActivityRelease(pool, req.params.id);
    if (!out) return res.status(404).json({ error: 'activity_not_found' });
    return res.json(out);
  } catch (e) { return sendError(res, e); }
});

router.get('/activities/:id/release-events', async (req, res) => {
  if (badId(req, res)) return;
  const limit = limitOf(req.query.limit);
  if (limit === null) return res.status(400).json({ error: 'limit must be an integer in 1..200' });
  try { return res.json({ events: await listReleaseEvents(pool, req.params.id, { limit }) }); } catch (e) { return sendError(res, e); }
});

router.get('/activities/:id/content-versions', async (req, res) => {
  if (badId(req, res)) return;
  try { return res.json({ versions: await listContentVersions(pool, req.params.id) }); } catch (e) { return sendError(res, e); }
});

router.get('/workflows/:id/production-recipe', async (req, res) => {
  if (badId(req, res)) return;
  const commit = req.query.commit;
  if (commit !== undefined && !/^[0-9a-f]{40}$/.test(commit)) return res.status(400).json({ error: 'commit must be a 40-char sha' });
  try {
    const recipe = await getProductionRecipe(pool, req.params.id, { commit: commit || null });
    if (!recipe) return res.status(404).json({ error: 'no_production_recipe' });
    return res.json({ recipe });
  } catch (e) { return sendError(res, e); }
});

router.get('/workflows/:id/production-recipes', async (req, res) => {
  if (badId(req, res)) return;
  const limit = limitOf(req.query.limit);
  if (limit === null) return res.status(400).json({ error: 'limit must be an integer in 1..200' });
  try { return res.json({ recipes: await listProductionRecipes(pool, req.params.id, { limit }) }); } catch (e) { return sendError(res, e); }
});

router.post('/activities/:id/promotions', internalAuthOrLoopback, async (req, res) => {
  if (badId(req, res)) return;
  try {
    const out = await promoteActivity(pool, req.params.id, req.body || {});
    return res.status(out.status).json(out);
  } catch (e) { return sendError(res, e); }
});

router.post('/release-line/group-promotions', internalAuthOrLoopback, async (req, res) => {
  try {
    const out = await groupPromote(pool, req.body || {});
    return res.status(out.status).json(out);
  } catch (e) { return sendError(res, e); }
});

router.post('/activities/:id/rollbacks', internalAuthOrLoopback, async (req, res) => {
  if (badId(req, res)) return;
  try { return res.status(201).json(await rollbackActivity(pool, req.params.id, req.body || {})); } catch (e) { return sendError(res, e); }
});

router.post('/release-line/reconcile', internalAuthOrLoopback, async (_req, res) => {
  try { return res.json(await reconcileReleaseLine(pool)); } catch (e) { return sendError(res, e); }
});

export default router;
