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
import devReviewsRouter from './routes/dev-reviews.js';
import registryRouter from './routes/registry.js';
import machinesRouter from './routes/machines.js';
import skillsRouter from './routes/skills.js';
import contentPipelineRouter from './routes/content-pipeline.js';
import contentLibraryRouter from './routes/content-library.js';
import socialTrendingRouter from './routes/social-trending.js';
import topicsRouter from './routes/topics.js';
// llm-service 在 server.js 里以 /api/brain/llm-service 独立挂载（带 internalAuth 中间件）
import harnessRouter from './routes/harness.js';
import harnessSelftestRouter from './routes/harness-selftest.js';
import warroomRouter from './routes/warroom.js';
import kr3Router from './routes/kr3.js';
import handoffsRouter from './routes/handoffs.js';
import sentinelRouter from './routes/sentinel.js';
import dispatchRouter from './routes/dispatch.js';
import previewRouter from './routes/preview.js';
import kvRouter from './routes/kv.js';
import guardDrillRouter from './routes/guard-drill.js';
import releaseGateRouter from './routes/release-gate.js';
import opsPanoramaRouter from './routes/ops-panorama.js';
import codexSlotsRouter from './routes/codex-slots.js';

export { triggerAutoRCA } from './routes/brain-meta.js';
export { resolveRelatedFailureMemories } from './routes/shared.js';

const router = Router();
for (const subRouter of [statusRouter, tasksRouter, tickRouter, actionsRouter, executionRouter, goalsRouter, analyticsRouter, brainMetaRouter, opsRouter, publishResultsRouter, publishJobsRouter, capacityBudgetRouter, devReviewsRouter, harnessSelftestRouter]) {
  router.stack.push(...subRouter.stack);
}

// Skills 目录 — GET/POST/PATCH/DELETE /skills
router.use('/skills', skillsRouter);

// 系统注册表 — 全局目录，解决孤岛和重复问题
router.use('/registry', registryRouter);

// 机器拓扑 — 叠加 Tailscale 状态 + 冲突检测
router.use('/machines', machinesRouter);

// 内容 pipeline — GET /pipelines/:id/stats 等路由
router.use('/pipelines', contentPipelineRouter);

// 内容库 — GET /content-library / PATCH /content-library/:id/review
router.use('/content-library', contentLibraryRouter);

// 社媒热点 — GET /social/trending
router.use('/social', socialTrendingRouter);

// 内容选题候选库 — GET /topics
router.use('/topics', topicsRouter);

// Harness 可视化 — GET /harness/pipeline-detail, GET /harness/pipeline/:id
router.use('/harness', harnessRouter);

// 战情室统一 feed — GET /warroom/feed（聚合所有任务，按 Area/Group 分组）
router.use('/warroom', warroomRouter);

// KR3 小程序配置状态 — GET /kr3/check-config, POST /kr3/mark-wx-pay, POST /kr3/mark-admin-oid
router.use('/kr3', kr3Router);

// 交接单只读流 — GET /handoffs（warroom 接力史，relay-baton4 item1）
router.use('/handoffs', handoffsRouter);

// 调度哨兵健康 — GET /sentinel/health（warroom 哨兵灯，relay-baton4 item1）
router.use('/sentinel', sentinelRouter);

// dispatch 诊断 — GET /dispatch/recent, /dispatch/llm-capacity
router.use('/', dispatchRouter);


// 预览环境端口分配 — POST/GET /preview, DELETE /preview/:pr_number
router.use('/preview', previewRouter);

// 轻量键值存取 — GET/POST /kv/:key（working_memory 表，供七环巡检/ci-patrol 等脚本快照存取）
router.use('/kv', kvRouter);

// 月度守卫演习台账 — GET /guard-drill/status，POST /guard-drill/trigger
router.use('/guard-drill', guardDrillRouter);

// 发布准入查账 — GET /release-gate/:pathId（只读，POST/PUT/PATCH → 405）
router.use('/release-gate', releaseGateRouter);

// 执行全景面板 — GET /ops-panorama
router.use('/ops-panorama', opsPanoramaRouter);

// Codex Slot broker — the only company Codex credential issuer.
router.use('/codex-slots', codexSlotsRouter);

export default router;
