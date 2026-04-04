/**
 * notion-memory-sync.js
 *
 * Notion Memory 系统同步：
 *  - 主人档案（user_profile_facts）↔ Notion "👤 主人档案"
 *  - 人脉网络（category=other）      ↔ Notion "👥 人脉网络"
 *  - Cecelia 日记（memory_stream）   → Notion "📖 Cecelia 日记"（只写）
 *
 * 支持的 Notion property 类型（全覆盖）：
 *   title / rich_text / select / multi_select / number / date /
 *   email / phone_number / url / checkbox / status
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

/**
 * 把长文本拆成多个 paragraph block（每段最多 2000 字）
 */
function textToBlocks(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += 2000) {
    chunks.push(text.slice(i, i + 2000));
  }
  return chunks.map(chunk => ({
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] },
  }));
}

// ─── Contact 内容解析 ──────────────────────────────────────────

/**
 * 解析 contacts content 文本（"key:value key:value ..."格式）为结构化字段
 *
 * 示例输入：
 *   "姓名:胡月萍 称呼:糊糊 实际关系:妻子 生日:1989-07-02 分类:至亲"
 *   "姓名:贾得巍 实际关系:法务专家 分类:朋友 职业:律师"
 */
export function parseContactContent(content) {
  if (!content) return {};
  const result = {};

  // 匹配 "key:value" 对（支持中文 key，value 到下一个 key 或字符串末尾）
  const pattern = /([^\s:：，,]+)[：:]\s*([^：:\n]+?)(?=\s+[^\s:：，,]+[：:]|$)/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const key   = match[1].trim();
    const value = match[2].trim();
    if (key && value) result[key] = value;
  }

  // 如果解析失败（无冒号），整个 content 作为备注
  if (Object.keys(result).length === 0) {
    result['备注'] = content;
  }

  return result;
}

function isDateStr(s) {
  return /^\d{4}[-\/]\d{2}[-\/]\d{2}$/.test(s?.trim());
}

function isEmailStr(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s?.trim());
}

function isPhoneStr(s) {
  return /^[\+\-\(\)\s\d]{5,}$/.test(s?.trim());
}

function isUrlStr(s) {
  return /^https?:\/\//i.test(s?.trim());
}

// ─── Contact 字段键集合（模块级常量）────────────────────────────

const CONTACT_KEY_SETS = {
  RELATION: new Set(['实际关系', '关系', 'relation', 'relationship']),
  CATEGORY: new Set(['分类', 'category', '类别', '标签', 'tag', 'tags']),
  JOB:      new Set(['职业', '工作', 'job', 'profession', 'title', 'occupation']),
  NICKNAME: new Set(['称呼', '昵称', 'nickname', 'alias']),
  BIRTHDAY: new Set(['生日', 'birthday', '出生日期', 'dob']),
  EMAIL:    new Set(['邮箱', '邮件', 'email', 'mail']),
  PHONE:    new Set(['电话', '手机', '联系方式', 'phone', 'mobile', 'tel']),
  URL:      new Set(['网址', '主页', '链接', 'url', 'website', 'homepage', 'linkedin']),
  NOTE:     new Set(['备注', '说明', '描述', 'notes', 'remark', 'memo', 'desc']),
  SKIP:     new Set(['姓名', 'name', '名字']),
};

// 简单 key 精确匹配（CC=6）
function _contactMapKnownKey(key, val) {
  const { RELATION, CATEGORY, JOB, NICKNAME, NOTE } = CONTACT_KEY_SETS;
  if (RELATION.has(key)) return { '关系': { select: { name: truncate(val, 100) } } };
  if (CATEGORY.has(key)) {
    const tags = val.split(/[,，、]/).map(t => t.trim()).filter(Boolean);
    return { '分类': { multi_select: tags.map(t => ({ name: truncate(t, 100) })) } };
  }
  if (JOB.has(key))      return { '职业': { rich_text: [{ text: { content: truncate(val, 500) } }] } };
  if (NICKNAME.has(key)) return { '称呼': { rich_text: [{ text: { content: truncate(val, 200) } }] } };
  if (NOTE.has(key))     return { '备注': { rich_text: [{ text: { content: truncate(val, 2000) } }] } };
  return null;
}

