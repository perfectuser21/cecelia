import { reconcileFailedCommander } from '../lib/commander-failure-reconcile.js';
import { Router, json } from 'express';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { receiveCommanderEvent } from '../lib/commander-v2-feedback.js';
function reconciliationAuth(req,res,next) {
  return internalAuthOrLoopback(req,res,()=>{
    const expected=process.env.CECELIA_INTERNAL_TOKEN;
    const auth=req.headers.authorization??'';
    const provided=auth.startsWith('Bearer ')?auth.slice(7).trim():String(req.headers['x-internal-token']??'').trim();
    req.commanderReconciliationPrincipal=expected&&provided===expected?'internal-token':'nonproduction-loopback';
    next();
  });
}
export function createWorkflowCommanderRouter(pool) {
  const router = Router();
  router.post('/tasks/:task_id/events', internalAuthOrLoopback, json({ limit: '210kb' }), async (req, res) => {
    try { res.json(await receiveCommanderEvent(pool, req.params.task_id, req.body)); }
    catch (err) { res.status(err.status ?? 500).json({ error: err.message, code: err.code }); }
  });
  router.post('/tasks/:task_id/reconcile-failed', reconciliationAuth, json({ limit: '4kb' }), async (req, res) => {
    try { res.json(await reconcileFailedCommander(pool, req.params.task_id, req.body, { principal: req.commanderReconciliationPrincipal })); }
    catch (err) { res.status(err.status ?? 503).json({ error: err.status ? err.message : 'failed reconciliation unavailable', code: err.code ?? 'COMMANDER_RECONCILIATION_UNAVAILABLE' }); }
  });
  return router;
}
