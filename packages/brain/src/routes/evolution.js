/**
 * routes/evolution.js — 进化日志 API
 *
 * GET  /api/brain/evolution/records        — 查询原始记录
 * POST /api/brain/evolution/record         — 写入原始记录
 * GET  /api/brain/evolution/summaries      — 查询合成叙事
 * POST /api/brain/evolution/synthesize     — 手动触发合成
 */

import { Router } from 'express';
import pool from '../db.js';
import { recordEvolution, runEvolutionSynthesis } from '../evolution-synthesizer.js';

const router = Router();

// GET /api/brain/evolution/records
router.get('/records', async (req, res) => {
  try {
    const { component, limit = 50, offset = 0 } = req.query;
    let query = `SELECT * FROM component_evolutions`;
    const params = [];
    if (component) {
      params.push(component);
      query += ` WHERE component = $${params.length}`;
    }
    query += ` ORDER BY date DESC, created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Number(limit), Number(offset));

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('[evolution] GET /records error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/evolution/record
router.post('/record', async (req, res) => {
  try {
    const { component, prNumber, title, significance, summary, changedFiles, version } = req.body;
    if (!component || !title) {
      return res.status(400).json({ error: 'component and title are required' });
    }
    const row = await recordEvolution({ component, prNumber, title, significance, summary, changedFiles, version });
    res.json({ ok: true, id: row.id });
  } catch (err) {
    console.error('[evolution] POST /record error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/evolution/summaries
router.get('/summaries', async (req, res) => {
  try {
    const { component, limit = 20 } = req.query;
    let query = `SELECT * FROM component_evolution_summaries`;
    const params = [];
    if (component) {
      params.push(component);
      query += ` WHERE component = $${params.length}`;
    }
    query += ` ORDER BY period_end DESC LIMIT $${params.length + 1}`;
    params.push(Number(limit));

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('[evolution] GET /summaries error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/evolution/synthesize
router.post('/synthesize', async (req, res) => {
  try {
    const { dry_run } = req.body || {};
    if (dry_run) {
      return res.json({ ok: true, dry_run: true, message: '试运行模式，未实际合成' });
    }
    const result = await runEvolutionSynthesis(pool);
    res.json(result);
  } catch (err) {
    console.error('[evolution] POST /synthesize error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
