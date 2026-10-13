import { Router, json } from 'express';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { receiveCommanderEvent } from '../lib/commander-v2-feedback.js';
export function createWorkflowCommanderRouter(pool) {
  const router = Router();
  router.post('/tasks/:task_id/events', internalAuthOrLoopback, json({ limit: '210kb' }), async (req, res) => {
    try { res.json(await receiveCommanderEvent(pool, req.params.task_id, req.body)); }
    catch (err) { res.status(err.status ?? 500).json({ error: err.message, code: err.code }); }
  });
  return router;
}
