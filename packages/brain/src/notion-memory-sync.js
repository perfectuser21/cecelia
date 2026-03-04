/**
 * notion-memory-sync.js
 *
 * Notion Memory 系统同步：
 *  - 主人档案（user_profile_facts）↔ Notion "👤 主人档案"
 *  - 人脉网络（category=other）      ↔ Notion "👥 人脉网络"
 *  - Cecelia 日记（memory_stream）   → Notion "📖 Cecelia 日记"（只写）
 */

import pool from './db.js';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION  = '2022-06-28';

export const NOTION_MEMORY_DB_IDS = {
  ownerProfile: '31853f41-3ec5-810a-9188-f08bf7e9ab90',
  contacts:     '31853f41-3ec5-81c7-8571-c16198dd610b',
  diary:        '31853f41-3ec5-81e3-ac71-c09f0e69498d',
};

// ─── API 工具 ──────────────────────────────────────────────────

function getToken() {
  const t = process.env.NOTION_API_KEY;
  if (!t) throw new Error('NOTION_API_KEY 未配置');
  return t;
}

async function notionReq(path, method = 'GET', body = null) {
  const token = getToken();
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(`${NOTION_API_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(`Notion ${method} ${path} → ${res.status}: ${data.message}`);
  return data;
}

const fmtDate = d => (d instanceof Date ? d : new Date(d)).toISOString().split('T')[0];
const truncate = (s, n) => (String(s || '')).slice(0, n);

// ─── 重建数据库结构 ────────────────────────────────────────────

/**
 * 动态查找 DB 当前的 title 属性名
 */
async function getTitlePropName(dbId) {
  const db = await notionReq(`/databases/${dbId}`);
  for (const [name, prop] of Object.entries(db.properties || {})) {
    if (prop.type === 'title') return { name, existing: db.properties };
  }
  return { name: null, existing: db.properties || {} };
}

/**
 * 更新 3 个 Notion 数据库为正确结构
 * 策略：先 GET 获取当前 title 属性名，再 PATCH（只改名 + 只加缺失属性）
 * 不操作 Notion 内置属性（created_time 等）
 */
export async function rebuildMemoryDatabases() {
  const results = {};

  // ── 主人档案 —— Title=键, 值/类别/来源/更新时间 ──
  try {
    const { name: titleName, existing } = await getTitlePropName(NOTION_MEMORY_DB_IDS.ownerProfile);
    const patchProps = {};
    if (titleName && titleName !== '键') patchProps[titleName] = { name: '键' };
    if (!existing['值'])       patchProps['值']       = { rich_text: {} };
    if (!existing['类别'])     patchProps['类别']     = { select: { options: [] } };
    if (!existing['来源'])     patchProps['来源']     = { select: { options: [] } };
    if (!existing['更新时间']) patchProps['更新时间'] = { date: {} };
    await notionReq(`/databases/${NOTION_MEMORY_DB_IDS.ownerProfile}`, 'PATCH', {
      title: [{ text: { content: '👤 主人档案' } }],
      properties: patchProps,
    });
    results.ownerProfile = 'ok';
  } catch (e) {
    results.ownerProfile = e.message.slice(0, 100);
  }

  // ── 人脉网络 —— Title=姓名, 关系/联系方式/备注/来源/更新时间 ──
  try {
    const { name: titleName, existing } = await getTitlePropName(NOTION_MEMORY_DB_IDS.contacts);
    const patchProps = {};
    if (titleName && titleName !== '姓名') patchProps[titleName] = { name: '姓名' };
    if (!existing['关系'])     patchProps['关系']     = { select: { options: [
      { name: 'colleague', color: 'blue' },
      { name: 'friend',    color: 'green' },
      { name: 'family',    color: 'orange' },
      { name: 'client',    color: 'purple' },
      { name: 'other',     color: 'gray' },
    ]}};
    if (!existing['联系方式']) patchProps['联系方式'] = { rich_text: {} };
    if (!existing['备注'])     patchProps['备注']     = { rich_text: {} };
    if (!existing['来源'])     patchProps['来源']     = { select: { options: [] } };
    if (!existing['更新时间']) patchProps['更新时间'] = { date: {} };
    await notionReq(`/databases/${NOTION_MEMORY_DB_IDS.contacts}`, 'PATCH', {
      title: [{ text: { content: '👥 人脉网络' } }],
      properties: patchProps,
    });
    results.contacts = 'ok';
  } catch (e) {
    results.contacts = e.message.slice(0, 100);
  }

  // ── Cecelia 日记 —— Title=摘要, 类型/重要性/日期 ──
  try {
    const { name: titleName, existing } = await getTitlePropName(NOTION_MEMORY_DB_IDS.diary);
    const patchProps = {};
    if (titleName && titleName !== '摘要') patchProps[titleName] = { name: '摘要' };
    if (!existing['类型'])   patchProps['类型']   = { select: { options: [
      { name: 'episodic',   color: 'blue' },
      { name: 'reflection', color: 'purple' },
      { name: 'desire',     color: 'red' },
      { name: 'learning',   color: 'green' },
      { name: 'self_model', color: 'orange' },
    ]}};
    if (!existing['重要性']) patchProps['重要性'] = { number: { format: 'number' } };
    if (!existing['日期'])   patchProps['日期']   = { date: {} };
    await notionReq(`/databases/${NOTION_MEMORY_DB_IDS.diary}`, 'PATCH', {
      title: [{ text: { content: '📖 Cecelia 日记' } }],
      properties: patchProps,
    });
    results.diary = 'ok';
  } catch (e) {
    results.diary = e.message.slice(0, 100);
  }

  return results;
}

// ─── 归档现有条目 ──────────────────────────────────────────────

async function archiveAllPages(dbId) {
  let cursor;
  let count = 0;
  while (true) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const resp = await notionReq(`/databases/${dbId}/query`, 'POST', body);
    for (const page of resp.results) {
      if (!page.archived) {
        await notionReq(`/pages/${page.id}`, 'PATCH', { archived: true }).catch(() => {});
        count++;
      }
    }
    if (!resp.has_more) break;
    cursor = resp.next_cursor;
  }
  return count;
}

// ─── 全量导入 ──────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 全量导入：归档旧数据，重新从 PostgreSQL 导入
 */
export async function importAllMemoryData() {
  const stats = { ownerProfile: 0, contacts: 0, diary: 0, errors: 0 };

  // 主人档案（非 other 类别）
  await archiveAllPages(NOTION_MEMORY_DB_IDS.ownerProfile).catch(() => {});
  const facts = await pool.query(
    "SELECT id, category, content, COALESCE(key,'') as key, COALESCE(source,'manual') as source, created_at FROM user_profile_facts WHERE user_id='owner' AND category != 'other' ORDER BY created_at DESC"
  );
  for (const row of facts.rows) {
    try {
      const keyName = row.key || (row.content.split(':')[0] || '').trim() || '未命名';
      const value   = row.content.includes(':')
        ? row.content.split(':').slice(1).join(':').trim()
        : row.content;
      const page = await notionReq('/pages', 'POST', {
        parent:     { database_id: NOTION_MEMORY_DB_IDS.ownerProfile },
        properties: {
          '键':       { title:     [{ text: { content: truncate(keyName, 100) } }] },
          '值':       { rich_text: [{ text: { content: truncate(value,   2000) } }] },
          '类别':     { select:    { name: row.category } },
          '来源':     { select:    { name: row.source } },
          '更新时间': { date:      { start: fmtDate(row.created_at) } },
        },
      });
      await pool.query('UPDATE user_profile_facts SET notion_id=$1 WHERE id=$2', [page.id, row.id]);
      stats.ownerProfile++;
      await sleep(300);
    } catch (e) {
      stats.errors++;
      console.error(`[notion-memory] ownerProfile 导入失败 id=${row.id}: ${e.message}`);
    }
  }

  // 人脉网络（category=other）
  await archiveAllPages(NOTION_MEMORY_DB_IDS.contacts).catch(() => {});
  const contacts = await pool.query(
    "SELECT id, content, COALESCE(source,'import') as source, created_at FROM user_profile_facts WHERE user_id='owner' AND category='other' ORDER BY id DESC"
  );
  for (const row of contacts.rows) {
    try {
      const name = row.content.replace(/^姓名:\s*/, '').trim().slice(0, 100) || '未命名';
      const page = await notionReq('/pages', 'POST', {
        parent:     { database_id: NOTION_MEMORY_DB_IDS.contacts },
        properties: {
          '姓名':     { title:     [{ text: { content: name } }] },
          '备注':     { rich_text: [{ text: { content: truncate(row.content, 2000) } }] },
          '来源':     { select:    { name: row.source } },
          '更新时间': { date:      { start: fmtDate(row.created_at) } },
        },
      });
      await pool.query('UPDATE user_profile_facts SET notion_id=$1 WHERE id=$2', [page.id, row.id]);
      stats.contacts++;
      await sleep(300);
    } catch (e) {
      stats.errors++;
      console.error(`[notion-memory] contacts 导入失败 id=${row.id}: ${e.message}`);
    }
  }

  // Cecelia 日记（最近 50 条）
  await archiveAllPages(NOTION_MEMORY_DB_IDS.diary).catch(() => {});
  const diary = await pool.query(
    "SELECT id, source_type, content, importance, created_at FROM memory_stream WHERE content IS NOT NULL ORDER BY created_at DESC LIMIT 50"
  );
  const validTypes = ['episodic', 'reflection', 'desire', 'learning', 'self_model'];
  for (const row of diary.rows) {
    try {
      const txt     = typeof row.content === 'string' ? row.content : JSON.stringify(row.content);
      const summary = truncate(txt, 80);
      const typ     = validTypes.includes(row.source_type) ? row.source_type : 'episodic';
      const page = await notionReq('/pages', 'POST', {
        parent:     { database_id: NOTION_MEMORY_DB_IDS.diary },
        properties: {
          '摘要':   { title:  [{ text: { content: summary } }] },
          '类型':   { select: { name: typ } },
          '重要性': { number: row.importance || 0 },
          '日期':   { date:   { start: fmtDate(row.created_at) } },
        },
        children: [{
          object: 'block', type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: truncate(txt, 2000) } }] },
        }],
      });
      await pool.query('UPDATE memory_stream SET notion_id=$1 WHERE id=$2', [page.id, row.id]);
      stats.diary++;
      await sleep(300);
    } catch (e) {
      stats.errors++;
      console.error(`[notion-memory] diary 导入失败 id=${row.id}: ${e.message}`);
    }
  }

  return stats;
}

// ─── 增量推送（fire-and-forget）─────────────────────────────────

/**
 * 推送单条 user_profile_fact 到 Notion
 * 在 user-profile.js 保存 fact 后调用（不等待）
 */
export async function pushFactToNotion(row) {
  try {
    const isContact = row.category === 'other';
    const dbId = isContact ? NOTION_MEMORY_DB_IDS.contacts : NOTION_MEMORY_DB_IDS.ownerProfile;

    let page;
    if (isContact) {
      const name = (row.content || '').replace(/^姓名:\s*/, '').trim().slice(0, 100) || '未命名';
      page = await notionReq('/pages', 'POST', {
        parent:     { database_id: dbId },
        properties: {
          '姓名':     { title:     [{ text: { content: name } }] },
          '备注':     { rich_text: [{ text: { content: truncate(row.content, 2000) } }] },
          '来源':     { select:    { name: row.source || 'auto' } },
          '更新时间': { date:      { start: fmtDate(row.created_at || new Date()) } },
        },
      });
    } else {
      const keyName = row.key || (row.content || '').split(':')[0]?.trim() || '未命名';
      const value   = (row.content || '').includes(':')
        ? (row.content || '').split(':').slice(1).join(':').trim()
        : (row.content || '');
      page = await notionReq('/pages', 'POST', {
        parent:     { database_id: dbId },
        properties: {
          '键':       { title:     [{ text: { content: truncate(keyName, 100) } }] },
          '值':       { rich_text: [{ text: { content: truncate(value,   2000) } }] },
          '类别':     { select:    { name: row.category || 'raw' } },
          '来源':     { select:    { name: row.source || 'auto' } },
          '更新时间': { date:      { start: fmtDate(row.created_at || new Date()) } },
        },
      });
    }

    if (page?.id && row.id) {
      await pool.query('UPDATE user_profile_facts SET notion_id=$1 WHERE id=$2', [page.id, row.id]);
    }
  } catch (e) {
    console.error('[notion-memory] pushFactToNotion 失败:', e.message);
  }
}

/**
 * 推送单条 memory_stream 到 Notion 日记
 * 在写入 memory_stream 后调用（不等待）
 */
export async function pushMemoryToNotion(row) {
  try {
    const txt     = typeof row.content === 'string' ? row.content : JSON.stringify(row.content || '');
    const summary = truncate(txt, 80);
    const validTypes = ['episodic', 'reflection', 'desire', 'learning', 'self_model'];
    const typ     = validTypes.includes(row.source_type) ? row.source_type : 'episodic';

    const page = await notionReq('/pages', 'POST', {
      parent:     { database_id: NOTION_MEMORY_DB_IDS.diary },
      properties: {
        '摘要':   { title:  [{ text: { content: summary } }] },
        '类型':   { select: { name: typ } },
        '重要性': { number: row.importance || 0 },
        '日期':   { date:   { start: fmtDate(row.created_at || new Date()) } },
      },
      children: [{
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: truncate(txt, 2000) } }] },
      }],
    });

    if (page?.id && row.id) {
      await pool.query('UPDATE memory_stream SET notion_id=$1 WHERE id=$2', [page.id, row.id]);
    }
  } catch (e) {
    console.error('[notion-memory] pushMemoryToNotion 失败:', e.message);
  }
}
