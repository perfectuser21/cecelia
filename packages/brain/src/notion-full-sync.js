/**
 * Notion ↔ Cecelia 四表双向同步
 *
 * 同步表：Areas / Goals / Projects / Tasks
 * 方向：
 *   - Notion → DB：webhook 触发或全量同步，Notion 为权威源
 *   - DB → Notion：AI 创建/更新记录后 fire-and-forget 推送
 *
 * 环境变量：
 *   NOTION_API_KEY            Notion Integration Token（必须）
 *   NOTION_KNOWLEDGE_DB_ID    Knowledge DB（已有，保留兼容）
 *
 * Notion DB IDs（硬编码，来自 CC_API 集成的工作区）：
 */

import pool from './db.js';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION  = '2022-06-28';

export const NOTION_DB_IDS = {
  areas:    'afaf229f-2b6f-49e6-b478-da8c6422de87',
  goals:    '4d71decf-c169-46ef-b603-d4e6baa5e228',
  projects: '2671de58-8506-4d64-bad7-23fae2737e74',
  tasks:    '54fe0d4c-f434-4e91-8bb0-e33967661c42',
};

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

function titleText(props, ...keys) {
  for (const k of keys) {
    const v = plainText(props[k]?.title);
    if (v) return v;
  }
  return '无标题';
}

async function queryDB(token, dbId, filter = null) {
  const pages = [];
  let cursor;
  while (true) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    if (filter)  body.filter = filter;
    const resp = await notionReq(token, `/databases/${dbId}/query`, 'POST', body);
    pages.push(...resp.results);
    if (!resp.has_more) break;
    cursor = resp.next_cursor;
  }
  return pages;
}

// ─── Notion → DB 解析器 ──────────────────────────────────────

/** 解析 Notion Area page → DB row */
function parseArea(page) {
  const p = page.properties || {};
  return {
    notion_id: page.id,
    name:      titleText(p, 'Name', 'name'),
    domain:    p.Domain?.select?.name || null,
    archived:  p.Archive?.checkbox || false,
  };
}

/** 解析 Notion Goal page → DB row */
function parseGoal(page) {
  const p = page.properties || {};
  const areaRelation = p.Area?.relation?.[0]?.id || null;

  // Status mapping: Notion status → DB status
  const notionStatus = p.Status?.status?.name || 'pending';
  const statusMap = {
    'Not Started': 'pending',
    'In Progress': 'in_progress',
    'Completed':   'completed',
  };

  return {
    notion_id:     page.id,
    title:         titleText(p, 'Name', 'name'),
    status:        statusMap[notionStatus] || 'pending',
    target_date:   p['Due Date']?.date?.start || null,
    notion_area_id: areaRelation,  // notion page id of related area
    archived:      p.Archive?.checkbox || false,
  };
}

/** 解析 Notion Project page → DB row */
export function parseProject(page) {
  const p = page.properties || {};

  const notionStatus = p.Status?.status?.name || 'pending';
  const statusMap = {
    'Inbox':       'pending',
    'Not Started': 'pending',
    'In Progress': 'in_progress',
    'On Hold':     'paused',
    'Discard':     'cancelled',
  };

  const priorityMap = {
    'Urgent': 'P0',
    'High':   'P1',
    'Medium': 'P2',
    'Low':    'P3',
  };

  return {
    notion_id:          page.id,
    name:               titleText(p, 'Name', 'name'),
    status:             statusMap[p.Status?.status?.name] || 'pending',
    priority:           priorityMap[p.Priority?.select?.name] || 'P2',
    deadline:           p['Due Date']?.date?.start || null,
    description:        plainText(p.Remark?.rich_text) || null,
    notion_parent_id:   p['Parent item']?.relation?.[0]?.id || null,
    notion_area_id:     p.Area?.relation?.[0]?.id || null,
    notion_goal_id:     p.Goals?.relation?.[0]?.id || null,
    archived:           p.Archive?.checkbox || false,
    execution_mode:     p['Execution Mode']?.select?.name?.toLowerCase() || null,
  };
}

