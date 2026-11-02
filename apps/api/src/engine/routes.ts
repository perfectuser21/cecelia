/**
 * Engine API Routes
 * Base path: /api/engine
 */

import { Router } from 'express';

const router = Router();

/**
 * GET /api/engine/health
 * Health check endpoint
 */
// 明确回执避免旧客户端把已退役组件误报为运行故障。
router.get(['/health', '/info'], (_req, res) => res.status(410).json({
  success: false,
  status: 'retired',
  code: 'ENGINE_RETIRED',
  message: 'Engine 旧包已退役；开发守卫和工作树工具归属 scripts/dev。',
}));

export default router;
