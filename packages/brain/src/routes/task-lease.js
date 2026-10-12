/**
 * task-lease.js 路由 — 统一领单租约的心跳与释放（派发总闸 G，任务 c5f6e683）。
 * 挂在 /api/brain/tasks 下（经 task-tasks.js router.use）：
 *   POST /:id/heartbeat      { claimer, lease_seconds? } → 200 { ok, lease_until } | 409 { error:'lease_lost' }
 *   POST /:id/lease/release  { claimer, reason? }         → 200 { released }
 * 409 lease_lost = 认领已换人 / 任务已终态 / 租约已被 Brain 回收（回队或判 lost）——执行者必须立即停手、不再回写。
 * 认领本身仍是 POST /:id/claim（带 lease_seconds / on_lease_expire 即落租约）。
 */
import { Router } from 'express';
import pool from '../db.js';
import { heartbeatTaskLease, releaseTaskLease } from '../lib/task-lease.js';

const router = Router();

router.post('/:id/heartbeat', async (req, res) => {
  try {
    const { claimer, lease_seconds: leaseSeconds } = req.body || {};
    if (!claimer) return res.status(400).json({ error: 'claimer is required' });
    const r = await heartbeatTaskLease(pool, { taskId: req.params.id, claimer, leaseSeconds });
    if (!r.ok) {
      return res.status(409).json({ error: 'lease_lost', status: r.task?.status ?? null, claimed_by: r.task?.claimed_by ?? null });
    }
    res.json({ ok: true, lease_until: r.lease.lease_until, lease_seconds: r.lease.lease_seconds, heartbeat_count: r.lease.heartbeat_count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to heartbeat lease', details: err.message });
  }
});

router.post('/:id/lease/release', async (req, res) => {
  try {
    const { claimer, reason } = req.body || {};
    if (!claimer) return res.status(400).json({ error: 'claimer is required' });
    res.json(await releaseTaskLease(pool, { taskId: req.params.id, claimer, reason }));
  } catch (err) {
    res.status(500).json({ error: 'Failed to release lease', details: err.message });
  }
});

export default router;
