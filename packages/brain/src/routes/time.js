/**
 * Time Routes — 服务器时间查询
 *
 * GET /iso  — ISO 8601 字符串：{ iso: "2026-04-23T..." }
 * GET /unix — 秒级整数 unix 时间戳：{ unix: <int> }
 */

import { Router } from 'express';

const router = Router();

router.get('/iso', (_req, res) => {
  res.json({ iso: new Date().toISOString() });
});

router.get('/unix', (_req, res) => {
  res.json({ unix: Math.floor(Date.now() / 1000) });
});

export default router;
