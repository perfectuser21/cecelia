/**
 * KV Route — working_memory 通用键值存取
 *
 * GET  /api/brain/kv/:key — 读取 working_memory 中指定 key 的 JSON 值
 *   有数据 → 200 { key, updated_at, ...value_json }
 *   无数据 → 404 { error: 'not found' }
 *   DB 异常 → 500
 *
 * POST /api/brain/kv/:key — upsert working_memory 中指定 key
 *   body 须为 JSON object → 200 { ok: true, key, updated_at }
 *   非 object body → 400
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/:key', async (req, res) => {
  const { key } = req.params;
  try {
    const result = await pool.query(
      'SELECT value_json, updated_at FROM working_memory WHERE key = $1',
      [key]
    );
    const row = result.rows[0];
    if (!row || !row.value_json) {
      return res.status(404).json({ error: 'not found' });
    }
    res.json({ key, updated_at: row.updated_at, ...row.value_json });
  } catch (err) {
    console.error('[kv] GET failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:key', async (req, res) => {
  const { key } = req.params;
  const value = req.body;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return res.status(400).json({ error: 'body 须为 JSON object' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO working_memory(key, value_json, updated_at)
       VALUES($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2::jsonb, updated_at = NOW()
       RETURNING updated_at`,
      [key, JSON.stringify(value)]
    );
    res.json({ ok: true, key, updated_at: result.rows[0]?.updated_at });
  } catch (err) {
    console.error('[kv] POST failed:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
