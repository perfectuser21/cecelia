import { Router } from 'express';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { createCommonRunnerDispatcher } from '../lib/common-runner-dispatch.js';

export function createCommonRunnerRouter({ pool, dispatcher, authenticate = internalAuthOrLoopback, ...options } = {}) {
  const router = Router();
  const runtime = dispatcher ?? createCommonRunnerDispatcher({ pool, ...options });
  router.use(authenticate);
  for (const action of ['start', 'inspect', 'cancel', 'flush']) {
    router.post(`/:run_id/${action}`, async (req, res) => {
      try {
        const result = await runtime.dispatch(action, req.params.run_id, req.body);
        res.status(result.status === 'unknown' ? 202 : 200).json(result);
      } catch (error) {
        const safe = /^common_runner_[a-z0-9_]+$/.test(error.message);
        res.status(error.status ?? (safe ? 409 : 503)).json({ error: safe ? error.message : 'common_runner_operation_unavailable' });
      }
    });
  }
  return router;
}
