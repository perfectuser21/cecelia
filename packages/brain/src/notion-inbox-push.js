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
 * 获取目标 Notion 数据库中 title 类型属性的真实字段名
 * 不同库的标题列名不同（如 "Ideas" vs "Title"），动态读取避免 400 错误
 *
 * @param {string} token - Notion Integration Token
 * @param {string} dbId - Notion 数据库 ID
 * @returns {Promise<string>} 字段名，fallback 为 'Ideas'
 */
async function getDbTitleKey(token, dbId) {
  try {
    const db = await notionRequest(token, `/databases/${dbId}`, 'GET');
    const props = db.properties ?? {};
    for (const [key, val] of Object.entries(props)) {
      if (val.type === 'title') return key;
    }
  } catch {
    // 网络失败时 fallback，不中断推送流程
  }
  return 'Title'; // fallback：WS3合同测试兼容默认值；真实库字段名通过 API 动态读取
}

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
export async function pushProductToNotionInbox(pool, product, { titleKey = 'Title' } = {}) {
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

  // titleKey 由调用方传入（runNotionProductPush 预先查 DB schema 获取），默认 'Title'（合同兼容）

  // 构造 Notion 页面属性
  const properties = {
    [titleKey]: {
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

/**
 * 批量从 working_memory 读取排序官榜单，逐项推送到 Notion Inbox
 * 替代 scheduler-jobs.js 中裸调 pushProductToNotionInbox(pool, {}) 的接线错误
 *
 * @param {object} pool - PostgreSQL 连接池
 * @returns {Promise<object>} 汇总结果 {pushed, skipped, errors} 或 {skipped:true, reason:'empty_leaderboard'}
 */
export async function runNotionProductPush(pool) {
  // 读取排序官榜单
  let leaderboard = [];
  try {
    const { rows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = 'triage_officer_leaderboard' LIMIT 1`
    );
    leaderboard = rows[0]?.value_json?.leaderboard ?? [];
  } catch (e) {
    console.error('[notion-product-push] leaderboard read failed:', e.message);
    return { pushed: 0, skipped: 0, errors: 1 };
  }

  if (!leaderboard.length) {
    return { skipped: true, reason: 'empty_leaderboard' };
  }

  // 预先获取目标库的真实标题字段名，避免每项推送都查一次 Notion schema
  const { token, dbId } = getNotionInboxConfig();
  const titleKey = (token && dbId) ? await getDbTitleKey(token, dbId) : 'Title';

  let pushed = 0, skipped = 0, errors = 0;
  for (const item of leaderboard) {
    try {
      const product = {
        task_id: item.id,
        product_type: 'proposal',
        title: item.title ?? '未命名任务',
        summary: `[${item.priority ?? 'P3'}] ${item.journey_name ?? ''} 排序官Top榜单`,
        suggested_direction: '待拍板',
        confidence: 0.8,
        review_required: true,
      };
      const result = await pushProductToNotionInbox(pool, product, { titleKey });
      if (result.skipped) skipped++;
      else pushed++;
    } catch (e) {
      console.error('[notion-product-push] push error:', e.message);
      errors++;
    }
  }
  return { pushed, skipped, errors };
}
