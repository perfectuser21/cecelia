import { Router } from 'express';

const router = Router();

/**
 * GET /api/brain/time/iso
 * 返回当前 ISO 8601 字符串
 */
router.get('/iso', (_req, res) => {
  res.json({ iso: new Date().toISOString() });
});

/**
 * GET /api/brain/time/unix
 * 返回当前 Unix 秒级时间戳（整数）
 */
router.get('/unix', (_req, res) => {
  res.json({ unix: Math.floor(Date.now() / 1000) });
});

/**
 * GET /api/brain/time/timezone
 * Query: tz (可选) — IANA 时区标识；不传则回落到 process.env.TZ 或系统默认
 * 非法 tz → HTTP 400
 */
router.get('/timezone', (req, res) => {
  const requested = typeof req.query.tz === 'string' && req.query.tz.length > 0
    ? req.query.tz
    : null;

  const resolved = requested
    || process.env.TZ
    || Intl.DateTimeFormat().resolvedOptions().timeZone;

  try {
    // 非法 tz 会抛 RangeError
    new Intl.DateTimeFormat('en-US', { timeZone: resolved });
  } catch (err) {
    return res.status(400).json({
      error: 'invalid timezone',
      timezone: resolved,
      details: err.message,
    });
  }

  res.json({ timezone: resolved });
});

export default router;
