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
    WHERE target IN ('notion','notion-directory') AND entity_type=$1 AND entity_id=$2`, [row.table, row.id])).rows;
  if (new Set(links.map(l => compact(l.external_id))).size > 1) throw new Error('目录与旧writer链接冲突');
  let pageId = links[0]?.external_id || row.pageId;
  let existingPage;
  if (links[0] && row.pageId && compact(row.pageId) !== compact(links[0].external_id)) throw new Error('旧目录链接与来源页冲突');
  if (pageId) {
    existingPage = await notionReq(token, `/pages/${pageId}`, 'GET');
    assertPage(existingPage, dbId, row.id, true);
  } else {
    const found = await notionReq(token, `/databases/${dbId}/query`, 'POST', {
      filter: { property: 'Brain ID', rich_text: { equals: row.id } }, page_size: 100,
    });
    if (found.has_more || found.results.length > 1) throw new Error('目录 Brain ID 重复页');
    if (found.results[0]) { assertPage(found.results[0], dbId, row.id, false); pageId = found.results[0].id; existingPage = found.results[0]; }
    else if (!row.allowCreate) throw new Error('目录来源尚未建立可信页面映射');
  }
  if (pageId) {
    const occupied = (await pool.query(`SELECT entity_type,entity_id FROM projection_links
      WHERE target IN ('notion','notion-directory') AND external_id=$1 AND (entity_type<>$2 OR entity_id<>$3)`, [pageId, row.table, row.id])).rows;
    if (occupied.length) throw new Error('目录页已由其它真身占用');
  }
  if (!finalize && existingPage && text(existingPage.properties?.['Brain ID']) === row.id) return pageId;
  const unchanged = existingPage && Object.entries(properties).filter(([k])=>k!=='同步时间').every(([key,expected])=>
    JSON.stringify(value(existingPage.properties?.[key]))===JSON.stringify(value(expected)));
  let readback = existingPage;
  if (!unchanged) {
    const written = await notionReq(token, pageId ? `/pages/${pageId}` : '/pages', pageId ? 'PATCH' : 'POST',
      { ...(pageId ? {} : { parent: { database_id: dbId } }), properties: { ...(pageId ? {} : row.createProperties), ...properties } });
    pageId ||= written.id;
    if (!pageId || (written.id && compact(written.id) !== compact(pageId))) throw new Error('目录写回身份不一致');
    readback = await notionReq(token, `/pages/${pageId}`, 'GET');
  }
  assertPage(readback, dbId, row.id, false);
  for (const [key, expected] of Object.entries(properties)) {
    if (unchanged && key === '同步时间') continue;
    if (JSON.stringify(value(readback.properties?.[key])) !== JSON.stringify(value(expected))) throw new Error(`目录属性读回不一致: ${key}`);
  }
  if (finalize) await pool.query(`INSERT INTO projection_links(target,entity_type,entity_id,external_id,content_hash,last_synced_at)
    VALUES('notion-directory',$1,$2,$3,$4,NOW()) ON CONFLICT(target,entity_type,entity_id) DO UPDATE SET
    content_hash=EXCLUDED.content_hash,last_synced_at=NOW(),updated_at=NOW()
    WHERE projection_links.external_id=EXCLUDED.external_id RETURNING external_id`,
  [row.table, row.id, pageId, propsDigest({ database_id: dbId, properties: Object.fromEntries(Object.entries(properties).filter(([k])=>k!=='同步时间')) })]).then(result => {
    if (result.rowCount === 0) throw new Error('目录链接已变化，拒绝成功收据');
  });
  return pageId;
}

export async function runDirectoryProjection(pool, { token, notionReq = defaultNotionReq, force = false, batchSize = 25, budgetMs = 60000, beforeSource } = {}) {
  const deadline = Date.now() + Math.max(0, Math.min(60000,budgetMs)), request = notionReq;
  notionReq = (...args) => { if (Date.now() >= deadline) throw new Error('目录单轮预算耗尽'); return request(...args); };
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
    if (beforeSource) await beforeSource({ client, token, config: target.config, notionReq });
    const sourceRows = buildDirectoryRows(await loadDirectorySource(client), target.config);
    const catalogGap = row => row.layer==='value_streams' && row.gaps.includes('value_stream_binding_missing') ? 'value_stream_binding_missing' :
      row.layer==='areas' && !row.pageId ? 'area_page_binding_missing' : null;
    const catalogGaps = sourceRows.filter(catalogGap).map(r=>({id:r.id,gap:catalogGap(r)}));
    const rows = sourceRows.filter(r=>!catalogGap(r));
    const stateKey = 'directory_projection_pending';
    const state = (await client.query('SELECT value_json FROM working_memory WHERE key=$1', [stateKey])).rows[0]?.value_json || {};
    const pending = state.pages || {};
    const links = (await client.query("SELECT entity_type,entity_id,external_id FROM projection_links WHERE target IN ('notion','notion-directory')")).rows;
    const pages = new Map(), errors = [], stat = { total: rows.length, processed: 0, synced: 0, incomplete: 0, failed: 0 };
    for (const row of rows) {
      const key = `${row.layer}:${row.id}`, found = links.filter(l => l.entity_type === row.table && l.entity_id === row.id);
      const ids = new Set([...found.map(l => l.external_id), row.pageId, pending[key]].filter(Boolean));
      if (new Set([...ids].map(compact)).size === 1) pages.set(key, [...ids][0]);
    }
    const start = Number.isInteger(state.cursor) && state.cursor < rows.length ? state.cursor : 0;
    const batch = rows.slice(start, start + Math.max(1, Math.min(25, batchSize)));
    const saveState = async cursor => client.query(`INSERT INTO working_memory(key,value_json,updated_at) VALUES($1,$2::jsonb,NOW())
      ON CONFLICT(key) DO UPDATE SET value_json=EXCLUDED.value_json,updated_at=NOW()`, [stateKey, JSON.stringify({ pages: pending, cursor })]);
    // 两阶段建身份、连关系。第一阶段不写成功receipt，断开后按Brain ID精确找回。
    for (const row of batch) {
      stat.processed++;
      try {
        const key = `${row.layer}:${row.id}`;
        const pageId = await projectDirectoryPage(client, { token, dbId: dbs[row.layer], row: { ...row, pageId: pages.get(key) || row.pageId }, notionReq, finalize: false,
          properties: { ...row.properties, '同步状态': { select: { name: '待核对' } }, '登记缺口': rich(row.gaps.join('\n')) } });
        pages.set(key, pageId); pending[key] = pageId; await saveState(start);
      } catch (error) { pages.delete(`${row.layer}:${row.id}`); stat.failed++; errors.push({ layer: row.layer, id: row.id, code: error.message }); }
    }
    const verified = new Set();
    for (const row of batch) {
      const pageId = pages.get(`${row.layer}:${row.id}`);
      if (!pageId) continue;
      const gaps = [...row.gaps], relations = {};
      for (const [key, targets] of Object.entries(row.relations)) {
        const ids = targets.map(t => pages.get(`${t.layer}:${t.id}`));
        if (ids.some(id => !id) || ids.length > 100) gaps.push(`relation_unresolved:${key}`);
        else {
          let valid = true;
          for (const t of targets) {
            const targetKey = `${t.layer}:${t.id}`;
            if (verified.has(targetKey)) continue;
            try {
              assertPage(await notionReq(token, `/pages/${pages.get(targetKey)}`, 'GET'), dbs[t.layer], t.id, true);
              verified.add(targetKey);
            } catch { valid = false; gaps.push(`relation_identity_invalid:${key}`); }
          }
          if (valid) relations[key] = { relation: ids.map(id => ({ id })) };
        }
      }
      try {
        await projectDirectoryPage(client, { token, dbId: dbs[row.layer], row: { ...row, pageId }, notionReq,
          properties: { ...row.properties, ...relations, '同步状态': { select: { name: gaps.length ? '有缺口' : '已同步' } },
            '登记缺口': rich(gaps.join('\n')), '同步时间': { date: { start: new Date().toISOString() } } } });
        if (gaps.length) stat.incomplete++; else stat.synced++;
      } catch (error) { stat.failed++; errors.push({ layer: row.layer, id: row.id, code: error.message }); }
    }
    await saveState(start + batch.length >= rows.length ? 0 : start + batch.length);
    await client.query(`UPDATE projection_targets SET last_success_at=CASE WHEN $2=0 THEN NOW() ELSE last_success_at END,
      last_error=$3,updated_at=NOW() WHERE target=$1`, [DIRECTORY_TARGET, stat.failed, errors.length ? JSON.stringify(errors).slice(0, 4000) : null]);
    return { ...stat, status: stat.failed ? 'failed' : stat.incomplete || catalogGaps.length ? 'partial' : 'batch_verified', errors, catalog_gaps: catalogGaps };
  } catch (error) {
    await client.query('UPDATE projection_targets SET last_error=$2,updated_at=NOW() WHERE target=$1', [DIRECTORY_TARGET, error.message]).catch(() => {});
    throw error;
  } finally {
    let releaseError;
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [DIRECTORY_LOCK]).catch(error => { releaseError = error; });
    client.release(releaseError);
  }
}
