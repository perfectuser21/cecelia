import { Router } from 'express';
import statusRouter from './routes/status.js';
import tasksRouter from './routes/tasks.js';
import tickRouter from './routes/tick.js';
import actionsRouter from './routes/actions.js';
import executionRouter from './routes/execution.js';
import goalsRouter from './routes/goals.js';
import analyticsRouter from './routes/analytics.js';
import brainMetaRouter from './routes/brain-meta.js';
import opsRouter from './routes/ops.js';
import publishResultsRouter from './routes/publish-results.js';
import publishJobsRouter from './routes/publish-jobs.js';

export { triggerAutoRCA } from './routes/brain-meta.js';
export { resolveRelatedFailureMemories } from './routes/shared.js';

const router = Router();
for (const subRouter of [statusRouter, tasksRouter, tickRouter, actionsRouter, executionRouter, goalsRouter, analyticsRouter, brainMetaRouter, opsRouter, publishResultsRouter, publishJobsRouter]) {
  router.stack.push(...subRouter.stack);
}
export default router;
