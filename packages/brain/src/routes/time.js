/**
 * Time Routes — 服务器时间查询
 *
 * GET /iso      — ISO 8601 字符串：{ iso: "2026-04-23T..." }
 * GET /unix     — 秒级整数 unix 时间戳：{ unix: <int> }
 * GET /timezone — 时区查询（?tz=Asia/Shanghai）：{ timezone, time }
 */

import { Router } from 'express';

const router = Router();

router.get('/iso', (_req, res) => {
  res.json({ iso: new Date().toISOString() });
});

router.get('/unix', (_req, res) => {
  res.json({ unix: Math.floor(Date.now() / 1000) });
});

router.get('/timezone', (req, res) => {
  const tz = typeof req.query.tz === 'string' && req.query.tz.length > 0
    ? req.query.tz
    : 'Asia/Shanghai';
  try {
    const time = new Date().toLocaleString('sv-SE', { timeZone: tz });
    return res.json({ timezone: tz, time });
  } catch (err) {
    return res.status(400).json({ error: `invalid timezone: ${tz}` });
  }
});

export default router;
