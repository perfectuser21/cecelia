/**
 * Spans：执行机按 Activity / Step / Enabler 上报执行段（价值流建模④，决策 3e867cad，任务 ec643d60）。
 *
 * POST /api/brain/spans   内网/回环鉴权；body 单条或数组；每条走 ON CONFLICT (幂等键) DO NOTHING，回报 inserted/skipped
 * GET  /api/brain/spans   ?run_id=（必填）&activity_id=（可选）按 started_at 排序
 */
import { Router } from 'express';
import pool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXECUTOR_KINDS = new Set(['code', 'agent', 'human']);
const OUTCOMES = new Set(['pass', 'fail', 'skipped', 'unknown']);
const TARGET_FIELDS = ['activity_id', 'step_id', 'enabler_id'];

const INSERT_SQL = `
  INSERT INTO spans (run_id, workflow_id, activity_id, step_id, enabler_id, started_at, ended_at, wait_ms,
                     executor_kind, executor_id, model, tokens_in, tokens_out, cost_usd, attempts, fallback, outcome, evidence)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
  ON CONFLICT (run_id, (COALESCE(step_id, activity_id, enabler_id)), started_at) DO NOTHING
  RETURNING id`;

function optionalUuid(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new Error(`${field} must be a uuid`);
  return value;
}

function optionalTimestamp(value, field, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${field} is required`);
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`${field} must be an ISO timestamp`);
  return d.toISOString();
}

function optionalInt(value, field, { min = null } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${field} must be an integer`);
  if (min !== null && n < min) throw new Error(`${field} must be >= ${min}`);
  return n;
}

function normalizeSpan(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`spans[${index}] must be an object`);
  const runId = typeof raw.run_id === 'string' ? raw.run_id.trim() : '';
  if (!runId) throw new Error(`spans[${index}].run_id is required`);

  const targets = Object.fromEntries(TARGET_FIELDS.map((f) => [f, optionalUuid(raw[f], `spans[${index}].${f}`)]));
  if (!TARGET_FIELDS.some((f) => targets[f])) {
    throw new Error(`spans[${index}] needs at least one of activity_id / step_id / enabler_id`);
  }

  const executorKind = raw.executor_kind;
  if (!EXECUTOR_KINDS.has(executorKind)) throw new Error(`spans[${index}].executor_kind must be one of code|agent|human`);
  const outcome = raw.outcome === undefined || raw.outcome === null ? 'unknown' : raw.outcome;
  if (!OUTCOMES.has(outcome)) throw new Error(`spans[${index}].outcome must be one of pass|fail|skipped|unknown`);

  const attempts = raw.attempts === undefined || raw.attempts === null ? 1 : optionalInt(raw.attempts, `spans[${index}].attempts`, { min: 1 });
  const fallback = raw.fallback === undefined || raw.fallback === null ? false : raw.fallback === true || raw.fallback === 'true';
  const evidence = raw.evidence === undefined || raw.evidence === null ? null : JSON.stringify(raw.evidence);
  const costUsd = raw.cost_usd === undefined || raw.cost_usd === null || raw.cost_usd === '' ? null : Number(raw.cost_usd);
  if (costUsd !== null && !Number.isFinite(costUsd)) throw new Error(`spans[${index}].cost_usd must be a number`);

  return [
    runId,
    optionalUuid(raw.workflow_id, `spans[${index}].workflow_id`),
    targets.activity_id,
    targets.step_id,
    targets.enabler_id,
    optionalTimestamp(raw.started_at, `spans[${index}].started_at`, true),
    optionalTimestamp(raw.ended_at, `spans[${index}].ended_at`),
    optionalInt(raw.wait_ms, `spans[${index}].wait_ms`, { min: 0 }),
    executorKind,
    typeof raw.executor_id === 'string' && raw.executor_id ? raw.executor_id : null,
    typeof raw.model === 'string' && raw.model ? raw.model : null,
    optionalInt(raw.tokens_in, `spans[${index}].tokens_in`, { min: 0 }),
    optionalInt(raw.tokens_out, `spans[${index}].tokens_out`, { min: 0 }),
    costUsd,
    attempts,
    fallback,
    outcome,
    evidence,
  ];
}

router.post('/spans', internalAuthOrLoopback, async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  if (items.length === 0) return res.status(400).json({ error: 'body must be a span or a non-empty array of spans' });

  let rows;
  try {
    rows = items.map(normalizeSpan);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    let inserted = 0;
    const ids = [];
    for (const params of rows) {
      const r = await pool.query(INSERT_SQL, params);
      if (r.rowCount > 0) {
        inserted += 1;
        ids.push(r.rows[0].id);
      }
    }
    return res.json({ inserted, skipped: rows.length - inserted, count: rows.length, ids });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.get('/spans', async (req, res) => {
  const runId = typeof req.query.run_id === 'string' ? req.query.run_id.trim() : '';
  if (!runId) return res.status(400).json({ error: 'run_id is required' });
  let activityId;
  try {
    activityId = optionalUuid(req.query.activity_id, 'activity_id');
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const params = [runId];
  let sql = 'SELECT * FROM spans WHERE run_id = $1';
  if (activityId) {
    params.push(activityId);
    sql += ' AND activity_id = $2';
  }
  sql += ' ORDER BY started_at ASC, created_at ASC';

  try {
    const r = await pool.query(sql, params);
    return res.json({ spans: r.rows, total: r.rows.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
