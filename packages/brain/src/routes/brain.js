import { Router } from 'express';

const router = Router();

router.get('/ping', (req, res) => {
  res.json({ pong: true, timestamp: new Date().toISOString() });
});

export default router;
