/** Areas是人工组织入口；读取完整树后事务回灌，只写Brain，不反写人工属性。 */
import { randomUUID } from 'node:crypto';

const UUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const normalize = value => String(value ?? '').replaceAll('-', '').toLowerCase();
const plain = values => (values || []).map(value => value.plain_text ?? value.text?.content ?? '').join('');
function id(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('directory_areas:invalid_id');
  const s = normalize(value);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export async function readDirectoryAreas({ token, dbId, notionReq }) {
  id(dbId);
  const rows = [], seen = new Set(), cursors = new Set();
  let cursor;
  do {
    const response = await notionReq(token, `/databases/${dbId}/query`, 'POST', {
      page_size: 100, ...(cursor ? { start_cursor: cursor } : {}),
    });
    if (!Array.isArray(response?.results)) throw new Error('directory_areas:invalid_snapshot');
    for (const page of response.results) {
      if (normalize(page.parent?.database_id) !== normalize(dbId) || page.archived || page.in_trash) {
        throw new Error('directory_areas:wrong_database_or_archived_page');
      }
      const notionId = id(page.id), props = page.properties ?? {}, parents = props['Parent item'];
      if (seen.has(notionId)) throw new Error('directory_areas:duplicate_page');
      seen.add(notionId);
      if (!Array.isArray(props.Name?.title) || !Array.isArray(parents?.relation) || parents.has_more || parents.relation.length > 1) {
        throw new Error('directory_areas:incomplete_name_or_parent');
      }
      const name = plain(props.Name.title).trim();
      if (!name || name.length > 255) throw new Error('directory_areas:invalid_name');
      if (typeof props.Archive?.checkbox !== 'boolean') throw new Error('directory_areas:missing_archive');
      rows.push({ notion_id: notionId, name, parent_notion_id: parents.relation.length ? id(parents.relation[0].id) : null,
        archived: props.Archive.checkbox, domain: props.Domain?.select?.name ?? null });
      if (rows.length > 10000) throw new Error('directory_areas:snapshot_too_large');
    }
    if (!response.has_more) break;
    if (!response.next_cursor || cursors.has(response.next_cursor)) throw new Error('directory_areas:pagination_incomplete');
    cursor = response.next_cursor; cursors.add(cursor);
  } while (cursor);
  if (!rows.length) throw new Error('directory_areas:empty_snapshot');
  validateTree(rows);
  return rows;
}

function validateTree(rows) {
  const byId = new Map(rows.map(row => [row.notion_id, row]));
  for (const row of rows) {
    const seen = new Set(); let current = row;
    while (current) {
      if (seen.has(current.notion_id)) throw new Error('directory_areas:parent_cycle');
      seen.add(current.notion_id);
      if (!current.parent_notion_id) break;
      current = byId.get(current.parent_notion_id);
      if (!current) throw new Error('directory_areas:missing_parent');
    }
  }
}

/** 旧Brain无notion_id时须明确指定身份，不以同名猜测；绑定后改名仍保原UUID。 */
function planAreas(existing, source, bindings) {
  const sourceById = new Map(source.map(row => [row.notion_id, row]));
  const byBrain = new Map(existing.map(row => [row.id, row]));
  const byNotion = new Map();
  for (const row of existing) if (row.notion_id) {
    const key = id(row.notion_id);
    if (byNotion.has(key)) throw new Error('directory_areas:duplicate_existing_notion_id');
    byNotion.set(key, row);
  }
  const boundBrains = new Set(), boundPages = new Set();
  for (const binding of bindings) {
    const brainId = id(binding.brain_id), notionId = id(binding.notion_id);
    if (boundBrains.has(brainId) || boundPages.has(notionId)) throw new Error('directory_areas:duplicate_binding');
    boundBrains.add(brainId); boundPages.add(notionId);
    const before = byBrain.get(brainId), incoming = sourceById.get(notionId);
    if (!before || !incoming) throw new Error('directory_areas:binding_target_missing');
    if ((before.notion_id && id(before.notion_id) !== notionId) || (byNotion.has(notionId) && byNotion.get(notionId).id !== brainId)) {
      throw new Error('directory_areas:binding_identity_conflict');
    }
    if (!before.notion_id && (!binding.expected_name || before.name !== binding.expected_name || incoming.name !== binding.expected_name)) {
      throw new Error('directory_areas:binding_name_mismatch');
    }
    byNotion.set(notionId, before);
  }
  const plan = source.map(row => {
    const before = byNotion.get(row.notion_id);
    if (!before && existing.some(old => old.name === row.name && !old.notion_id)) throw new Error(`directory_areas:binding_required:${row.name}`);
    return { ...row, id: before?.id ?? randomUUID(), before: before ?? null };
  });
  const ids = new Map(plan.map(row => [row.notion_id, row.id]));
  for (const row of plan) row.parent_area_id = row.parent_notion_id ? ids.get(row.parent_notion_id) : null;
  return plan;
}

export async function syncDirectoryAreas(pool, { token, dbId, notionReq, bindings = [], actor }) {
  if (typeof actor !== 'string' || !actor.trim() || actor.length > 255) throw new Error('directory_areas:actor_required');
  if (!Array.isArray(bindings)) throw new Error('directory_areas:invalid_bindings');
  const source = await readDirectoryAreas({ token, dbId, notionReq });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('directory-areas-ingest'))");
    await client.query('LOCK TABLE areas IN SHARE ROW EXCLUSIVE MODE');
    const existing = (await client.query('SELECT * FROM areas')).rows;
    const plan = planAreas(existing, source, bindings), changes = [];
    // 先创建身份，再更新父关系，顺序不依赖Notion页面排序。
    for (const row of plan) if (!row.before) {
      await client.query('INSERT INTO areas(id,name,domain,archived,notion_id) VALUES($1,$2,$3,$4,$5)',
        [row.id, row.name, row.domain, row.archived, row.notion_id]);
    }
    for (const row of plan) {
      const before = row.before;
      const after = { name: row.name, archived: row.archived, notion_id: row.notion_id, parent_area_id: row.parent_area_id };
      if (before && Object.entries(after).every(([key, value]) => before[key] === value)) continue;
      await client.query(`UPDATE areas SET name=$2,archived=$3,notion_id=$4,parent_area_id=$5,
        notion_props=COALESCE(notion_props,'{}'::jsonb) || jsonb_build_object('directory_source',$6::jsonb),
        notion_synced_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [row.id, row.name, row.archived, row.notion_id, row.parent_area_id, JSON.stringify(source.find(s => s.notion_id === row.notion_id))]);
      changes.push({ id: row.id, before: before ? Object.fromEntries(Object.keys(after).map(key => [key, before[key]])) : null, after });
    }
    let eventId = null;
    if (changes.length) eventId = (await client.query(`INSERT INTO cecelia_events(event_type,source,payload)
      VALUES('directory_areas_ingested','directory-projection',$1) RETURNING id`, [JSON.stringify({ actor, database_id: dbId, changes })])).rows[0].id;
    await client.query('COMMIT');
    return { read: source.length, changed: changes.length, event_id: eventId };
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
}
