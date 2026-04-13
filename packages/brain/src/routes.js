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
import capacityBudgetRouter from './routes/capacity-budget.js';
import registryRouter from './routes/registry.js';
import contentPipelineRouter from './routes/content-pipeline.js';
import contentLibraryRouter from './routes/content-library.js';
import socialTrendingRouter from './routes/social-trending.js';
import topicsRouter from './routes/topics.js';
import llmServiceRouter from './routes/llm-service.js';
import harnessRouter from './routes/harness.js';
import kr3Router from './routes/kr3.js';

export { triggerAutoRCA } from './routes/brain-meta.js';
export { resolveRelatedFailureMemories } from './routes/shared.js';

const router = Router();
for (const subRouter of [statusRouter, tasksRouter, tickRouter, actionsRouter, executionRouter, goalsRouter, analyticsRouter, brainMetaRouter, opsRouter, publishResultsRouter, publishJobsRouter, capacityBudgetRouter]) {
  router.stack.push(...subRouter.stack);
}

// 系统注册表 — 全局目录，解决孤岛和重复问题
router.use('/registry', registryRouter);

// 内容 pipeline — GET /pipelines/:id/stats 等路由
router.use('/pipelines', contentPipelineRouter);

// 内容库 — GET /content-library / PATCH /content-library/:id/review
router.use('/content-library', contentLibraryRouter);

// 社媒热点 — GET /social/trending
router.use('/social', socialTrendingRouter);

// 内容选题候选库 — GET /topics
router.use('/topics', topicsRouter);

// LLM 服务 — POST /llm/call（供外部系统如 zenithjoy 调用）
router.use('/llm', llmServiceRouter);

// Harness 可视化 — GET /harness/pipeline-detail, GET /harness/pipeline/:id
router.use('/harness', harnessRouter);

// KR3 小程序配置状态 — GET /kr3/check-config, POST /kr3/mark-wx-pay, POST /kr3/mark-admin-oid
router.use('/kr3', kr3Router);

export default router;
