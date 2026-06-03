import { Router } from 'express';

const router = Router();

router.get('/echo', (req, res) => {
  const msg = req.query.msg !== undefined ? String(req.query.msg) : null;
  res.json({ ok: true, echo: msg === null ? null : msg });
});

export default router;
