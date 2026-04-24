import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'),
);

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    uptime_seconds: process.uptime(),
    version,
  });
});

export default router;
