/**
 * Notion Sync Routes
 *
 * GET  /api/brain/notion-sync/status  → 上次同步状态
 * POST /api/brain/notion-sync/run     → 立即触发双向同步
 */

import { Router } from 'express';
import pool from '../db.js';
import { runSync, getNotionConfig } from '../notion-sync.js';

const router = Router();

/**
 * GET /status
 * 返回最近同步记录 + 当前配置状态
 */
router.get('/status', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        started_at,
        completed_at,
        direction,
        records_synced,
        records_failed,
        error_message,
        details
      FROM notion_sync_log
      ORDER BY started_at DESC
      LIMIT 10
    `);

    let configStatus = 'ok';
    let configError = null;
    try {
      getNotionConfig();
    } catch (err) {
      configStatus = 'missing';
      configError = err.message;
    }

    res.json({
      config: { status: configStatus, error: configError },
      recent_syncs: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /run
 * 触发双向同步
 */
router.post('/run', async (_req, res) => {
  try {
    // 检查配置（提前返回 503 而不是 500）
    try {
      getNotionConfig();
    } catch (err) {
      return res.status(503).json({
        error: 'Notion 未配置',
        detail: err.message,
        hint: '请设置 NOTION_API_KEY 和 NOTION_KNOWLEDGE_DB_ID 环境变量',
      });
    }

    const result = await runSync();
    res.json({
      success: true,
      fromNotion: result.fromNotion,
      toNotion: result.toNotion,
    });
  } catch (err) {
    // 区分 Notion API 错误（401/403）和内部错误
    if (err.status === 401 || err.status === 403) {
      return res.status(503).json({
        error: 'Notion API Token 无效或已过期',
        detail: err.message,
        hint: '请更新 ~/.credentials/notion.env 中的 NOTION_API_KEY',
      });
    }
    console.error('[notion-sync/run]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
