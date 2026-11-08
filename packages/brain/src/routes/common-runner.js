import {startDurableCommonRunner} from '../durable/common-runner-durable-client.js';
import { Router } from 'express';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { createCommonRunnerDispatcher } from '../lib/common-runner-dispatch.js';

export function createCommonRunnerRouter({ pool, dispatcher, authenticate = internalAuthOrLoopback, durableStart = startDurableCommonRunner, ...options } = {}) {
  const router = Router();
  const runtime = dispatcher ?? createCommonRunnerDispatcher({ pool, ...options });
  router.use(authenticate);
  for (const action of ['start', 'inspect', 'cancel', 'flush']) {
    router.post(`/:run_id/${action}`, async (req, res) => {
      try {
        if(action==='start'&&(options.env??process.env).DBOS_DURABLE_ENABLED==='true'){
          const durable=await durableStart({run_id:req.params.run_id,body:req.body,deadline_ms:Date.now()+3600000,poll_interval_ms:1000});
          return res.status(202).json({run_id:req.params.run_id,task_id:req.body.task_id,status:'accepted',durable_workflow_id:durable.workflow_id});
        }
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
