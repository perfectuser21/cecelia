/** 官方目录配置入口：固定库族、白名单body、单一缺失Capability库bootstrap。 */
import { notionReq as defaultNotionReq, getToken } from '../recurring-notion-sync.js';
import { buildDirectorySchemas, ensureDirectorySchemas } from './directory-schema.js';
import { buildDirectoryRows, loadDirectorySource } from './directory-source.js';
import { DIRECTORY_LOCK, DIRECTORY_TARGET } from './directory-projector.js';

const UUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const compact = value => String(value || '').replaceAll('-', '').toLowerCase();
const LAYERS = ['areas','value_streams','capabilities','workflows','activities','steps'];
const TABLES = { areas: 'areas', value_streams: 'notion_map_node_pages', capabilities: 'capabilities', workflows: 'workflows', activities: 'activities', steps: 'steps' };
const LEGACY = { workflows: '3d9c40c2-ba63-8145-bfa8-f4c0c006e0af', steps: '3d9c40c2-ba63-8195-a41b-f529056a4aa8' };
const MARKER = 'Brain directory capabilities (journeys.kind=capability)';
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new Error('目录配置含未知字段或非对象');
}
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) throw new Error('目录配置身份必须是UUID'); }

export function validateDirectoryConfig(input) {
  keys(input, ['dbs','parent_page_id','value_stream_bindings','area_bindings']); keys(input.dbs, LAYERS);
  const ids = new Set();
  for (const layer of LAYERS) {
    const id = input.dbs[layer];
    if (layer === 'capabilities' && (id === null || id === undefined)) continue;
    uuid(id); if (ids.has(compact(id))) throw new Error('目录配置数据库重复'); ids.add(compact(id));
  }
  if (input.parent_page_id !== undefined) uuid(input.parent_page_id);
  if (!input.dbs.capabilities && !input.parent_page_id) throw new Error('创建能力目录需要父页身份');
  for (const [name, fields] of [['value_stream_bindings',['journey_id','scope','node_key']], ['area_bindings',['brain_id','notion_id','expected_name']]]) {
    if (input[name] === undefined) continue;
    if (!Array.isArray(input[name]) || input[name].length > 500) throw new Error('目录绑定列表无效');
    for (const row of input[name]) {
      keys(row, name === 'value_stream_bindings' ? [...fields,'expected_node_name','expected_journey_name'] : fields);
      for (const field of fields) if (typeof row[field] !== 'string' || !row[field].trim() || row[field].length > 200) throw new Error('目录绑定字段缺失');
      if (name === 'value_stream_bindings' && (row.expected_node_name !== undefined || row.expected_journey_name !== undefined)) {
        for (const field of ['expected_node_name','expected_journey_name']) if (typeof row[field] !== 'string' || !row[field].trim() || row[field].length > 200) throw new Error('目录名称绑定必须完整');
      }
      if (name === 'value_stream_bindings') uuid(row.journey_id);
      else { uuid(row.brain_id); uuid(row.notion_id); }
    }
  }
  return structuredClone(input);
}

