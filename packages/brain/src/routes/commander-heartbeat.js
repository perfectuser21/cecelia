/**
 * Commander（escort）心跳入口（任务 17ea4536，决策 3c98fb36）。
 *
 *   POST /api/brain/commander-heartbeat            {kind?, tag, host?, serial?, profile?, cap?, escort_name?, escort_id?}
 *   POST /api/brain/tasks/:id/commander-heartbeat  {escort_name?, escort_id?, host?, tag?}
 *
 * escort 跑在 OpenClaw 网关（MMV），经 socat 到 us-vps 非回环、也没有内部令牌，所以不挂 internalAuth——
 * 入口只写 payload 心跳字段、只对 in_progress 行生效、按 tag/单号限流，写不坏状态机。
 */
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import pool from '../db.js';
import { recordCommanderHeartbeat } from '../commander-watchdog.js';

const router = Router();
const SAFE = /^[A-Za-z0-9._-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const heartbeatRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  keyGenerator: (req) => String(req.params?.id ?? req.body?.tag ?? req.body?.serial ?? 'no-tag'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  identifier: 'commander-heartbeat',
  message: { success: false, error: 'commander-heartbeat rate limit exceeded' },
});

router.post('/commander-heartbeat', heartbeatRateLimit, async (req, res) => {
  try {
    const out = await recordCommanderHeartbeat(pool, req.body ?? {});
    return res.status(out.matched ? 200 : 202).json({ success: true, ...out });
  } catch (err) {
    const status = err.status ?? 500;
    if (status >= 500) console.error('[commander-heartbeat] 失败:', err.message);
    return res.status(status).json({ success: false, error: err.message });
  }
});

router.post('/tasks/:id/commander-heartbeat', heartbeatRateLimit, async (req, res) => {
  const { id } = req.params;
  if (!UUID.test(id)) return res.status(400).json({ success: false, error: 'task id 非法' });
  const patch = { commander_heartbeat_at: new Date().toISOString() };
  for (const k of ['escort_name', 'escort_id', 'host', 'tag', 'serial', 'profile']) {
    const v = req.body?.[k];
    if (typeof v === 'string' && SAFE.test(v.trim())) patch[k] = v.trim();
  }
  try {
    const r = await pool.query(
      `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
        WHERE id = $1 AND status = 'in_progress' RETURNING id`,
      [id, JSON.stringify(patch)],
    );
    if (!(r?.rowCount ?? r?.rows?.length)) return res.status(404).json({ success: false, error: 'task 不在途（非 in_progress）' });
    return res.json({ success: true, matched: true, task_id: id, via: 'id' });
  } catch (err) {
    console.error('[commander-heartbeat] 按单号写入失败:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
