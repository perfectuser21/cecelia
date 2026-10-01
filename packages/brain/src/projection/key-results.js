/** Brain 系统 KR 的独立只读投影（02148cef）；公司经营 KR 保持独立口径。 */
import { notionReq as defaultNotionReq } from '../recurring-notion-sync.js';
import { propsDigest } from '../lib/notion-projection-engine.js';
import { normalizeNotionId } from '../lib/notion-projection-registry.js';
import { isCompanyKr, companyKrView } from '../lib/company-kr-metrics.js';

export const KR_PROJECTION_VESSEL = 'notion-kr-projection';
export const KR_PROJECTION_TITLE = 'Brain Key Results';
export const COMPANY_KR_DB_ID = '684c40c2-ba63-83a7-b6ba-8161f110a18c';
export const KR_DB_PROPERTIES = {
  Name: { title: {} }, 'Brain ID': { rich_text: {} }, Status: { select: {} },
  Progress: { number: { format: 'number' } }, Current: { number: { format: 'number' } },
  Target: { number: { format: 'number' } }, Unit: { rich_text: {} }, Source: { rich_text: {} },
  'Brain Updated At': { date: {} },
};
const INTERVAL_MS = 5 * 60 * 1000;
const lastRunByPool = new WeakMap();
const inFlightByPool = new WeakSet();
const rich = (value) => ({ rich_text: value == null || value === '' ? [] : [{ text: { content: String(value).slice(0, 1900) } }] });
const finite = (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

export function buildNotionKrProperties(kr) {
  const updated = kr.updated_at ? new Date(kr.updated_at) : null;
  const metric = isCompanyKr(kr) ? companyKrView(kr) : kr;
  return {
    Name: { title: [{ text: { content: String(kr.title || '未命名 KR').slice(0, 1900) } }] },
    'Brain ID': rich(kr.id), Status: { select: kr.status ? { name: String(kr.status).slice(0, 100) } : null },
    Progress: { number: finite(isCompanyKr(kr) ? metric.progress_pct : kr.progress) }, Current: { number: finite(metric.current_value) },
    Target: { number: finite(metric.target_value) }, Unit: rich(kr.unit),
    Source: rich(isCompanyKr(kr) ? `company_formula_v1;${metric.validation_state};notion:${metric.source_page_id}` : kr.metadata?.progress_source || 'unknown'),
    'Brain Updated At': { date: updated && Number.isFinite(updated.getTime()) ? { start: updated.toISOString() } : null },
  };
}

/** 指纹带目标库，换库后禁止复用上一库的页面映射。 */
export function krProjectionDigest(dbId, properties) {
  return propsDigest({ database_id: normalizeNotionId(dbId), properties });
}

async function assertDatabase(token, dbId, notionReq) {
  const db = await notionReq(token, `/databases/${dbId}`, 'GET');
  if (db.archived || db.in_trash) throw new Error('独立 Brain KR 库已归档');
  const title = (db.title || []).map(part => part.plain_text ?? part.text?.content ?? '').join('');
  if (title !== KR_PROJECTION_TITLE) throw new Error(`目标必须为独立 ${KR_PROJECTION_TITLE} 库`);
  for (const [name, spec] of Object.entries(KR_DB_PROPERTIES)) {
    if (db.properties?.[name]?.type !== Object.keys(spec)[0]) throw new Error(`独立 Brain KR 库列类型不符: ${name}`);
  }
}

async function findPage(token, dbId, krId, notionReq) {
  const result = await notionReq(token, `/databases/${dbId}/query`, 'POST', {
    filter: { property: 'Brain ID', rich_text: { equals: krId } }, page_size: 2,
  });
  if ((result.results?.length || 0) > 1 || result.has_more) throw new Error(`Brain ID 存在重复投影: ${krId}`);
  return result.results?.[0]?.id || null;
}

async function linkedPage(token, dbId, kr, notionReq) {
  if (kr.external_id) {
    try {
      const page = await notionReq(token, `/pages/${kr.external_id}`, 'GET');
      const id = (page.properties?.['Brain ID']?.rich_text || []).map(p => p.plain_text ?? p.text?.content ?? '').join('');
      if (!page.archived && !page.in_trash && normalizeNotionId(page.parent?.database_id) === normalizeNotionId(dbId) && id === kr.id) return kr.external_id;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  return findPage(token, dbId, kr.id, notionReq);
}

export async function runNotionKrProjection(pool, {
  token = process.env.NOTION_API_KEY || process.env.NOTION_API_TOKEN || process.env.NOTION_INBOX_TOKEN,
  notionReq = defaultNotionReq, now = Date.now(),
} = {}) {
  if (!token) return { skipped: true, reason: 'not_configured' };
  const { rows: targets } = await pool.query(
    `SELECT notion_db_id FROM notion_projection_map
     WHERE brain_table='key_results' AND face='mirror' AND direction='push'
       AND status='active' AND vessel=$1`, [KR_PROJECTION_VESSEL]);
  if (!targets.length) return { skipped: true, reason: 'not_registered' };
  if (targets.length !== 1) throw new Error('Brain KR 投影须登记唯一独立库');
  const dbId = targets[0].notion_db_id;
  if (normalizeNotionId(dbId) === normalizeNotionId(COMPANY_KR_DB_ID)) throw new Error('禁止向公司 KR 库投影 Brain 系统 KR');
  if (inFlightByPool.has(pool)) return { skipped: true, reason: 'in_flight' };
  const last = lastRunByPool.get(pool);
  if (last !== undefined && now - last < INTERVAL_MS) return { skipped: true, reason: 'interval' };
  lastRunByPool.set(pool, now);
  inFlightByPool.add(pool);
  try {
    return await pushKrRows(pool, token, dbId, notionReq);
  } finally {
    inFlightByPool.delete(pool);
  }
}

async function pushKrRows(pool, token, dbId, notionReq) {
  const { rows } = await pool.query(
    `SELECT kr.*, pl.external_id, pl.content_hash FROM key_results kr
     LEFT JOIN projection_links pl ON pl.target='notion' AND pl.entity_type='key_results' AND pl.entity_id=kr.id
     ORDER BY kr.updated_at, kr.id`);
  const result = { created: 0, patched: 0, skipped: 0, failed: 0 };
  let databaseChecked = false;
  for (const kr of rows) {
    try {
      const properties = buildNotionKrProperties(kr);
      const hash = krProjectionDigest(dbId, properties);
      if (!databaseChecked) { await assertDatabase(token, dbId, notionReq); databaseChecked = true; }
      const existingId = await linkedPage(token, dbId, kr, notionReq);
      if (existingId === kr.external_id && kr.content_hash === hash) { result.skipped++; continue; }
      const page = existingId
        ? await notionReq(token, `/pages/${existingId}`, 'PATCH', { properties })
        : await notionReq(token, '/pages', 'POST', { parent: { database_id: dbId }, properties });
      const externalId = page.id || existingId;
      if (!externalId) throw new Error('Notion 未返回 KR 页面 ID');
      await pool.query(
        `INSERT INTO projection_links (target, entity_type, entity_id, external_id, content_hash, last_synced_at)
         VALUES ('notion','key_results',$1,$2,$3,NOW())
         ON CONFLICT (target, entity_type, entity_id) DO UPDATE
         SET external_id=EXCLUDED.external_id, content_hash=EXCLUDED.content_hash,
             last_synced_at=NOW(), updated_at=NOW()`, [kr.id, externalId, hash]);
      if (existingId) result.patched++; else result.created++;
    } catch (error) {
      result.failed++;
      result.last_error = error.message;
    }
  }
  if (result.failed) {
    const error = new Error(`KR 投影失败 ${result.failed} 行: ${result.last_error}`);
    error.summary = result;
    throw error;
  }
  return result;
}


/** 配置只登记独立 KR 镜子；结构仍由既有迁移维护。 */
export async function configureKrProjection(pool, databaseId, {
  token = process.env.NOTION_API_KEY || process.env.NOTION_API_TOKEN || process.env.NOTION_INBOX_TOKEN,
  notionReq = defaultNotionReq,
} = {}) {
  const raw = String(databaseId || '');
  if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(raw)) throw new Error('database_id 必须为 Notion UUID');
  const compact = normalizeNotionId(raw);
  const canonical = `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
  if (compact === normalizeNotionId(COMPANY_KR_DB_ID)) throw new Error('禁止登记公司 KR 库为 Brain 系统 KR 镜子');
  if (!token) throw new Error('Notion token 未配置');
  await assertDatabase(token, canonical, notionReq);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [KR_PROJECTION_VESSEL]);
    const { rows } = await client.query(
      `SELECT notion_db_id, brain_table, vessel, face FROM notion_projection_map
       WHERE lower(replace(notion_db_id, '-', ''))=$1 FOR UPDATE`, [compact]);
    if (rows.length > 1 || rows.some(r => r.brain_table !== 'key_results' || r.vessel !== KR_PROJECTION_VESSEL || r.face !== 'mirror')) throw new Error('目标投影库已有其它归属，拒绝抢占');
    if (rows[0] && rows[0].notion_db_id !== canonical) {
      await client.query('UPDATE notion_projection_map SET notion_db_id=$1, updated_at=NOW() WHERE notion_db_id=$2', [canonical, rows[0].notion_db_id]);
    }
    await client.query(
      `UPDATE notion_projection_map SET status='dormant', updated_at=NOW()
       WHERE brain_table='key_results' AND vessel=$1 AND face='mirror'
         AND status='active' AND notion_db_id<>$2`, [KR_PROJECTION_VESSEL, canonical]);
    const inserted = await client.query(
      `INSERT INTO notion_projection_map(notion_db_id,title,face,brain_table,direction,vessel,status,space,notes)
       VALUES ($1,$2,'mirror','key_results','push',$3,'active','system',$4)
       ON CONFLICT (notion_db_id, COALESCE(brain_table, '')) DO UPDATE
       SET title=EXCLUDED.title, direction='push', status='active', updated_at=NOW()
       WHERE notion_projection_map.brain_table='key_results'
         AND notion_projection_map.vessel=$3 AND notion_projection_map.face='mirror'
       RETURNING notion_db_id`,
      [canonical, KR_PROJECTION_TITLE, KR_PROJECTION_VESSEL, '独立系统 KR 镜子；经营 KR/OPC 口径保持独立；Current/Target/Progress 各列独立']);
    if (!inserted.rowCount) throw new Error('目标投影库已有其它归属，拒绝抢占');
    await client.query('COMMIT');
    lastRunByPool.delete(pool);
    return { database_id: canonical, vessel: KR_PROJECTION_VESSEL, status: 'active' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
