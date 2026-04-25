import { Router } from 'express';
import { readFileSync } from 'fs';

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
);

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    uptime_seconds: process.uptime(),
    version: pkg.version,
  });
});

export default router;
