import { Router } from 'express';
import pool from '../db.js';
import { queryAttemptTelemetry } from '../orchestrator/attempt-telemetry.js';

const router = Router();

router.get('/echo', (req, res) => {
  const msg = req.query.msg !== undefined ? String(req.query.msg) : null;
  res.json({ ok: true, echo: msg === null ? null : msg });
});

router.get('/tasks/:task_id/attempt-telemetry', async (req, res) => {
  const tenantId = req.get('x-tenant-id');
  if (!tenantId) {
    return res.status(400).json({ error: 'x-tenant-id header is required' });
  }

  try {
    const telemetry = await queryAttemptTelemetry(req.app.get('pool') ?? pool, {
      taskId: req.params.task_id,
      tenantId,
      includeAttempts: req.query.include_attempts !== 'false',
    });
    return res.json(telemetry);
  } catch (error) {
    if (error?.code === 'telemetry_not_found') {
      return res.status(404).json({ error: 'telemetry_not_found' });
    }
    return res.status(500).json({ error: 'attempt_telemetry_query_failed' });
  }
});

export default router;