/** 解析 Notion Task page → DB row */
function parseTask(page) {
  const p = page.properties || {};

  const statusMap = {
    'Inbox':       'queued',
    'Someday':     'queued',
    'Waiting':     'queued',
    'Delegated':   'in_progress',
    'Next Action': 'queued',
    'In Progress': 'in_progress',
    'Done':        'completed',
  };

  const priorityMap = {
    'Urgent': 'P0',
    'High':   'P1',
    'Medium': 'P2',
    'Low':    'P3',
  };

  return {
    notion_id:        page.id,
    title:            titleText(p, 'Name', 'name'),
    status:           statusMap[p.Status?.status?.name] || 'queued',
    priority:         priorityMap[p.Priority?.select?.name] || 'P2',
    description:      plainText(p.Description?.rich_text) || null,
    due_at:           p.PD?.date?.start || null,
    notion_project_id: p.Project?.relation?.[0]?.id || null,
    notion_goal_id:    p.Goal?.relation?.[0]?.id || null,
    notion_area_id:    p.Area?.relation?.[0]?.id || null,
    archived:          p.Archived?.checkbox || false,
  };
}

// ─── DB → Notion 构建器 ──────────────────────────────────────

function buildAreaProperties(row) {
  const props = {
    Name: { title: [{ text: { content: row.name || '无标题' } }] },
  };
  if (row.domain) props.Domain = { select: { name: row.domain } };
  if (row.archived != null) props.Archive = { checkbox: !!row.archived };
  return props;
}

function buildGoalProperties(row) {
  const statusMap = {
    pending:     'Not Started',
    in_progress: 'In Progress',
    completed:   'Completed',
  };
  const props = {
    Name:   { title: [{ text: { content: row.title || '无标题' } }] },
    Status: { status: { name: statusMap[row.status] || 'Not Started' } },
  };
  if (row.target_date) props['Due Date'] = { date: { start: row.target_date.toISOString?.().slice(0, 10) || String(row.target_date).slice(0, 10) } };
  if (row.archived != null) props.Archive = { checkbox: !!row.archived };
  return props;
}

function buildProjectProperties(row) {
  const statusMap = {
    pending:   'Not Started',
    in_progress: 'In Progress',
    paused:    'On Hold',
    cancelled: 'Discard',
    completed: 'In Progress',
  };
  const priorityMap = { P0: 'Urgent', P1: 'High', P2: 'Medium', P3: 'Low' };
  const props = {
    Name:     { title: [{ text: { content: row.name || '无标题' } }] },
    Status:   { status: { name: statusMap[row.status] || 'Not Started' } },
    Priority: { select: { name: priorityMap[row.priority] || 'Medium' } },
  };
  if (row.deadline)    props['Due Date'] = { date: { start: String(row.deadline).slice(0, 10) } };
  if (row.description) props.Remark = { rich_text: [{ text: { content: row.description.slice(0, 2000) } }] };
  if (row.archived != null) props.Archive = { checkbox: !!row.archived };
  return props;
}

function buildTaskProperties(row) {
  const statusMap = {
    queued:      'Next Action',
    in_progress: 'In Progress',
    completed:   'In Progress',  // Notion Tasks DB 无 Done option，保留 In Progress
    failed:      'Inbox',
  };
  const priorityMap = { P0: 'Urgent', P1: 'High', P2: 'Medium', P3: 'Low' };
  const props = {
    Name:     { title: [{ text: { content: row.title || '无标题' } }] },
    Status:   { status: { name: statusMap[row.status] || 'Inbox' } },
    Priority: { select: { name: priorityMap[row.priority] || 'Medium' } },
  };
  if (row.description) props.Description = { rich_text: [{ text: { content: row.description.slice(0, 2000) } }] };
  if (row.due_at)  props.PD = { date: { start: String(row.due_at).slice(0, 10) } };
  if (row.archived != null) props.Archived = { checkbox: !!row.archived };
  // AI Task flag
  props['AI Task'] = { checkbox: true };
  return props;
}

// ─── 核心：Notion → DB 写入 ──────────────────────────────────

async function upsertArea(client, data) {
  const { rows } = await client.query(
    `INSERT INTO areas (notion_id, name, domain, archived, notion_synced_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,NOW(),NOW(),NOW())
     ON CONFLICT (notion_id) DO UPDATE SET
       name=EXCLUDED.name, domain=EXCLUDED.domain,
       archived=EXCLUDED.archived, notion_synced_at=NOW(), updated_at=NOW()
     RETURNING id`,
    [data.notion_id, data.name, data.domain, data.archived]
  );
  return rows[0].id;
}

