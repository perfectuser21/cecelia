/**
 * Notion ↔ Cecelia PostgreSQL 双向同步
 *
 * 两个方向：
 *  - syncFromNotion(): Notion Knowledge_Operational → knowledge + blocks 表
 *  - syncToNotion(): knowledge 新记录（notion_id=null）→ Notion 页面
 *  - runSync(): 编排两个方向，写入 notion_sync_log
 *
 * 环境变量：
 *  - NOTION_API_KEY: Notion API Token（必须）
 *  - NOTION_KNOWLEDGE_DB_ID: Knowledge_Operational 数据库 ID（必须）
 */

import pool from './db.js';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// ─── Notion API 工具函数 ──────────────────────────────────────

/**
 * 调用 Notion API
 */
async function notionRequest(token, path, method = 'GET', body = null) {
  const url = `${NOTION_API_BASE}${path}`;
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const data = await res.json();

  if (!res.ok) {
    const err = new Error(`Notion API ${method} ${path} → ${res.status}: ${data.message || 'Unknown error'}`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

/**
 * 提取 Notion rich_text 纯文本
 */
function richTextToPlain(richText) {
  if (!Array.isArray(richText)) return '';
  return richText.map(t => t.plain_text || '').join('');
}

/**
 * 分页获取 Notion 数据库所有页面
 */
async function listDatabasePages(token, dbId, filter = null) {
  const pages = [];
  let cursor = undefined;

  while (true) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    if (filter) body.filter = filter;

    const resp = await notionRequest(token, `/databases/${dbId}/query`, 'POST', body);
    pages.push(...resp.results);

    if (!resp.has_more) break;
    cursor = resp.next_cursor;
  }

  return pages;
}

/**
 * 分页获取页面所有 Block（只取第一层，不递归 child_page）
 */
async function listPageBlocks(token, pageId) {
  const blocks = [];
  let cursor = undefined;

  while (true) {
    let path = `/blocks/${pageId}/children?page_size=100`;
    if (cursor) path += `&start_cursor=${cursor}`;

    const resp = await notionRequest(token, path);
    blocks.push(...resp.results);

    if (!resp.has_more) break;
    cursor = resp.next_cursor;
  }

  return blocks;
}

// ─── Notion → DB 映射 ────────────────────────────────────────

/**
 * 将 Notion 页面属性映射到 knowledge 行数据
 */
function notionPageToKnowledgeRow(page, areaId) {
  const props = page.properties || {};

  const name =
    richTextToPlain(props.Name?.title) ||
    richTextToPlain(props.name?.title) ||
    '无标题';

  const type =
    props.Type?.select?.name ||
    props.type?.select?.name ||
    'insight';

  const status =
    props.Status?.select?.name ||
    props.status?.select?.name ||
    'active';

  const subArea =
    props['Sub Area']?.select?.name ||
    props.sub_area?.select?.name ||
    props.Category?.select?.name ||
    null;

  const version =
    richTextToPlain(props.Version?.rich_text) ||
    richTextToPlain(props.version?.rich_text) ||
    '1.0.0';

  return {
    notion_id: page.id,
    name,
    type,
    status,
    sub_area: subArea,
    version,
    area_id: areaId,
    notion_synced_at: new Date().toISOString(),
  };
}

/**
 * 将 Notion Block 映射到 DB blocks 行数据
 * 返回 null 表示跳过该 block 类型
 */
function notionBlockToDBRow(block, knowledgeId, orderIndex) {
  const type = block.type;
  const notion_id = block.id;

  switch (type) {
    case 'paragraph': {
      const text = richTextToPlain(block.paragraph?.rich_text);
      return { notion_id, parent_id: knowledgeId, parent_type: 'knowledge', type: 'paragraph', content: { text }, order_index: orderIndex };
    }
    case 'heading_1': {
      const text = richTextToPlain(block.heading_1?.rich_text);
      return { notion_id, parent_id: knowledgeId, parent_type: 'knowledge', type: 'heading', content: { level: 1, text }, order_index: orderIndex };
    }
    case 'heading_2': {
      const text = richTextToPlain(block.heading_2?.rich_text);
      return { notion_id, parent_id: knowledgeId, parent_type: 'knowledge', type: 'heading', content: { level: 2, text }, order_index: orderIndex };
    }
    case 'heading_3': {
      const text = richTextToPlain(block.heading_3?.rich_text);
      return { notion_id, parent_id: knowledgeId, parent_type: 'knowledge', type: 'heading', content: { level: 3, text }, order_index: orderIndex };
    }
    case 'bulleted_list_item': {
      const text = richTextToPlain(block.bulleted_list_item?.rich_text);
      return { notion_id, parent_id: knowledgeId, parent_type: 'knowledge', type: 'list_item', content: { text, ordered: false }, order_index: orderIndex };
    }
    case 'numbered_list_item': {
      const text = richTextToPlain(block.numbered_list_item?.rich_text);
      return { notion_id, parent_id: knowledgeId, parent_type: 'knowledge', type: 'list_item', content: { text, ordered: true }, order_index: orderIndex };
    }
    case 'code': {
      const text = richTextToPlain(block.code?.rich_text);
      const language = block.code?.language || 'plain text';
      return { notion_id, parent_id: knowledgeId, parent_type: 'knowledge', type: 'code', content: { text, language }, order_index: orderIndex };
    }
    case 'image': {
      const url = block.image?.external?.url || block.image?.file?.url || '';
      const caption = richTextToPlain(block.image?.caption);
      return { notion_id, parent_id: knowledgeId, parent_type: 'knowledge', type: 'image', content: { url, caption }, order_index: orderIndex };
    }
    case 'divider':
      return { notion_id, parent_id: knowledgeId, parent_type: 'knowledge', type: 'divider', content: {}, order_index: orderIndex };
    case 'quote': {
      const text = richTextToPlain(block.quote?.rich_text);
      return { notion_id, parent_id: knowledgeId, parent_type: 'knowledge', type: 'quote', content: { text }, order_index: orderIndex };
    }
    default:
      // 跳过 child_page, table_of_contents, callout 等复杂类型
      return null;
  }
}

// ─── 同步逻辑 ────────────────────────────────────────────────

/**
 * 获取 Notion 配置（env vars）
 * 返回 { token, dbId } 或抛出错误
 */
export function getNotionConfig() {
  const token = process.env.NOTION_API_KEY;
  const dbId = process.env.NOTION_KNOWLEDGE_DB_ID;

  if (!token) {
    const err = new Error('NOTION_API_KEY 未配置。请在 ~/.credentials/notion.env 中设置 NOTION_API_KEY');
    err.code = 'NOTION_CONFIG_MISSING';
    throw err;
  }
  if (!dbId) {
    const err = new Error('NOTION_KNOWLEDGE_DB_ID 未配置。请在 .env.docker 中设置 NOTION_KNOWLEDGE_DB_ID');
    err.code = 'NOTION_CONFIG_MISSING';
    throw err;
  }

  return { token, dbId };
}

/**
 * 查找或创建默认 area（用于归档 Notion 同步的 knowledge）
 */
async function resolveAreaId(client, areaName) {
  const { rows } = await client.query(
    `SELECT id FROM areas WHERE name = $1 LIMIT 1`,
    [areaName]
  );
  if (rows.length > 0) return rows[0].id;

  // area 不存在时创建（areas 表无 description 列，仅插入 name）
  const ins = await client.query(
    `INSERT INTO areas (name, created_at, updated_at)
     VALUES ($1, NOW(), NOW())
     RETURNING id`,
    [areaName]
  );
  return ins.rows[0].id;
}

/**
 * Notion → Cecelia 同步
 *
 * 策略：Notion 为权威源，覆盖本地数据
 * - 按 notion_id 判断是否已存在
 * - 存在：UPDATE knowledge
 * - 不存在：INSERT knowledge
 * - 对应 blocks：DELETE 旧块，INSERT 新块
 *
 * @param {object} config - { token, dbId }
 * @param {object} [poolOverride] - 用于测试时注入 mock pool
 * @returns {{ synced: number, failed: number, errors: string[] }}
 */
export async function syncFromNotion(config = null, poolOverride = null) {
  const { token, dbId } = config || getNotionConfig();
  const db = poolOverride || pool;
  const errors = [];
  let synced = 0;

  const pages = await listDatabasePages(token, dbId);

  for (const page of pages) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // 查找默认 area（"Notion" area，自动创建）
      const areaId = await resolveAreaId(client, 'Notion');

      const row = notionPageToKnowledgeRow(page, areaId);

      // Upsert knowledge 记录
      const upsertResult = await client.query(
        `INSERT INTO knowledge
           (notion_id, name, type, status, sub_area, version, area_id, notion_synced_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (notion_id) DO UPDATE SET
           name             = EXCLUDED.name,
           type             = EXCLUDED.type,
           status           = EXCLUDED.status,
           sub_area         = EXCLUDED.sub_area,
           version          = EXCLUDED.version,
           notion_synced_at = EXCLUDED.notion_synced_at,
           updated_at       = NOW()
         RETURNING id`,
        [row.notion_id, row.name, row.type, row.status, row.sub_area, row.version, row.area_id, row.notion_synced_at]
      );
      const knowledgeId = upsertResult.rows[0].id;

      // 删除旧 blocks，重新插入（幂等）
      await client.query(
        `DELETE FROM blocks WHERE parent_id = $1 AND parent_type = 'knowledge'`,
        [knowledgeId]
      );

      // 获取 Notion 页面正文 blocks
      const notionBlocks = await listPageBlocks(token, page.id);
      let orderIndex = 0;
      for (const nb of notionBlocks) {
        const dbRow = notionBlockToDBRow(nb, knowledgeId, orderIndex);
        if (!dbRow) continue; // 跳过不支持的 block 类型

        await client.query(
          `INSERT INTO blocks (notion_id, parent_id, parent_type, type, content, order_index, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          [dbRow.notion_id, dbRow.parent_id, dbRow.parent_type, dbRow.type,
           JSON.stringify(dbRow.content), dbRow.order_index]
        );
        orderIndex++;
      }

      await client.query('COMMIT');
      synced++;
    } catch (err) {
      await client.query('ROLLBACK');
      errors.push(`页面 ${page.id}: ${err.message}`);
    } finally {
      client.release();
    }
  }

  return { synced, failed: errors.length, errors };
}

/**
 * Cecelia → Notion 同步
 *
 * 只处理新记录（notion_id IS NULL）
 * - 创建 Notion 页面，设置标准属性
 * - 回写 knowledge.notion_id
 *
 * @param {object} config - { token, dbId }
 * @param {object} [poolOverride] - 用于测试时注入 mock pool
 * @returns {{ synced: number, failed: number, errors: string[] }}
 */
export async function syncToNotion(config = null, poolOverride = null) {
  const { token, dbId } = config || getNotionConfig();
  const db = poolOverride || pool;
  const errors = [];
  let synced = 0;

  // 查找需要同步到 Notion 的 knowledge 记录（notion_id 为空）
  const { rows: newRecords } = await db.query(
    `SELECT id, name, type, status, sub_area, version, content
     FROM knowledge
     WHERE notion_id IS NULL
     ORDER BY created_at ASC
     LIMIT 50`
  );

  for (const record of newRecords) {
    try {
      // 构造 Notion 页面属性
      const properties = {
        Name: {
          title: [{ text: { content: record.name || '无标题' } }],
        },
        Type: record.type
          ? { select: { name: record.type } }
          : undefined,
        Status: record.status
          ? { select: { name: record.status } }
          : undefined,
      };
      // 移除 undefined 属性
      Object.keys(properties).forEach(k => properties[k] === undefined && delete properties[k]);

      // 构造页面正文：把 content 文本放成 paragraph block
      const children = [];
      if (record.content) {
        // 按换行分割，每段一个 paragraph block（最多 2000 字符/块）
        const paragraphs = record.content.split('\n\n').filter(p => p.trim());
        for (const para of paragraphs.slice(0, 20)) {
          children.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: para.slice(0, 2000) } }],
            },
          });
        }
      }

      const newPage = await notionRequest(token, '/pages', 'POST', {
        parent: { database_id: dbId },
        properties,
        children: children.length > 0 ? children : undefined,
      });

      // 回写 notion_id 到 knowledge 表
      await db.query(
        `UPDATE knowledge SET notion_id = $1, notion_synced_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [newPage.id, record.id]
      );

      synced++;
    } catch (err) {
      errors.push(`knowledge ${record.id} (${record.name}): ${err.message}`);
    }
  }

  return { synced, failed: errors.length, errors };
}

/**
 * 编排双向同步，写入 notion_sync_log
 *
 * @param {object} [poolOverride] - 用于测试时注入 mock pool
 * @returns {{ fromNotion: object, toNotion: object }}
 */
export async function runSync(poolOverride = null) {
  const db = poolOverride || pool;
  const startedAt = new Date();
  let config;

  try {
    config = getNotionConfig();
  } catch (err) {
    // token 或 DB ID 未配置，记录日志后抛出
    await db.query(
      `INSERT INTO notion_sync_log (direction, error_message, completed_at)
       VALUES ('both', $1, NOW())`,
      [err.message]
    ).catch(() => {});
    throw err;
  }

  // 插入进行中记录
  const logResult = await db.query(
    `INSERT INTO notion_sync_log (direction, started_at)
     VALUES ('both', $1)
     RETURNING id`,
    [startedAt]
  );
  const logId = logResult.rows[0].id;

  let fromResult = { synced: 0, failed: 0, errors: [] };
  let toResult = { synced: 0, failed: 0, errors: [] };

  try {
    fromResult = await syncFromNotion(config, db);
    toResult = await syncToNotion(config, db);

    await db.query(
      `UPDATE notion_sync_log
       SET completed_at = NOW(),
           records_synced = $1,
           records_failed = $2,
           details = $3
       WHERE id = $4`,
      [
        fromResult.synced + toResult.synced,
        fromResult.failed + toResult.failed,
        JSON.stringify({ fromNotion: fromResult, toNotion: toResult }),
        logId,
      ]
    );
  } catch (err) {
    await db.query(
      `UPDATE notion_sync_log
       SET completed_at = NOW(),
           error_message = $1
       WHERE id = $2`,
      [err.message, logId]
    ).catch(() => {});
    throw err;
  }

  return { fromNotion: fromResult, toNotion: toResult };
}
