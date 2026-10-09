/**
 * 路 B 入口（树+仓库 v3.0 第 4 刀，任务 3590ec8f）：技能按 Step 发 span → 沉淀成候选 Activity → 收敛对账。
 *
 * POST /api/brain/step-reconcile/:activityId   body {runs?=5, required_green?=5}：Step span 与 Steps.readback 对账，readback 格翻色
 * POST /api/brain/skill-settlement/draft       body {run_ids[], capability_key, activity_key, skill_md?, skill_name?}：读 spans 起草，不写库
 * POST /api/brain/skill-settlement/register    body {draft, journey_id, skill_name?}：登记候选 Activity + Steps + 8 灰格 + 一条待拍板
 * 写入口走内网/回环鉴权（同 POST /spans）。
 */
import { Router } from 'express';
import pool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { reconcileActivity } from '../lib/step-reconcile.js';
import { draftFromSpans, registerCandidate, parseSkillMd } from '../lib/skill-settlement.js';

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z][a-z0-9_]*$/;
const intIn = (v, def, min, max) => {
  if (v === undefined || v === null) return def;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

router.post('/step-reconcile/:activityId', internalAuthOrLoopback, async (req, res) => {
  const { activityId } = req.params;
  if (!UUID.test(activityId)) return res.status(400).json({ error: 'activityId must be a uuid' });
  const runsWanted = intIn(req.body?.runs, 5, 1, 50);
  const requiredGreen = intIn(req.body?.required_green, 5, 1, 50);
  if (runsWanted === null || requiredGreen === null) return res.status(400).json({ error: 'runs / required_green must be integers in 1..50' });
  try {
    return res.json(await reconcileActivity(pool, activityId, { runsWanted, requiredGreen }));
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/skill-settlement/draft', internalAuthOrLoopback, async (req, res) => {
  const { run_ids: runIds, capability_key: capabilityKey, activity_key: activityKey, skill_md: skillMd, skill_name: skillName } = req.body || {};
  if (!Array.isArray(runIds) || runIds.length === 0 || runIds.some(r => typeof r !== 'string' || !r)) return res.status(400).json({ error: 'run_ids must be a non-empty string array' });
  if (!KEY.test(capabilityKey || '') || !KEY.test(activityKey || '')) return res.status(400).json({ error: 'capability_key / activity_key must be snake_case keys' });
  try {
    const { rows } = await pool.query(
      `SELECT run_id, step_id, outcome, executor_kind, attempts, started_at, evidence FROM spans
        WHERE run_id = ANY($1::text[]) AND evidence ? 'step_key' ORDER BY started_at`, [runIds]);
    const skill = parseSkillMd(skillMd || '');
    if (skillName && !skill.name) skill.name = skillName;
    return res.json(draftFromSpans({ skill, spans: rows, capabilityKey, activityKey }));
  } catch (e) {
    return res.status(/^no_step_spans/.test(e.message) ? 422 : 500).json({ error: e.message });
  }
});

router.post('/skill-settlement/register', internalAuthOrLoopback, async (req, res) => {
  const { draft, journey_id: journeyId, skill_name: skillName } = req.body || {};
  if (!draft?.activity?.key || !draft.activity.capability_key || !Array.isArray(draft.steps) || draft.steps.length === 0) {
    return res.status(400).json({ error: 'draft needs activity.key / activity.capability_key and at least one step' });
  }
  if (!UUID.test(journeyId || '')) return res.status(400).json({ error: 'journey_id must be a uuid' });
  try {
    const out = await registerCandidate(pool, { draft, journeyId, skillName: skillName ?? null });
    return res.status(out.created ? 201 : 200).json(out);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