async function upsertGoal(client, data, areaDbId) {
  const { rows } = await client.query(
    `INSERT INTO goals (notion_id, title, status, target_date, area_id, type, notion_synced_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'kr',NOW(),NOW(),NOW())
     ON CONFLICT (notion_id) DO UPDATE SET
       title=EXCLUDED.title, status=EXCLUDED.status, target_date=EXCLUDED.target_date,
       area_id=COALESCE(EXCLUDED.area_id, goals.area_id),
       notion_synced_at=NOW(), updated_at=NOW()
     RETURNING id`,
    [data.notion_id, data.title, data.status, data.target_date || null, areaDbId]
  );
  return rows[0].id;
}

async function upsertProject(client, data, areaDbId, goalDbId) {
  const { rows } = await client.query(
    `INSERT INTO projects (notion_id, name, status, description, deadline, area_id, goal_id, execution_mode, notion_synced_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW(),NOW())
     ON CONFLICT (notion_id) DO UPDATE SET
       name=EXCLUDED.name, status=EXCLUDED.status, description=EXCLUDED.description,
       deadline=EXCLUDED.deadline,
       area_id=COALESCE(EXCLUDED.area_id, projects.area_id),
       goal_id=COALESCE(EXCLUDED.goal_id, projects.goal_id),
       execution_mode=EXCLUDED.execution_mode,
       notion_synced_at=NOW(), updated_at=NOW()
     RETURNING id`,
    [data.notion_id, data.name, data.status, data.description, data.deadline || null, areaDbId, goalDbId, data.execution_mode || null]
  );
  return rows[0].id;
}

async function upsertTask(client, data, projectDbId, areaDbId) {
  const { rows } = await client.query(
    `INSERT INTO tasks (notion_id, title, status, priority, description, due_at, project_id, area_id, task_type, notion_synced_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'notion_synced',NOW(),NOW(),NOW())
     ON CONFLICT (notion_id) DO UPDATE SET
       title=EXCLUDED.title, status=EXCLUDED.status, priority=EXCLUDED.priority,
       description=EXCLUDED.description, due_at=EXCLUDED.due_at,
       project_id=COALESCE(EXCLUDED.project_id, tasks.project_id),
       area_id=COALESCE(EXCLUDED.area_id, tasks.area_id),
       notion_synced_at=NOW(), updated_at=NOW()
     RETURNING id`,
    [data.notion_id, data.title, data.status, data.priority, data.description,
     data.due_at || null, projectDbId, areaDbId]
  );
  return rows[0].id;
}

/** 根据 notion page id 查找对应 DB id */
async function findDbIdByNotionId(db, table, notionId) {
  if (!notionId) return null;
  const { rows } = await db.query(
    `SELECT id FROM ${table} WHERE notion_id=$1 LIMIT 1`,
    [notionId]
  );
  return rows[0]?.id || null;
}

// ─── 核心：DB → Notion 推送 ──────────────────────────────────

/**
 * 把单条 DB 记录推送到 Notion（创建或更新页面）
 * @param {'area'|'goal'|'project'|'task'} table
 * @param {string} dbId  DB 主键 UUID
 * @param {object} [dbOverride]  测试注入
 */
