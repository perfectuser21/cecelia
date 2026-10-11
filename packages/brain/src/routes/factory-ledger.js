/**
 * 技能工厂台账接口（迁移 548；任务 1c589b13；决策 cc008b7e / 2bb08a99）。读接口不需鉴权；写接口 internalAuthOrLoopback。
 *
 * GET   /api/brain/factory/ledger?stage=&workflow_id=&limit=   列表（带 workflow key/name、阶段中文名）
 * GET   /api/brain/factory/ledger/:id                         单行 + 阶段事件（最近 50 条，时间正序）
 * POST  /api/brain/factory/ledger                             新业务进厂 {workflow_id, stage?=1, validation_mode?, window_k?, next_action?, reason?, actor?}
 * PATCH /api/brain/factory/ledger/:id                         改非阶段字段 {validation_mode, production_version, candidate_version, window_k, next_action, blocked_reason, blocked_kind}
 * POST  /api/brain/factory/ledger/:id/transition              改阶段 {to_stage, actor: rule|human|agent, reason, evidence_run_ids?, expected_from_stage?, actor_name?, reset_window?}
 * POST  /api/brain/factory/ledger/:id/runs                    记一次运行结果 {run_id, pass, degraded?}（滑窗 window_k，同 run_id 窗内去重）
 */
import { Router } from 'express';
import pool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import {
  isUuid, isStage, listLedger, getLedger, createLedger, patchLedger, transitionLedger, recordRun,
  validateCreate, validatePatch, validateTransition, validateRun,
} from '../lib/factory-ledger.js';

const router = Router();
const badId = (req, res) => {
  if (isUuid(req.params.id)) return false;
  res.status(400).json({ error: 'id must be a uuid', code: 'INVALID_INPUT' });
  return true;
};
const sendError = (res, e) => res.status(e.status || 500).json({ error: e.message, code: e.code });
const run = (res, fn, okStatus = 200) => fn().then((out) => res.status(okStatus).json(out), (e) => sendError(res, e));
/** 先在路由层做同一份入参校验：参数错直接 400，不进库函数。 */
const precheck = (res, validate, body) => {
  try { validate(body || {}); return true; } catch (e) { sendError(res, e); return false; }
};

router.get('/factory/ledger', async (req, res) => {
  const { stage, workflow_id: workflowId, limit } = req.query;
  const stageN = stage === undefined || stage === '' ? null : Number(stage);
  if (stageN !== null && !isStage(stageN)) return res.status(400).json({ error: 'stage must be an integer in 1..7', code: 'INVALID_INPUT' });
  if (workflowId !== undefined && workflowId !== '' && !isUuid(workflowId)) return res.status(400).json({ error: 'workflow_id must be a uuid', code: 'INVALID_INPUT' });
  const limitN = limit === undefined || limit === '' ? 100 : Number(limit);
  if (!Number.isInteger(limitN) || limitN < 1 || limitN > 500) return res.status(400).json({ error: 'limit must be an integer in 1..500', code: 'INVALID_INPUT' });
  return run(res, async () => ({ ledger: await listLedger(pool, { stage: stageN, workflowId: workflowId || null, limit: limitN }) }));
});

router.get('/factory/ledger/:id', async (req, res) => {
  if (badId(req, res)) return;
  try {
    const out = await getLedger(pool, req.params.id);
    if (!out) return res.status(404).json({ error: 'factory ledger row not found', code: 'LEDGER_NOT_FOUND' });
    return res.json(out);
  } catch (e) { return sendError(res, e); }
});

router.post('/factory/ledger', internalAuthOrLoopback, async (req, res) => {
  if (!precheck(res, validateCreate, req.body)) return;
  return run(res, () => createLedger(pool, req.body), 201);
});

router.patch('/factory/ledger/:id', internalAuthOrLoopback, async (req, res) => {
  if (badId(req, res) || !precheck(res, validatePatch, req.body)) return;
  return run(res, () => patchLedger(pool, req.params.id, req.body));
});

router.post('/factory/ledger/:id/transition', internalAuthOrLoopback, async (req, res) => {
  if (badId(req, res) || !precheck(res, validateTransition, req.body)) return;
  return run(res, () => transitionLedger(pool, req.params.id, req.body));
});

router.post('/factory/ledger/:id/runs', internalAuthOrLoopback, async (req, res) => {
  if (badId(req, res) || !precheck(res, validateRun, req.body)) return;
  return run(res, () => recordRun(pool, req.params.id, req.body));
});

export default router;
