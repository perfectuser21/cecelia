/** 独立目录血管：先校验全部schema，后投影；固定身份和读回成功才落成功收据。 */
import { notionReq as defaultNotionReq, getToken } from '../recurring-notion-sync.js';
import { propsDigest } from '../lib/notion-projection-engine.js';
import { ensureDirectorySchemas } from './directory-schema.js';
import { loadDirectorySource, buildDirectoryRows, rich } from './directory-source.js';

export const DIRECTORY_LOCK = 613006;
export const DIRECTORY_TARGET = 'notion-directory';
const compact = id => String(id || '').replaceAll('-', '').toLowerCase();
const text = p => (p?.rich_text || p?.title || []).map(t => t.plain_text ?? t.text?.content ?? '').join('');
function assertPage(page, dbId, id, allowBlank) {
  if (!page?.id || page.archived || page.in_trash || compact(page.parent?.database_id) !== compact(dbId)) throw new Error('目录页身份或数据库不符');
  const actual = text(page.properties?.['Brain ID']);
  if (actual !== id && !(allowBlank && !actual)) throw new Error('目录页 Brain ID 身份冲突');
}
function value(property) {
  if (property?.relation) {
    if (property.has_more) throw new Error('关系读回被截断');
    return property.relation.map(x => compact(x.id)).sort();
  }
  if (property?.rich_text || property?.title) return text(property);
  if ('select' in (property || {})) return property.select?.name ?? null;
  if ('date' in (property || {})) return property.date?.start ? new Date(property.date.start).toISOString() : null;
  if ('number' in (property || {})) return property.number;
  return property;
}

export async function projectDirectoryPage(pool, { token, dbId, row, properties, notionReq = defaultNotionReq, finalize = true }) {
  const links = (await pool.query(`SELECT entity_type,entity_id,external_id FROM projection_links
    WHERE target='notion' AND entity_type=$1 AND entity_id=$2`, [row.table, row.id])).rows;
  let pageId = links[0]?.external_id || row.pageId;
  if (links[0] && row.pageId && compact(row.pageId) !== compact(links[0].external_id)) throw new Error('旧目录链接与来源页冲突');
  if (pageId) {
    const page = await notionReq(token, `/pages/${pageId}`, 'GET');
    assertPage(page, dbId, row.id, true);
  } else {
    const found = await notionReq(token, `/databases/${dbId}/query`, 'POST', {
      filter: { property: 'Brain ID', rich_text: { equals: row.id } }, page_size: 100,
    });
    if (found.has_more || found.results.length > 1) throw new Error('目录 Brain ID 重复页');
    if (found.results[0]) { assertPage(found.results[0], dbId, row.id, false); pageId = found.results[0].id; }
    else if (!row.allowCreate) throw new Error('目录来源尚未建立可信页面映射');
  }
  if (pageId) {
    const occupied = (await pool.query(`SELECT entity_type,entity_id FROM projection_links
      WHERE target='notion' AND external_id=$1 AND (entity_type<>$2 OR entity_id<>$3)`, [pageId, row.table, row.id])).rows;
    if (occupied.length) throw new Error('目录页已由其它真身占用');
  }
  const written = await notionReq(token, pageId ? `/pages/${pageId}` : '/pages', pageId ? 'PATCH' : 'POST',
    { ...(pageId ? {} : { parent: { database_id: dbId } }), properties });
  pageId ||= written.id;
  if (!pageId || (written.id && compact(written.id) !== compact(pageId))) throw new Error('目录写回身份不一致');
  const readback = await notionReq(token, `/pages/${pageId}`, 'GET');
  assertPage(readback, dbId, row.id, false);
  for (const [key, expected] of Object.entries(properties)) {
    if (JSON.stringify(value(readback.properties?.[key])) !== JSON.stringify(value(expected))) throw new Error(`目录属性读回不一致: ${key}`);
  }
  if (finalize) await pool.query(`INSERT INTO projection_links(target,entity_type,entity_id,external_id,content_hash,last_synced_at)
    VALUES('notion',$1,$2,$3,$4,NOW()) ON CONFLICT(target,entity_type,entity_id) DO UPDATE SET
    content_hash=EXCLUDED.content_hash,last_synced_at=NOW(),updated_at=NOW()
    WHERE projection_links.external_id=EXCLUDED.external_id RETURNING external_id`,
  [row.table, row.id, pageId, propsDigest({ database_id: dbId, properties })]).then(result => {
    if (result.rowCount === 0) throw new Error('目录链接已变化，拒绝成功收据');
  });
  return pageId;
}

