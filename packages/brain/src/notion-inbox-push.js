/**
 * notion-inbox-push.js — WS3 成品呈报：推送排序官归并产物到 Notion Inbox
 *
 * FR-1：接受排序官归并产物对象，产物类型白名单 proposal/morning_summary/acceptance_receipt
 * 构造 Notion pages 属性（Title/AI摘要/建议去向/置信度/需拍板/产物类型/任务ID）
 * 推送后回写 Brain tasks.notion_page_id
 *
 * 幂等键前缀：notion:product:<task_id>:<product_type>
 *
 * 凭据（均从 process.env 读取）：
 *   NOTION_INBOX_TOKEN  — Notion Integration Token
 *   NOTION_INBOX_DB_ID  — 个人 Inbox 数据库 ID
 */

import { notionRequest, getNotionInboxConfig } from './notion-capture-ingest.js';

/** 产物类型白名单 */
const PRODUCT_TYPE_WHITELIST = ['proposal', 'morning_summary', 'acceptance_receipt'];

/**
 * 推送排序官归并产物到 Notion Inbox
 *
 * @param {object} pool - PostgreSQL 连接池
 * @param {object} product - 产物对象
 * @param {string} product.task_id - 任务 UUID
 * @param {string} product.product_type - 产物类型（白名单：proposal/morning_summary/acceptance_receipt）
 * @param {string} product.title - 标题
 * @param {string} product.summary - AI 摘要
 * @param {string} product.suggested_direction - 建议去向
 * @param {number} product.confidence - 置信度（0-1）
 * @param {boolean} product.review_required - 是否需要拍板
 * @returns {Promise<object>} 推送结果
 */
export async function pushProductToNotionInbox(pool, product) {
  const { token, dbId } = getNotionInboxConfig();

  // INV-6: 凭据缺失静默跳过
  if (!token || !dbId) {
    return { skipped: true, reason: 'not_configured', pushed: 0, errors: 0, notion_page_id: null };
  }

  const { task_id, product_type, title, summary, suggested_direction, confidence, review_required } = product;

  // 产物类型白名单校验
  if (!PRODUCT_TYPE_WHITELIST.includes(product_type)) {
    return { skipped: true, reason: 'invalid_product_type', pushed: 0, errors: 0, notion_page_id: null };
  }

  // INV-4: 幂等检查——查 captures 表 dedupe_key
  const dedupeKey = `notion:product:${task_id}:${product_type}`;
  const existing = await pool.query(
    `SELECT id, notion_page_id FROM captures WHERE dedupe_key = $1 LIMIT 1`,
    [dedupeKey]
  );

  if (existing.rows.length > 0) {
    return {
      skipped: true,
      reason: 'already_pushed',
      pushed: 0,
      errors: 0,
      notion_page_id: existing.rows[0].notion_page_id ?? null,
    };
  }

  // 构造 Notion 页面属性
  const properties = {
    Title: {
      title: [{ text: { content: title ?? '未命名产物' } }],
    },
    AI摘要: {
      rich_text: [{ text: { content: summary ?? '' } }],
    },
    建议去向: {
      rich_text: [{ text: { content: suggested_direction ?? '' } }],
    },
    置信度: {
      number: typeof confidence === 'number' ? confidence : null,
    },
    需拍板: {
      checkbox: !!review_required,
    },
    产物类型: {
      select: { name: product_type },
    },
    任务ID: {
      rich_text: [{ text: { content: task_id ?? '' } }],
    },
  };

  // 调用 Notion API 创建页面
  const page = await notionRequest(token, '/pages', 'POST', {
    parent: { database_id: dbId },
    properties,
  });

  const notionPageId = page?.id ?? null;

  // 回写 Brain tasks.notion_page_id
  if (task_id && notionPageId) {
    await pool.query(
      `UPDATE tasks SET notion_page_id = $1 WHERE id = $2`,
      [notionPageId, task_id]
    );
  }

  return {
    pushed: 1,
    skipped: 0,
    notion_page_id: notionPageId,
    errors: 0,
  };
}
