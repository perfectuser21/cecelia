/**
 * 资源健康 API（任务 5bf2512a，决策 de6dff5d 五块模型第 5 步「资源健康进仓库」）。
 *
 *   POST /api/brain/resource-health/report          执行端上报一次健康观测（内部令牌）
 *   POST /api/brain/resource-health/account-switch  执行端上报账号切换结果，按三态判据落库并回该怎么做（内部令牌）
 *   POST /api/brain/resource-health/check           调度前检查：{resources:[{type,key}]} 或 {task_id}
 *   GET  /api/brain/resource-health                 当下状态（?type=&status=&limit=）
 *   GET  /api/brain/resource-health/warehouse       仓库物件健康汇总（v_warehouse_item_health）
 *   GET  /api/brain/resource-health/:type/:key/history  状态变化历史
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import pool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import {
  normalizeHealthReport, classifyAccountSwitch, accountKey, ACCOUNT_SWITCH_OUTCOMES, HEALTH_STATUSES, RESOURCE_TYPES,
  reportResourceHealth, checkResourcesHealth, summarizeHealthCheck, collectTaskResourceRefs,
  listResourceHealth, getResourceHealthHistory,
} from '../lib/resource-health.js';
import { notifyHealthTransition } from '../lib/resource-health-alert.js';

const router = Router();
router.use('/resource-health', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));

async function writeReport(res, report) {
  try {
    return await reportResourceHealth(pool, report, { notify: notifyHealthTransition });
  } catch (err) {
    if (err.code === 'unknown_item_key') {
      res.status(422).json({ error: err.message });
      return null;
    }
    throw err;
  }
}

router.post('/resource-health/report', internalAuthOrLoopback, async (req, res) => {
  const { report, error } = normalizeHealthReport(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const out = await writeReport(res, report);
    if (!out) return undefined;
    return res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[resource-health] report error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.post('/resource-health/account-switch', internalAuthOrLoopback, async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const verdict = classifyAccountSwitch(b.outcome);
  if (!verdict) return res.status(400).json({ error: `outcome 必须是 ${ACCOUNT_SWITCH_OUTCOMES.join('/')}` });
  const key = accountKey(b.platform, b.account_id);
  if (!key) return res.status(400).json({ error: 'platform 与 account_id 必填' });
  const hasEvidence = b.evidence && typeof b.evidence === 'object' && !Array.isArray(b.evidence) && Object.keys(b.evidence).length > 0;
  if (verdict.status !== 'healthy' && !hasEvidence) return res.status(400).json({ error: `outcome=${b.outcome} 必须带 evidence（截图链接/页面文字等）` });

  const { report, error } = normalizeHealthReport({
    resource_type: 'account', resource_key: key, platform: b.platform, status: verdict.status,
    reason: b.reason ? `${verdict.reason}：${b.reason}` : verdict.reason,
    evidence: { ...(hasEvidence ? b.evidence : {}), outcome: b.outcome },
    source: b.source, item_key: b.item_key, reported_at: b.reported_at,
  });
  if (error) return res.status(400).json({ error });
  try {
    const out = await writeReport(res, report);
    if (!out) return undefined;
    return res.json({ ok: true, resource_key: key, status: verdict.status, action: verdict.action, ...out });
  } catch (err) {
    console.error('[resource-health] account-switch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.post('/resource-health/check', async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    let refs;
    if (Array.isArray(b.resources)) {
      refs = collectTaskResourceRefs({ resource_refs: b.resources });
    } else if (typeof b.task_id === 'string' && b.task_id) {
      const { rows } = await pool.query('SELECT id, payload FROM tasks WHERE id::text = $1', [b.task_id]);
      if (!rows[0]) return res.status(404).json({ error: 'task 不存在' });
      refs = collectTaskResourceRefs(rows[0].payload);
    } else {
      return res.status(400).json({ error: '需要 resources:[{type,key}] 或 task_id' });
    }
    const check = await checkResourcesHealth(pool, refs, { maxAgeHours: b.max_age_hours });
    return res.json({ ...check, resources: refs, summary: summarizeHealthCheck(check) });
  } catch (err) {
    console.error('[resource-health] check error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/resource-health', async (req, res) => {
  const type = typeof req.query.type === 'string' && RESOURCE_TYPES.includes(req.query.type) ? req.query.type : null;
  const status = typeof req.query.status === 'string' && HEALTH_STATUSES.includes(req.query.status) ? req.query.status : null;
  try {
    const items = await listResourceHealth(pool, { type, status, limit: req.query.limit });
    return res.json({ items, count: items.length });
  } catch (err) {
    console.error('[resource-health] list error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/resource-health/warehouse', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM v_warehouse_item_health ORDER BY shelf, key');
    return res.json({ items: rows, count: rows.length });
  } catch (err) {
    console.error('[resource-health] warehouse error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/resource-health/:type/:key/history', async (req, res) => {
  const { type, key } = req.params;
  if (!RESOURCE_TYPES.includes(type)) return res.status(400).json({ error: 'type 非法' });
  try {
    const events = await getResourceHealthHistory(pool, type, key, req.query.limit);
    return res.json({ resource_type: type, resource_key: key, events, count: events.length });
  } catch (err) {
    console.error('[resource-health] history error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
