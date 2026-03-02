/**
 * Brain Manifest 路由
 *
 * GET /api/brain/manifest
 *   返回：brain-manifest.generated.json（自动生成的模块注册表）
 *   前端用于构建 Level 1/2 视图，包含 allActions/allSignals/allSkills
 *
 * 数据来源：packages/brain/scripts/generate-manifest.mjs 自动生成
 */

/* global console, URL */

import { Router } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_PATH = join(__dirname, '../brain-manifest.generated.json');

const router = Router();

router.get('/', (_req, res) => {
  try {
    const raw = readFileSync(GENERATED_PATH, 'utf8');
    const manifest = JSON.parse(raw);
    res.json(manifest);
  } catch (err) {
    console.error('[API] brain-manifest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
