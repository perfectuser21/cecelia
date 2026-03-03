/**
 * Notion Sync Routes
 *
 * GET  /api/brain/notion-sync/status  → 上次同步状态
 * POST /api/brain/notion-sync/run     → 立即触发双向同步
 */

import { Router } from 'express';
import pool from '../db.js';
import { runSync, getNotionConfig } from '../notion-sync.js';
import { runFullSync, handleWebhook, NOTION_DB_IDS } from '../notion-full-sync.js';

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

/**
 * POST /webhook
 * 接收 Notion Webhook 回调（页面创建/更新/删除）
 * Notion 配置：cecelia.zenjoymedia.media/api/brain/notion-sync/webhook
 */
router.post('/webhook', async (req, res) => {
  // Notion URL 验证握手（发送 challenge 时必须原样回传）
  if (req.body?.challenge) {
    console.log('[notion-webhook] URL verification challenge received');
    return res.json({ challenge: req.body.challenge });
  }

  // 立即返回 200，异步处理（Notion 要求 <10s 响应）
  res.json({ received: true });

  try {
    const result = await handleWebhook(req.body);
    console.log('[notion-webhook]', JSON.stringify(result));
  } catch (err) {
    console.error('[notion-webhook] 处理失败:', err.message);
  }
});

/**
 * POST /full-sync
 * 触发四表全量同步（Areas/Goals/Projects/Tasks）
 */
router.post('/full-sync', async (_req, res) => {
  try {
    const token = process.env.NOTION_API_KEY;
    if (!token) {
      return res.status(503).json({ error: 'NOTION_API_KEY 未配置' });
    }
    const stats = await runFullSync();
    res.json({ success: true, stats });
  } catch (err) {
    console.error('[notion-sync/full-sync]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /full-status
 * 四表同步状态（各表 notion_id 覆盖率）
 */
router.get('/full-status', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 'areas'    AS tbl, COUNT(*) total, COUNT(notion_id) synced FROM areas    UNION ALL
      SELECT 'goals',          COUNT(*),        COUNT(notion_id)        FROM goals    UNION ALL
      SELECT 'projects',       COUNT(*),        COUNT(notion_id)        FROM projects UNION ALL
      SELECT 'tasks',          COUNT(*),        COUNT(notion_id)        FROM tasks
    `);
    res.json({
      notion_db_ids: NOTION_DB_IDS,
      tables: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
