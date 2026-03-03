/**
 * Alerting Routes
 *
 * GET  /api/brain/alerting/status       → 查看缓冲区状态
 * POST /api/brain/alerting/test?level=P0 → 触发测试报警
 * POST /api/brain/alerting/flush/p1    → 手动刷新 P1 缓冲区
 * POST /api/brain/alerting/flush/p2    → 手动刷新 P2 缓冲区
 */

import express from 'express';
import { raise, flushP1, flushP2, getStatus } from '../alerting.js';

const router = express.Router();

const VALID_LEVELS = ['P0', 'P1', 'P2', 'P3'];

/**
 * GET /api/brain/alerting/status
 * 返回当前各级别缓冲区数量
 */
router.get('/status', (_req, res) => {
  res.json(getStatus());
});

/**
 * POST /api/brain/alerting/test?level=P0
 * 触发一条测试报警
 */
router.post('/test', async (req, res) => {
  const level = req.query.level || 'P2';
  if (!VALID_LEVELS.includes(level)) {
    return res.status(400).json({ error: `无效级别 ${level}，请使用 P0/P1/P2/P3` });
  }
  await raise(level, 'alerting_test', `[测试] ${level} 报警来自 API 手动触发`);
  res.json({ ok: true, level, status: getStatus() });
});

/**
 * POST /api/brain/alerting/flush/p1
 * 手动立即发送 P1 缓冲区
 */
router.post('/flush/p1', async (_req, res) => {
  await flushP1();
  res.json({ ok: true, status: getStatus() });
});

/**
 * POST /api/brain/alerting/flush/p2
 * 手动立即发送 P2 缓冲区
 */
router.post('/flush/p2', async (_req, res) => {
  await flushP2();
  res.json({ ok: true, status: getStatus() });
});

export default router;