export async function findCapabilityDatabase({ token, parentPageId, notionReq }) {
  const candidates = [], cursors = new Set(); let cursor = null, pages = 0, entries = 0;
  do {
    if (++pages > 100) throw new Error('能力目录父页分页超过上限');
    const response = await notionReq(token, `/blocks/${parentPageId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET');
    if (!Array.isArray(response?.results) || typeof response.has_more !== 'boolean' || response.results.some(b => !b || typeof b !== 'object')) {
      throw new Error('能力目录父页分页snapshot不完整');
    }
    entries += response.results.length;
    if (entries > 10000) throw new Error('能力目录父页条目超过上限');
    candidates.push(...response.results.filter(b => !b.archived && !b.in_trash && b.type === 'child_database' && b.child_database.title === 'Capabilities'));
    if (response.has_more && (typeof response.next_cursor !== 'string' || !response.next_cursor || response.next_cursor.length > 2000 || cursors.has(response.next_cursor))) {
      throw new Error('能力目录父页分页cursor缺失或循环');
    }
    if (!response.has_more && response.next_cursor != null) throw new Error('能力目录父页分页终态cursor无效');
    cursor = response.has_more ? response.next_cursor : null;
    if (cursor) cursors.add(cursor);
  } while (cursor);
  if (candidates.length > 1) throw new Error('能力目录重复，拒绝创建或认领');
  if (!candidates.length) return null;
  const db = await notionReq(token, `/databases/${candidates[0].id}`, 'GET');
  const description = (db.description || []).map(t => t.plain_text ?? t.text?.content ?? '').join('');
  if (db.archived || db.in_trash || compact(db.parent?.page_id) !== compact(parentPageId) || description !== MARKER) throw new Error('能力目录来源身份不符');
  return db.id;
}

async function assertRegistry(client, dbs) {
  const rows = (await client.query('SELECT notion_db_id,brain_table,face,direction,status FROM notion_projection_map')).rows;
  for (const layer of LAYERS.filter(l => l !== 'capabilities')) {
    const matching = rows.filter(r => compact(r.notion_db_id) === compact(dbs[layer]));
    if (!matching.some(r => r.status === 'active' && (r.brain_table === TABLES[layer] ||
      !r.brain_table && LEGACY[layer] && compact(dbs[layer]) === compact(LEGACY[layer])))) throw new Error(`目录库未在正式注册表匹配: ${layer}`);
  }
  const caps = rows.filter(r => r.brain_table === 'capabilities');
  const active = caps.filter(r => r.status === 'active');
  if (active.length) {
    if (active.length !== 1 || dbs.capabilities && compact(active[0].notion_db_id) !== compact(dbs.capabilities)) throw new Error('能力正式目录已存在，禁止重复建库');
    dbs.capabilities ||= active[0].notion_db_id;
  } else if (!caps.some(r => r.notion_db_id === 'unmapped:capabilities' && r.status === 'archived' && r.direction === 'none')) throw new Error('缺少能力目录未映射的正式登记');
  return active.length > 0;
}

/** 创建前只读预检其余五库；不能用虚拟Capability ID补列。 */
async function preflightBeforeCreate(dbs, token, notionReq) {
  const schemas = buildDirectorySchemas({ ...dbs, capabilities: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
  for (const layer of LAYERS.filter(l => l !== 'capabilities')) {
    const db = await notionReq(token, `/databases/${dbs[layer]}`, 'GET');
    if (compact(db.id) !== compact(dbs[layer]) || db.archived || db.in_trash) throw new Error('目录库不存在或已归档');
    for (const [name, expected] of Object.entries(schemas[layer])) {
      const have = db.properties?.[name]; if (!have) continue;
      const type = Object.keys(expected)[0];
      if (have.type !== type || type === 'relation' && compact(have.relation?.database_id) !== compact(expected.relation.database_id)) throw new Error(`目录预检属性冲突: ${layer}.${name}`);
    }
  }
}

export async function configureDirectoryProjection(pool, input, { token, notionReq = defaultNotionReq } = {}) {
  const config = validateDirectoryConfig(input), client = await pool.connect(); let locked = false, tx = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock($1) AS locked', [DIRECTORY_LOCK])).rows[0]?.locked;
    if (!locked) throw new Error('目录投影正在运行');
    token ||= getToken();
    const registered = await assertRegistry(client, config.dbs);
    buildDirectoryRows(await loadDirectorySource(client), config); // 先核显式VS来源，失败零外部写
    if (registered && config.parent_page_id) {
      const found = await findCapabilityDatabase({ token, parentPageId: config.parent_page_id, notionReq });
      if (compact(found) !== compact(config.dbs.capabilities)) throw new Error('能力正式目录父页来源不匹配');
    }
    if (!registered) {
      if (!config.parent_page_id) throw new Error('能力目录认领需要父页证据');
      const found = await findCapabilityDatabase({ token, parentPageId: config.parent_page_id, notionReq });
      if (config.dbs.capabilities && compact(found) !== compact(config.dbs.capabilities)) throw new Error('能力目录父页证据不匹配');
      if (found) config.dbs.capabilities = found;
      else {
        await preflightBeforeCreate(config.dbs, token, notionReq);
        const created = await notionReq(token, '/databases', 'POST', { parent: { page_id: config.parent_page_id },
          title: [{ type: 'text', text: { content: 'Capabilities' } }],
          description: [{ type: 'text', text: { content: MARKER } }], properties: { '名称': { title: {} } } });
        uuid(created.id); config.dbs.capabilities = created.id;
        const verified = await findCapabilityDatabase({ token, parentPageId: config.parent_page_id, notionReq });
        if (compact(verified) !== compact(created.id)) throw new Error('能力目录创建后父页读回不一致');
      }
    }
    await ensureDirectorySchemas({ dbs: config.dbs, token, notionReq });
    await client.query('BEGIN'); tx = true;
    await assertRegistry(client, config.dbs);
    for (const layer of LAYERS) {
      if (layer === 'capabilities' && !registered) {
        await client.query(`INSERT INTO notion_projection_map(notion_db_id,title,face,brain_table,direction,vessel,status,space)
          VALUES($1,'Capabilities','mirror','capabilities','push','directory-projection','active','system')`, [config.dbs[layer]]);
      } else if (['workflows','steps'].includes(layer)) {
        await client.query(`UPDATE notion_projection_map SET face='mirror',brain_table=$2,direction='push',vessel='directory-projection'
          WHERE replace(notion_db_id,'-','')=$1 AND (brain_table IS NULL OR brain_table=$2)`, [compact(config.dbs[layer]), TABLES[layer]]);
      }
    }
    await client.query(`INSERT INTO projection_targets(target,enabled,config,updated_at) VALUES($1,true,$2::jsonb,NOW())
      ON CONFLICT(target) DO UPDATE SET enabled=true,config=EXCLUDED.config,last_success_at=NULL,last_error=NULL,updated_at=NOW()`, [DIRECTORY_TARGET, JSON.stringify(config)]);
    await client.query('COMMIT'); tx = false;
    return { configured: true, dbs: config.dbs };
  } catch (error) { if (tx) await client.query('ROLLBACK'); throw error; }
  finally { if (locked) await client.query('SELECT pg_advisory_unlock($1)', [DIRECTORY_LOCK]).catch(() => {}); client.release(); }
}