export async function pushToNotion(table, dbId, dbOverride = null) {
  const token = getToken();
  const db    = dbOverride || pool;

  const tableMap = {
    area:    { sql: 'SELECT * FROM areas    WHERE id=$1', dbKey: 'areas',    buildProps: buildAreaProperties,    parse: 'notion_id' },
    goal:    { sql: 'SELECT * FROM goals    WHERE id=$1', dbKey: 'goals',    buildProps: buildGoalProperties,    parse: 'notion_id' },
    project: { sql: 'SELECT * FROM projects WHERE id=$1', dbKey: 'projects', buildProps: buildProjectProperties, parse: 'notion_id' },
    task:    { sql: 'SELECT * FROM tasks    WHERE id=$1', dbKey: 'tasks',    buildProps: buildTaskProperties,    parse: 'notion_id' },
  };

  const cfg = tableMap[table];
  if (!cfg) throw new Error(`未知表: ${table}`);

  const { rows } = await db.query(cfg.sql, [dbId]);
  if (!rows.length) throw new Error(`${table} ${dbId} 不存在`);
  const row = rows[0];

  const properties = cfg.buildProps(row);
  const notionDbId = NOTION_DB_IDS[`${table}s`];

  let notionPageId;
  if (row.notion_id) {
    // 已有 Notion 页面 → 更新
    await notionReq(token, `/pages/${row.notion_id}`, 'PATCH', { properties });
    notionPageId = row.notion_id;
  } else {
    // 新记录 → 创建 Notion 页面
    const page = await notionReq(token, '/pages', 'POST', {
      parent:     { database_id: notionDbId },
      properties,
    });
    notionPageId = page.id;
    // 回写 notion_id
    const idCol  = { area: 'areas', goal: 'goals', project: 'projects', task: 'tasks' }[table];
    await db.query(
      `UPDATE ${idCol} SET notion_id=$1, notion_synced_at=NOW(), updated_at=NOW() WHERE id=$2`,
      [notionPageId, dbId]
    );
  }

  return { notionPageId };
}

// ─── Webhook 处理 ─────────────────────────────────────────────

/**
 * 处理 Notion Webhook 回调
 * Notion 发送的事件格式：{ type, entity, data }
 *
 * @param {object} payload  Notion webhook body
 * @param {object} [dbOverride]
 */
export async function handleWebhook(payload, dbOverride = null) {
  const token = getToken();
  const db    = dbOverride || pool;

  const pageId = payload?.entity?.id || payload?.page?.id || payload?.id;
  if (!pageId) {
    return { skipped: true, reason: 'no page id in payload' };
  }

  // 拉取 Notion 页面最新数据
  let page;
  try {
    page = await notionReq(token, `/pages/${pageId}`);
  } catch (err) {
    if (err.status === 404) {
      // 页面被删除 → 软删除 DB 记录
      return await softDeleteByNotionId(db, pageId);
    }
    throw err;
  }

  // 根据父数据库判断是哪张表
  const parentDbId = page.parent?.database_id?.replace(/-/g, '');

  const dbIdMap = {
    [NOTION_DB_IDS.areas.replace(/-/g, '')]:    'area',
    [NOTION_DB_IDS.goals.replace(/-/g, '')]:    'goal',
    [NOTION_DB_IDS.projects.replace(/-/g, '')]: 'project',
    [NOTION_DB_IDS.tasks.replace(/-/g, '')]:    'task',
  };

  const tableType = dbIdMap[parentDbId];
  if (!tableType) {
    return { skipped: true, reason: `未知数据库: ${parentDbId}` };
  }

  return await syncPageToDb(db, tableType, page);
}

async function softDeleteByNotionId(db, notionId) {
  // 在四张表中查找并软删除（archived=true）
  const tables = [
    { table: 'areas',    archived: 'archived' },
    { table: 'goals',    archived: null },  // goals 无 archived 列，跳过
    { table: 'projects', archived: null },
    { table: 'tasks',    archived: null },
  ];
  for (const { table, archived } of tables) {
    if (!archived) continue;
    const res = await db.query(
      `UPDATE ${table} SET ${archived}=true, updated_at=NOW() WHERE notion_id=$1 RETURNING id`,
      [notionId]
    );
    if (res.rows.length) return { deleted: true, table, id: res.rows[0].id };
  }
  return { skipped: true, reason: 'record not found in any table' };
}

async function syncPageToDb(db, tableType, page) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    let dbId;
    if (tableType === 'area') {
      const data = parseArea(page);
      dbId = await upsertArea(client, data);

    } else if (tableType === 'goal') {
      const data = parseGoal(page);
      const areaDbId = await findDbIdByNotionId(db, 'areas', data.notion_area_id);
      dbId = await upsertGoal(client, data, areaDbId);

    } else if (tableType === 'project') {
      const data = parseProject(page);
      const areaDbId = await findDbIdByNotionId(db, 'areas',    data.notion_area_id);
      const goalDbId = await findDbIdByNotionId(db, 'goals',    data.notion_goal_id);
      dbId = await upsertProject(client, data, areaDbId, goalDbId);

    } else if (tableType === 'task') {
      const data = parseTask(page);
      const projectDbId = await findDbIdByNotionId(db, 'projects', data.notion_project_id);
      const areaDbId    = await findDbIdByNotionId(db, 'areas',    data.notion_area_id);
      dbId = await upsertTask(client, data, projectDbId, areaDbId);
    }

    await client.query('COMMIT');
    return { synced: true, table: tableType, dbId };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── 全量同步 ────────────────────────────────────────────────

