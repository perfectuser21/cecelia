/**
 * Notion Sync Routes
 *
 * GET  /api/brain/notion-sync/status  → 上次同步状态
 * POST /api/brain/notion-sync/run     → 立即触发双向同步
 */

import { Router } from 'express';
import pool from '../db.js';
import { runSync, getNotionConfig } from '../notion-sync.js';
import { runFullSync, handleWebhook, NOTION_DB_IDS, pushAllToNotion } from '../notion-full-sync.js';
import { rebuildMemoryDatabases, importAllMemoryData } from '../notion-memory-sync.js';

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
 * 触发双向同步 — [NOTION_SYNC_DISABLED] Brain 已回归本地 DB，此端点停用
 */
router.post('/run', (_req, res) => {
  return res.status(503).json({ disabled: true, message: 'Notion 同步已停用，Brain 回归本地 DB' });
});

/**
 * POST /webhook
 * 接收 Notion Webhook 回调 — [NOTION_SYNC_DISABLED] Brain 已回归本地 DB，此端点停用
 */
router.post('/webhook', (_req, res) => {
  return res.status(503).json({ disabled: true, message: 'Notion 同步已停用，Brain 回归本地 DB' });
});

/**
 * POST /full-sync
 * 触发四表全量同步 — [NOTION_SYNC_DISABLED] Brain 已回归本地 DB，此端点停用
 */
router.post('/full-sync', (_req, res) => {
  return res.status(503).json({ disabled: true, message: 'Notion 同步已停用，Brain 回归本地 DB' });
});

/**
 * GET /full-status
 * 四表同步状态（各表 notion_id 覆盖率）
 */
router.get('/full-status', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 'areas'            AS tbl, COUNT(*) total, COUNT(notion_id) synced FROM areas          UNION ALL
      SELECT 'visions',                 COUNT(*),        0                       FROM visions        UNION ALL
      SELECT 'objectives',              COUNT(*),        0                       FROM objectives     UNION ALL
      SELECT 'key_results',             COUNT(*),        0                       FROM key_results    UNION ALL
      SELECT 'okr_projects',            COUNT(*),        0                       FROM okr_projects   UNION ALL
      SELECT 'okr_scopes',              COUNT(*),        0                       FROM okr_scopes     UNION ALL
      SELECT 'okr_initiatives',         COUNT(*),        0                       FROM okr_initiatives UNION ALL
      SELECT 'tasks',                   COUNT(*),        COUNT(notion_id)        FROM tasks
    `);
    res.json({
      notion_db_ids: NOTION_DB_IDS,
      tables: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /memory-rebuild
 * 重建 Memory 数据库 — [NOTION_SYNC_DISABLED] Brain 已回归本地 DB，此端点停用
 */
router.post('/memory-rebuild', (_req, res) => {
  return res.status(503).json({ disabled: true, message: 'Notion 同步已停用，Brain 回归本地 DB' });
});

/**
 * POST /memory-sync
 * 增量同步 Memory — [NOTION_SYNC_DISABLED] Brain 已回归本地 DB，此端点停用
 */
router.post('/memory-sync', (_req, res) => {
  return res.status(503).json({ disabled: true, message: 'Notion 同步已停用，Brain 回归本地 DB' });
});

/**
 * POST /push-all
 * 批量推送 DB → Notion — [NOTION_SYNC_DISABLED] Brain 已回归本地 DB，此端点停用
 */
router.post('/push-all', (_req, res) => {
  return res.status(503).json({ disabled: true, message: 'Notion 同步已停用，Brain 回归本地 DB' });
});

export default router;
