/**
 * Recurring Tasks × Notion 双向同步
 *
 * 功能：
 *   1. Notion → DB：从"定时任务"数据库拉取最新配置，upsert 到 recurring_tasks
 *   2. DB → Notion：执行结果（last_run_at, last_run_status）回写到 Notion
 *
 * 每日由 tick.js 触发一次（working_memory 门控）。
 */

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION  = '2022-06-28';

// Notion "定时任务" Database ID（由 Notion MCP 创建）
export const RECURRING_TASKS_NOTION_DB_ID = '1a6c98cd-012c-4136-8763-8b1b6c4485f8';

// ─── Notion API 工具 ──────────────────────────────────────────

function getToken() {
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error('NOTION_API_KEY 未配置');
  return token;
}

async function notionReq(token, path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(`${NOTION_API_BASE}${path}`, opts);
  const data = await res.json();

  if (!res.ok) {
    const err  = new Error(`Notion ${method} ${path} → ${res.status}: ${data.message}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function plainText(richText) {
  if (!Array.isArray(richText)) return '';
  return richText.map(t => t.plain_text || '').join('');
}

async function queryDB(token, dbId) {
  const pages = [];
  let cursor;
  while (true) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const resp = await notionReq(token, `/databases/${dbId}/query`, 'POST', body);
    pages.push(...resp.results);
    if (!resp.has_more) break;
    cursor = resp.next_cursor;
  }
  return pages;
}

// ─── 解析 Notion Page → recurring_tasks 行 ───────────────────

function parseNotionPage(page) {
  const props = page.properties || {};

  const name        = plainText(props['名称']?.title);
  const cron        = plainText(props['cron']?.rich_text);
  const executor    = props['执行者']?.select?.name?.toLowerCase() || 'cecelia';
  const project     = plainText(props['所属项目']?.rich_text);
  const description = plainText(props['任务描述']?.rich_text);
  const isActive    = props['激活']?.checkbox ?? true;

  return {
    notion_page_id: page.id,
    title:          name || '未命名定时任务',
    cron_expression: cron || null,
    executor,
    description,
    project_name:   project || null,
    is_active:      isActive,
    recurrence_type: deriveCronType(cron),
  };
}

/** 根据 cron 表达式推断 recurrence_type */
function deriveCronType(cron) {
  if (!cron) return 'cron';
  const lc = cron.toLowerCase().trim();
  if (lc === 'daily') return 'daily';
  if (lc === 'weekly') return 'weekly';
  // 纯数字 → interval (minutes)
  if (/^\d+$/.test(lc)) return 'interval';
  return 'cron';
}

// ─── 主同步函数 ───────────────────────────────────────────────

/**
 * Notion → DB 同步
 * 每日执行一次，由 tick.js 通过 working_memory 门控调用。
 *
 * @param {import('pg').Pool} pool
 */
export async function syncRecurringFromNotion(pool) {
  const token = getToken();
  console.log('[recurring-notion-sync] 开始从 Notion 拉取定时任务...');

  const pages = await queryDB(token, RECURRING_TASKS_NOTION_DB_ID);
  console.log(`[recurring-notion-sync] Notion 中共 ${pages.length} 个定时任务`);

  let upserted = 0;
  for (const page of pages) {
    const row = parseNotionPage(page);

    // 用 notion_page_id 查找已有记录（partial unique index 不支持 ON CONFLICT 简写）
    const existing = await pool.query(
      'SELECT id FROM recurring_tasks WHERE notion_page_id = $1',
      [row.notion_page_id]
    );

    if (existing.rows.length > 0) {
      await pool.query(`
        UPDATE recurring_tasks SET
          title           = $1,
          description     = $2,
          cron_expression = $3,
          executor        = $4,
          is_active       = $5,
          recurrence_type = $6
        WHERE notion_page_id = $7
      `, [
        row.title, row.description, row.cron_expression,
        row.executor, row.is_active, row.recurrence_type,
        row.notion_page_id,
      ]);
    } else {
      await pool.query(`
        INSERT INTO recurring_tasks (
          notion_page_id, title, description, cron_expression,
          executor, is_active, recurrence_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        row.notion_page_id, row.title, row.description, row.cron_expression,
        row.executor, row.is_active, row.recurrence_type,
      ]);
    }
    upserted++;
  }

  console.log(`[recurring-notion-sync] 同步完成，upserted=${upserted}`);
  return { synced: upserted };
}

/**
 * 回写执行结果到 Notion
 *
 * @param {import('pg').Pool} pool
 * @param {string} recurringTaskId  recurring_tasks.id
 * @param {'成功'|'失败'|'运行中'} status
 */
export async function writeBackRunResult(pool, recurringTaskId, status) {
  // 查询 notion_page_id
  const res = await pool.query(
    'SELECT notion_page_id, last_run_at FROM recurring_tasks WHERE id = $1',
    [recurringTaskId]
  );
  if (!res.rows.length) return;

  const { notion_page_id, last_run_at } = res.rows[0];
  if (!notion_page_id) return;

  const token = getToken();
  const lastRunAt = last_run_at ? new Date(last_run_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

  await notionReq(token, `/pages/${notion_page_id}`, 'PATCH', {
    properties: {
      '上次运行': {
        date: { start: lastRunAt },
      },
      '上次结果': {
        select: { name: status },
      },
    },
  });

  console.log(`[recurring-notion-sync] 回写 Notion page=${notion_page_id}, status=${status}`);
}
