import { Router } from 'express';

const router = Router();

// GET /api/brain/harness-selftest — 只读自检探针
// 零数据库、零副作用、幂等：每次返回完全相同的固定 JSON。
// 仅用于 harness pipeline 端到端真验，不暴露任何动态运行时状态
// （version/timestamp/status 等一律不返回，顶层 keys 恰好 ["ok","service"]）。
router.get('/harness-selftest', (_req, res) => {
  res.json({ ok: true, service: 'harness' });
});

export default router;
