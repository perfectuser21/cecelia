/**
 * Brain Manifest 路由
 *
 * GET /api/brain/manifest
 *   返回：5 块意识架构注册表（静态，模块声明）
 *   前端用于构建 Level 1 概览视图，无需改前端即可新增模块
 */

/* global console */

import { Router } from 'express';
import { BRAIN_MANIFEST } from '../brain-manifest.js';

const router = Router();

router.get('/', (_req, res) => {
  try {
    res.json(BRAIN_MANIFEST);
  } catch (err) {
    console.error('[API] brain-manifest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
