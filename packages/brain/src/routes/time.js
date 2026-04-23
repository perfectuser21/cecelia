import { Router } from 'express';

const router = Router();

router.get('/iso', (_req, res) => {
  res.json({ iso: new Date().toISOString() });
});

export default router;
