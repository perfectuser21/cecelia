import { Router } from 'express';

const router = Router();

router.get('/iso', (_req, res) => {
  res.json({ iso: new Date().toISOString() });
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