/**
 * 全量双向同步（手动触发或定期运行）
 * 方向：Notion → DB（全量拉取覆盖）
 * 注意：DB → Notion 方向只推送 notion_id=null 的新记录
 */
export async function runFullSync(dbOverride = null) {
  const token = getToken();
  const db    = dbOverride || pool;
  const stats = { areas: 0, goals: 0, projects: 0, tasks: 0, errors: [] };

  // 1. 同步 Areas
  try {
    const pages = await queryDB(token, NOTION_DB_IDS.areas);
    for (const page of pages) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await upsertArea(client, parseArea(page));
        await client.query('COMMIT');
        stats.areas++;
      } catch (e) {
        await client.query('ROLLBACK');
        stats.errors.push(`area ${page.id}: ${e.message}`);
      } finally { client.release(); }
    }
  } catch (e) { stats.errors.push(`areas query: ${e.message}`); }

  // 2. 同步 Goals
  try {
    const pages = await queryDB(token, NOTION_DB_IDS.goals);
    for (const page of pages) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const data = parseGoal(page);
        const areaDbId = await findDbIdByNotionId(db, 'areas', data.notion_area_id);
        await upsertGoal(client, data, areaDbId);
        await client.query('COMMIT');
        stats.goals++;
      } catch (e) {
        await client.query('ROLLBACK');
        stats.errors.push(`goal ${page.id}: ${e.message}`);
      } finally { client.release(); }
    }
  } catch (e) { stats.errors.push(`goals query: ${e.message}`); }

  // 3. 同步 Projects
  try {
    const pages = await queryDB(token, NOTION_DB_IDS.projects);
    for (const page of pages) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const data = parseProject(page);
        const areaDbId = await findDbIdByNotionId(db, 'areas', data.notion_area_id);
        const goalDbId = await findDbIdByNotionId(db, 'goals', data.notion_goal_id);
        await upsertProject(client, data, areaDbId, goalDbId);
        await client.query('COMMIT');
        stats.projects++;
      } catch (e) {
        await client.query('ROLLBACK');
        stats.errors.push(`project ${page.id}: ${e.message}`);
      } finally { client.release(); }
    }
  } catch (e) { stats.errors.push(`projects query: ${e.message}`); }

  // 4. 同步 Tasks（只同步 AI Task=true 或有 Run ID 的，避免把你所有个人任务全灌进来）
  try {
    const filter = {
      or: [
        { property: 'AI Task', checkbox: { equals: true } },
        { property: 'Run ID', rich_text: { is_not_empty: true } },
      ],
    };
    const pages = await queryDB(token, NOTION_DB_IDS.tasks, filter);
    for (const page of pages) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const data = parseTask(page);
        const projectDbId = await findDbIdByNotionId(db, 'projects', data.notion_project_id);
        const areaDbId    = await findDbIdByNotionId(db, 'areas',    data.notion_area_id);
        await upsertTask(client, data, projectDbId, areaDbId);
        await client.query('COMMIT');
        stats.tasks++;
      } catch (e) {
        await client.query('ROLLBACK');
        stats.errors.push(`task ${page.id}: ${e.message}`);
      } finally { client.release(); }
    }
  } catch (e) { stats.errors.push(`tasks query: ${e.message}`); }

  // 5. DB → Notion：推送 notion_id=null 的 AI 任务
  try {
    const { rows } = await db.query(
      `SELECT id FROM tasks WHERE notion_id IS NULL AND task_type NOT IN ('notion_synced') ORDER BY created_at DESC LIMIT 20`
    );
    for (const { id } of rows) {
      try {
        await pushToNotion('task', id, db);
        stats.tasks++;
      } catch (e) {
        stats.errors.push(`push task ${id}: ${e.message}`);
      }
    }
  } catch (e) { stats.errors.push(`db→notion tasks: ${e.message}`); }

  return stats;
}

