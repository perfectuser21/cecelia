/**
 * KV Routes — working_memory 轻量键值存取
 *
 * GET  /api/brain/kv/:key  → { key, value, updated_at } 或 404
 * POST /api/brain/kv/:key  → upsert value_json，返回 { ok, updated_at }
 *
 * 供七环巡检、ci-patrol 等脚本存取审计结果快照。
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/:key', async (req, res) => {
  const { key } = req.params;
  try {
    // 兼容旧 app 级路由的取键约定（URL 连字符 → DB 下划线，如 seven-ring-audit-last
    // → seven_ring_audit_last）：先按原样查，未命中再查下划线变体
    let result = await pool.query(
      'SELECT key, value_json, updated_at FROM working_memory WHERE key = $1',
      [key]
    );
    if (!result.rows.length && key.includes('-')) {
      result = await pool.query(
        'SELECT key, value_json, updated_at FROM working_memory WHERE key = $1',
        [key.replace(/-/g, '_')]
      );
    }
    if (!result.rows.length) {
      return res.status(404).json({ error: 'not_found', key });
    }
    const row = result.rows[0];
    res.json({ key: row.key, value: row.value_json, updated_at: row.updated_at });
  } catch (err) {
    console.error('[kv] GET failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:key', async (req, res) => {
  const { key } = req.params;
  const value = req.body;
  if (value === undefined || value === null) {
    return res.status(400).json({ error: 'body required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ($1, $2::jsonb, NOW())
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