// key + 值条件混合匹配（CC=9）
function _contactMapWithCondition(key, val) {
  const { BIRTHDAY, EMAIL, PHONE, URL } = CONTACT_KEY_SETS;
  if (BIRTHDAY.has(key) && isDateStr(val))  return { '生日': { date: { start: val.replace(/\//g, '-') } } };
  if (EMAIL.has(key) || isEmailStr(val))    return { '邮箱': { email: truncate(val, 200) } };
  if (PHONE.has(key) && !isEmailStr(val))   return { '电话': { phone_number: truncate(val, 50) } };
  if (URL.has(key) || isUrlStr(val))        return { '网址': { url: truncate(val, 2000) } };
  return null;
}

// 未知 key 时按值内容自动检测（CC=9）
function _contactInferFromValue(val, props) {
  if (isEmailStr(val) && !props['邮箱']) return { '邮箱': { email: truncate(val, 200) } };
  if (isPhoneStr(val) && !props['电话']) return { '电话': { phone_number: truncate(val, 50) } };
  if (isUrlStr(val)   && !props['网址']) return { '网址': { url: truncate(val, 2000) } };
  if (isDateStr(val)  && !props['生日']) return { '生日': { date: { start: val.replace(/\//g, '-') } } };
  return null;
}

// 单字段分派（CC=1）
function _contactMapField(key, val, props) {
  return _contactMapKnownKey(key, val)
    ?? _contactMapWithCondition(key, val)
    ?? _contactInferFromValue(val, props);
}

/**
 * 把解析出的 contact 字段映射到 Notion properties 对象（CC=7）
 */
export function contactFieldsToNotionProps(fields, sourceName, updatedAt) {
  const props = {};
  for (const [key, val] of Object.entries(fields)) {
    if (!val || CONTACT_KEY_SETS.SKIP.has(key)) continue;
    const mapped = _contactMapField(key, val, props);
    if (mapped) Object.assign(props, mapped);
  }
  if (sourceName) props['来源']     = { select: { name: sourceName } };
  if (updatedAt)  props['更新时间'] = { date: { start: fmtDate(updatedAt) } };
  return props;
}

// ─── 动态获取 title 属性名 ─────────────────────────────────────

async function getTitlePropName(dbId) {
  const db = await notionReq(`/databases/${dbId}`);
  for (const [name, prop] of Object.entries(db.properties || {})) {
    if (prop.type === 'title') return { name, existing: db.properties };
  }
  return { name: null, existing: db.properties || {} };
}

// ─── 重建数据库结构 ────────────────────────────────────────────

/**
 * 更新 3 个 Notion 数据库为完整结构（支持所有实用 property 类型）
 * 先 GET 获取现有属性，再 PATCH 只添加缺失属性，不修改内置属性
 */
export async function rebuildMemoryDatabases() {
  const results = {};

  // ── 主人档案 ───────────────────────────────────────────────
  try {
    const { name: titleName, existing } = await getTitlePropName(NOTION_MEMORY_DB_IDS.ownerProfile);
    const p = {};
    if (titleName && titleName !== '键') p[titleName] = { name: '键' };
    if (!existing['值'])       p['值']       = { rich_text: {} };
    if (!existing['类别'])     p['类别']     = { select: { options: [] } };
    if (!existing['来源'])     p['来源']     = { select: { options: [] } };
    if (!existing['更新时间']) p['更新时间'] = { date: {} };
    if (!existing['已验证'])   p['已验证']   = { checkbox: {} };
    await notionReq(`/databases/${NOTION_MEMORY_DB_IDS.ownerProfile}`, 'PATCH', {
      title: [{ text: { content: '👤 主人档案' } }],
      properties: p,
    });
    results.ownerProfile = 'ok';
  } catch (e) {
    results.ownerProfile = e.message.slice(0, 100);
  }

  // ── 人脉网络 ───────────────────────────────────────────────
  try {
    const { name: titleName, existing } = await getTitlePropName(NOTION_MEMORY_DB_IDS.contacts);
    const p = {};
    if (titleName && titleName !== '姓名') p[titleName] = { name: '姓名' };
    if (!existing['关系'])     p['关系']     = { select: { options: [
      { name: '同事', color: 'blue' },
      { name: '朋友', color: 'green' },
      { name: '亲戚', color: 'orange' },
      { name: '至亲', color: 'red' },
      { name: '客户', color: 'purple' },
      { name: '其他', color: 'gray' },
    ] } };
    if (!existing['分类'])     p['分类']     = { multi_select: { options: [] } };
    if (!existing['称呼'])     p['称呼']     = { rich_text: {} };
    if (!existing['职业'])     p['职业']     = { rich_text: {} };
    if (!existing['生日'])     p['生日']     = { date: {} };
    if (!existing['邮箱'])     p['邮箱']     = { email: {} };
    if (!existing['电话'])     p['电话']     = { phone_number: {} };
    if (!existing['网址'])     p['网址']     = { url: {} };
    if (!existing['备注'])     p['备注']     = { rich_text: {} };
    if (!existing['状态'])     p['状态']     = { status: {} };
    if (!existing['来源'])     p['来源']     = { select: { options: [] } };
    if (!existing['更新时间']) p['更新时间'] = { date: {} };
    await notionReq(`/databases/${NOTION_MEMORY_DB_IDS.contacts}`, 'PATCH', {
      title: [{ text: { content: '👥 人脉网络' } }],
      properties: p,
    });
    results.contacts = 'ok';
  } catch (e) {
    results.contacts = e.message.slice(0, 100);
  }

  // ── Cecelia 日记 ──────────────────────────────────────────
  try {
    const { name: titleName, existing } = await getTitlePropName(NOTION_MEMORY_DB_IDS.diary);
    const p = {};
    if (titleName && titleName !== '摘要') p[titleName] = { name: '摘要' };
    if (!existing['类型'])   p['类型']   = { select: { options: [
      { name: 'episodic',   color: 'blue' },
      { name: 'reflection', color: 'purple' },
      { name: 'desire',     color: 'pink' },
      { name: 'learning',   color: 'green' },
      { name: 'self_model', color: 'yellow' },
    ] } };
    if (!existing['重要性']) p['重要性'] = { number: {} };
    if (!existing['日期'])   p['日期']   = { date: {} };
    if (!existing['已处理']) p['已处理'] = { checkbox: {} };
    if (!existing['状态'])   p['状态']   = { status: {} };
    await notionReq(`/databases/${NOTION_MEMORY_DB_IDS.diary}`, 'PATCH', {
      title: [{ text: { content: '📖 Cecelia 日记' } }],
      properties: p,
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

  // ── 主人档案（非 other 类别）──────────────────────────────
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
          '已验证':   { checkbox:  false },
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

  // ── 人脉网络（category=other）──────────────────────────────
  await archiveAllPages(NOTION_MEMORY_DB_IDS.contacts).catch(() => {});
  const contacts = await pool.query(
    "SELECT id, content, COALESCE(source,'import') as source, created_at FROM user_profile_facts WHERE user_id='owner' AND category='other' ORDER BY id DESC"
  );
  for (const row of contacts.rows) {
    try {
      const fields = parseContactContent(row.content);
      const name   = truncate(fields['姓名'] || fields['name'] || row.content.replace(/^姓名:\s*/, '').trim() || '未命名', 100);
      const extraProps = contactFieldsToNotionProps(fields, row.source, row.created_at);

      const page = await notionReq('/pages', 'POST', {
        parent:     { database_id: NOTION_MEMORY_DB_IDS.contacts },
        properties: {
          '姓名': { title: [{ text: { content: name } }] },
          '备注': extraProps['备注'] || { rich_text: [{ text: { content: truncate(row.content, 2000) } }] },
          ...extraProps,
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

  // ── Cecelia 日记（最近 50 条）──────────────────────────────
  await archiveAllPages(NOTION_MEMORY_DB_IDS.diary).catch(() => {});
  const diary = await pool.query(
    "SELECT id, source_type, content, importance, status, resolved_at, created_at FROM memory_stream WHERE content IS NOT NULL ORDER BY created_at DESC LIMIT 50"
  );
  const validTypes = ['episodic', 'reflection', 'desire', 'learning', 'self_model'];
  for (const row of diary.rows) {
    try {
      const txt    = typeof row.content === 'string' ? row.content : JSON.stringify(row.content);
      const summary = truncate(txt, 80);
      const typ    = validTypes.includes(row.source_type) ? row.source_type : 'episodic';
      const isDone = !!row.resolved_at;
      const status = row.status || 'active';

      const page = await notionReq('/pages', 'POST', {
        parent:     { database_id: NOTION_MEMORY_DB_IDS.diary },
        properties: {
          '摘要':   { title:    [{ text: { content: summary } }] },
          '类型':   { select:   { name: typ } },
          '重要性': { number:   row.importance || 0 },
          '日期':   { date:     { start: fmtDate(row.created_at) } },
          '已处理': { checkbox: isDone },
          '状态':   { status:   { name: status } },
        },
        children: textToBlocks(txt),
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
 */
export async function pushFactToNotion(row) {
  try {
    const isContact = row.category === 'other';
    const dbId = isContact ? NOTION_MEMORY_DB_IDS.contacts : NOTION_MEMORY_DB_IDS.ownerProfile;

    let page;
    if (isContact) {
      const fields = parseContactContent(row.content);
      const name   = truncate(fields['姓名'] || fields['name'] || (row.content || '').replace(/^姓名:\s*/, '').trim() || '未命名', 100);
      const extraProps = contactFieldsToNotionProps(fields, row.source || 'auto', row.created_at || new Date());

      page = await notionReq('/pages', 'POST', {
        parent:     { database_id: dbId },
        properties: {
          '姓名': { title: [{ text: { content: name } }] },
          '备注': extraProps['备注'] || { rich_text: [{ text: { content: truncate(row.content, 2000) } }] },
          ...extraProps,
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
          '已验证':   { checkbox:  false },
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
 */
export async function pushMemoryToNotion(row) {
  try {
    const txt    = typeof row.content === 'string' ? row.content : JSON.stringify(row.content || '');
    const summary = truncate(txt, 80);
    const validTypes = ['episodic', 'reflection', 'desire', 'learning', 'self_model'];
    const typ    = validTypes.includes(row.source_type) ? row.source_type : 'episodic';
    const isDone = !!row.resolved_at;
    const status = row.status || 'active';

    const page = await notionReq('/pages', 'POST', {
      parent:     { database_id: NOTION_MEMORY_DB_IDS.diary },
      properties: {
        '摘要':   { title:    [{ text: { content: summary } }] },
        '类型':   { select:   { name: typ } },
        '重要性': { number:   row.importance || 0 },
        '日期':   { date:     { start: fmtDate(row.created_at || new Date()) } },
        '已处理': { checkbox: isDone },
        '状态':   { status:   { name: status } },
      },
      children: textToBlocks(txt),
    });

    if (page?.id && row.id) {
      await pool.query('UPDATE memory_stream SET notion_id=$1 WHERE id=$2', [page.id, row.id]);
    }
  } catch (e) {
    console.error('[notion-memory] pushMemoryToNotion 失败:', e.message);
  }
}
