import { Router } from 'express';
import pool from '../db.js';
import { callLLM } from '../llm-caller.js';
import { createTaskIntake, createTaskIntakeList } from '../task-intake.js';

export function createTaskIntakeRouter({ intake = createTaskIntake({ db: pool, callLLM }),
  listTasks = createTaskIntakeList({ db: pool }) } = {}) {
  const router = Router();
  const tenantFor = (req) => String(req.get('x-tenant-id') ?? 'default').trim() || 'default';
  router.get('/', async (req, res) => {
    try {
      const result = await listTasks(req.query, { tenantId: tenantFor(req) });
      return res.status(result.status).json(result.body);
    } catch {
      return res.status(503).json({ error: 'intake_unavailable', task_id: null });
    }
  });
  router.post('/', async (req, res) => {
    // 沿用 tasks 入口的服务器租户约定，body无权指定租户或路由字段。
    const tenantId = tenantFor(req);
    try {
      const result = await intake(req.body, { tenantId });
      return res.status(result.status).json(result.body);
    } catch {
      return res.status(503).json({ error: 'intake_unavailable', task_id: null });
    }
  });
  return router;
}

export default createTaskIntakeRouter();
