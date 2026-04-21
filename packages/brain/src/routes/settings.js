/**
 * Settings API Routes
 *
 * Consciousness toggle endpoints:
 * - GET  /api/brain/settings/consciousness  — 返回当前开关状态
 * - PATCH /api/brain/settings/consciousness — 写 memory + write-through cache
 */

import { Router } from 'express';
import pool from '../db.js';
import { getConsciousnessStatus, setConsciousnessEnabled } from '../consciousness-guard.js';
import { getMutedStatus, setMuted } from '../muted-guard.js';

const router = Router();

router.get('/consciousness', (req, res) => {
  res.json(getConsciousnessStatus());
});

router.patch('/consciousness', async (req, res) => {
  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be boolean' });
  }
  try {
    const status = await setConsciousnessEnabled(pool, enabled);
    res.json(status);
  } catch (err) {
    console.error('[settings/consciousness] PATCH failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/muted', (req, res) => {
  res.json(getMutedStatus());
});

router.patch('/muted', async (req, res) => {
  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be boolean' });
  }
  try {
    const status = await setMuted(pool, enabled);
    res.json(status);
  } catch (err) {
    console.error('[settings/muted] PATCH failed:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