// ─── 全量推送 DB → Notion ─────────────────────────────────────

/**
 * 批量将 DB 数据推送到 Notion（DB → Notion 方向）
 * 推送范围：
 *   - Areas：所有无 notion_id 的记录
 *   - Goals：所有无 notion_id 的记录（含 area 关联）
 *   - Projects：仅 type='project'（不含 initiative）且无 notion_id 的记录
 *              （含 area/goal 关联 + execution_mode）
 *
 * 已推送过（有 notion_id）的记录不会重复推送。
 */
export async function pushAllToNotion(dbOverride = null) {
  const token = getToken();
  const db    = dbOverride || pool;

  const stats = {
    areas:    { pushed: 0, errors: [] },
    goals:    { pushed: 0, errors: [] },
    projects: { pushed: 0, errors: [] },
  };

  // 1. 推送未同步的 areas（无关联，直接复用 pushToNotion）
  try {
    const { rows: areas } = await db.query(
      `SELECT id FROM areas WHERE notion_id IS NULL`
    );
    for (const { id } of areas) {
      try {
        await pushToNotion('area', id, db);
        stats.areas.pushed++;
      } catch (e) {
        stats.areas.errors.push(`${id}: ${e.message}`);
      }
    }
  } catch (e) { stats.areas.errors.push(`query: ${e.message}`); }

  // 2. 推送未同步的 goals（含 area 关联）
  try {
    const { rows: goals } = await db.query(`
      SELECT g.id, g.title, g.status, g.target_date,
             a.notion_id AS area_notion_id
      FROM goals g
      LEFT JOIN areas a ON g.area_id = a.id
      WHERE g.notion_id IS NULL
    `);
    for (const row of goals) {
      try {
        const props = buildGoalProperties(row);
        if (row.area_notion_id) {
          props.Area = { relation: [{ id: row.area_notion_id }] };
        }
        const page = await notionReq(token, '/pages', 'POST', {
          parent:     { database_id: NOTION_DB_IDS.goals },
          properties: props,
        });
        await db.query(
          `UPDATE goals SET notion_id=$1, notion_synced_at=NOW(), updated_at=NOW() WHERE id=$2`,
          [page.id, row.id]
        );
        stats.goals.pushed++;
      } catch (e) {
        stats.goals.errors.push(`${row.id}: ${e.message}`);
      }
    }
  } catch (e) { stats.goals.errors.push(`query: ${e.message}`); }

  // 3. 推送未同步的 projects（仅 type='project'，含 area/goal 关联 + execution_mode）
  const executionModeMap = { cecelia: 'Cecelia', xx: 'XX' };
  try {
    const { rows: projects } = await db.query(`
      SELECT p.id, p.name, p.status, p.description,
             p.deadline, p.archived, p.execution_mode,
             a.notion_id AS area_notion_id,
             g.notion_id AS goal_notion_id
      FROM projects p
      LEFT JOIN areas a ON p.area_id = a.id
      LEFT JOIN goals g ON p.goal_id = g.id
      WHERE p.notion_id IS NULL AND p.type = 'project'
    `);
    for (const row of projects) {
      try {
        const props = buildProjectProperties(row);
        if (row.area_notion_id) props.Area  = { relation: [{ id: row.area_notion_id }] };
        if (row.goal_notion_id) props.Goals = { relation: [{ id: row.goal_notion_id }] };
        if (row.execution_mode && executionModeMap[row.execution_mode]) {
          props['Execution Mode'] = { select: { name: executionModeMap[row.execution_mode] } };
        }
        const page = await notionReq(token, '/pages', 'POST', {
          parent:     { database_id: NOTION_DB_IDS.projects },
          properties: props,
        });
        await db.query(
          `UPDATE projects SET notion_id=$1, notion_synced_at=NOW(), updated_at=NOW() WHERE id=$2`,
          [page.id, row.id]
        );
        stats.projects.pushed++;
      } catch (e) {
        stats.projects.errors.push(`${row.id}: ${e.message}`);
      }
    }
  } catch (e) { stats.projects.errors.push(`query: ${e.message}`); }

  return stats;
}
