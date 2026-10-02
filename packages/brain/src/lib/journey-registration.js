/** Journey/Capability 共用稳定身份；登记主体、层级和步骤必须同事务。 */
import { readJourneyOrganization } from './journey-organization.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = ['user_facing', 'autonomous', 'dev_pipeline', 'agent_remote'];
const HOMES = ['biz', 'pre', 'xcut', 'factory'];
const FIELDS = ['name', 'journey_type', 'description', 'maturity', 'status', 'e2e_test_path', 'area_id',
  'home', 'domain', 'trigger', 'endpoint', 'parent_journey_id', 'capability_code'];
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

function validate(body, id) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '请求体必须是对象');
  if (id !== undefined && !UUID.test(id)) fail(400, 'journey id 必须是 uuid');
  if ((id === undefined || body.name !== undefined) && (typeof body.name !== 'string' || !body.name.trim())) fail(400, 'name is required');
  if ((id === undefined || body.journey_type !== undefined) && !TYPES.includes(body.journey_type)) fail(400, `journey_type must be one of: ${TYPES.join(',')}`);
  if (body.home && !HOMES.includes(body.home)) fail(400, `home must be one of: ${HOMES.join(',')}`);
  for (const field of ['parent_journey_id', 'area_id']) {
    if (body[field] !== undefined && body[field] !== null && (typeof body[field] !== 'string' || !UUID.test(body[field]))) fail(400, `${field} 必须是 uuid 或 null`);
  }
  if (body.capability_code !== undefined && body.capability_code !== null && (typeof body.capability_code !== 'string' || !body.capability_code.trim())) fail(400, 'capability_code 必须是非空字符串或 null');
  if (body.steps !== undefined && (!Array.isArray(body.steps) || body.steps.some(s => typeof s !== 'string' || !s.trim()))) fail(400, 'steps 必须是非空名称组成的数组');
}

async function resolveArea(client, body) {
  if (body.area_id !== undefined) {
    if (body.area_id !== null && !(await client.query('SELECT id FROM areas WHERE id=$1', [body.area_id])).rows.length) fail(404, 'area 不存在');
    return body.area_id;
  }
  if (body.area) return (await client.query('SELECT id FROM areas WHERE name=$1 LIMIT 1', [body.area])).rows[0]?.id ?? null;
  return undefined;
}

async function validateHierarchy(client, id, parentId) {
  if (parentId !== null) {
    if (id && parentId === id) fail(400, '禁止 journey 自指');
    const parent = (await client.query('SELECT id,parent_journey_id FROM journeys WHERE id=$1', [parentId])).rows[0];
    if (!parent) fail(404, '父价值流不存在');
    if (parent.parent_journey_id !== null) fail(400, '父级必须是 value_stream，禁止 capability 嵌套或环');
    if (id && (await client.query('SELECT 1 FROM journeys WHERE parent_journey_id=$1 LIMIT 1', [id])).rows.length) fail(409, '已有子能力，不能将价值流降级');
  } else if (id && (await client.query('SELECT 1 FROM workflows WHERE capability_id=$1 LIMIT 1', [id])).rows.length) {
    fail(409, '已有工作流的能力不能脱离父价值流');
  }
}

export async function registerJourney(pool, body, id) {
  validate(body, id);
  const data = Object.fromEntries(FIELDS.filter(field => body[field] !== undefined).map(field => [field, body[field]]));
  if (id !== undefined && !Object.keys(data).length && !body.area) fail(400, 'no fields to update');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 拓扑写入低频；表锁同时覆盖其它写者，避免只锁现有子行漏掉并发插入。
    await client.query('LOCK TABLE journeys, workflows, areas IN SHARE ROW EXCLUSIVE MODE');
    const existing = id === undefined ? null : (await client.query('SELECT * FROM journeys WHERE id=$1', [id])).rows[0];
    if (id !== undefined && !existing) fail(404, 'journey 不存在');
    const areaId = await resolveArea(client, body);
    if (areaId !== undefined) data.area_id = areaId;
    const parentId = data.parent_journey_id === undefined ? (existing?.parent_journey_id ?? null) : data.parent_journey_id;
    await validateHierarchy(client, id, parentId);
    let row;
    if (id === undefined) {
      const values = { description: null, maturity: 'not_started', status: 'active', e2e_test_path: null,
        area_id: null, home: null, trigger: null, endpoint: null, ...data };
      const columns = Object.keys(values);
      row = (await client.query(`INSERT INTO journeys (${columns.join(',')},notion_synced_at)
        VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')},NULL) RETURNING *`, Object.values(values))).rows[0];
      for (const [i, name] of (body.steps || []).entries()) {
        await client.query('INSERT INTO journey_steps(journey_id,name,step_number,notion_synced_at) VALUES($1,$2,$3,NULL)', [row.id, name, i + 1]);
      }
    } else {
      const columns = Object.keys(data);
      row = (await client.query(`UPDATE journeys SET ${columns.map((column, i) => `${column}=$${i + 1}`).join(',')},updated_at=NOW(),notion_synced_at=NULL
        WHERE id=$${columns.length + 1} RETURNING *`, [...Object.values(data), id])).rows[0];
    }
    const organization = await readJourneyOrganization(client, row.id);
    if (organization?.gaps.some(gap => gap !== 'area_unknown')) fail(400, `组织层级无效: ${organization.gaps.join(',')}`);
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK');
    if (!error.status) error.status = error.code === '23505' ? 409 : error.code === '23503' ? 404 : ['23514', '23502', '22P02'].includes(error.code) ? 400 : 500;
    throw error;
  } finally { client.release(); }
}