export async function runDirectoryProjection(pool, { token, notionReq = defaultNotionReq, force = false } = {}) {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock($1) AS locked', [DIRECTORY_LOCK])).rows[0]?.locked;
    if (!locked) return { skipped: true, reason: 'busy' };
    const target = (await client.query('SELECT enabled,config,last_success_at FROM projection_targets WHERE target=$1', [DIRECTORY_TARGET])).rows[0];
    if (!target?.enabled) return { skipped: true, reason: 'not_configured' };
    if (!force && target.last_success_at && Date.now() - new Date(target.last_success_at).getTime() < 300000) return { skipped: true, reason: 'interval' };
    token ||= getToken();
    const { dbs } = target.config;
    await ensureDirectorySchemas({ dbs, token, notionReq });
    const rows = buildDirectoryRows(await loadDirectorySource(client), target.config);
    const pages = new Map(), errors = [], stat = { total: rows.length, synced: 0, incomplete: 0, failed: 0 };
    // 两阶段建身份、连关系。第一阶段不写成功receipt，断开后按Brain ID精确找回。
    for (const row of rows) {
      try {
        const pageId = await projectDirectoryPage(client, { token, dbId: dbs[row.layer], row, notionReq, finalize: false,
          properties: { ...row.properties, '同步状态': { select: { name: '待核对' } }, '登记缺口': rich(row.gaps.join('\n')) } });
        pages.set(`${row.layer}:${row.id}`, pageId);
      } catch (error) { stat.failed++; errors.push({ layer: row.layer, id: row.id, code: error.message }); }
    }
    for (const row of rows) {
      const pageId = pages.get(`${row.layer}:${row.id}`);
      if (!pageId) continue;
      const gaps = [...row.gaps], relations = {};
      for (const [key, targets] of Object.entries(row.relations)) {
        const ids = targets.map(t => pages.get(`${t.layer}:${t.id}`));
        if (ids.some(id => !id) || ids.length > 100) gaps.push(`relation_unresolved:${key}`);
        else relations[key] = { relation: ids.map(id => ({ id })) };
      }
      try {
        await projectDirectoryPage(client, { token, dbId: dbs[row.layer], row: { ...row, pageId }, notionReq,
          properties: { ...row.properties, ...relations, '同步状态': { select: { name: gaps.length ? '有缺口' : '已同步' } },
            '登记缺口': rich(gaps.join('\n')), '同步时间': { date: { start: new Date().toISOString() } } } });
        if (gaps.length) stat.incomplete++; else stat.synced++;
      } catch (error) { stat.failed++; errors.push({ layer: row.layer, id: row.id, code: error.message }); }
    }
    await client.query(`UPDATE projection_targets SET last_success_at=CASE WHEN $2=0 THEN NOW() ELSE last_success_at END,
      last_error=$3,updated_at=NOW() WHERE target=$1`, [DIRECTORY_TARGET, stat.failed, errors.length ? JSON.stringify(errors).slice(0, 4000) : null]);
    return { ...stat, errors };
  } catch (error) {
    await client.query('UPDATE projection_targets SET last_error=$2,updated_at=NOW() WHERE target=$1', [DIRECTORY_TARGET, error.message]).catch(() => {});
    throw error;
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [DIRECTORY_LOCK]).catch(() => {});
    client.release();
  }
}
