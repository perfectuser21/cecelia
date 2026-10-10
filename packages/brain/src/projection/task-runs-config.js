/** 正式 task_runs 镜子入口；启用必须显式，旧 Ops Runs 与其它来源永不抢占。 */
import { getToken, notionReq as defaultNotionReq } from '../recurring-notion-sync.js';
import { OPS_DB_PROPS, diffMissingProps } from '../ops-notion-schema.js';

const UUID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
export const TASK_RUNS_VESSEL = 'notion-push-sync.pushTaskRuns';
export const TASK_RUNS_TITLE = '代码运行记录';
export const TASK_RUNS_MARKER = 'Brain task_runs（确定性代码及任务执行记录）';
const compact = id => String(id).replaceAll('-', '').toLowerCase();
const text = value => (value || []).map(t => t.plain_text ?? t.text?.content ?? '').join('');

export function validateTaskRunsConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(k => !['database_id', 'parent_page_id', 'enabled', 'actor'].includes(k))) throw Error('Runs 配置包含未知字段');
  if (input.enabled !== true) throw Error('Runs 投影需要显式 enabled=true');
  if (typeof input.actor !== 'string' || !input.actor.trim() || input.actor.length > 200) throw Error('Runs 配置缺少 actor');
  if (Boolean(input.database_id) === Boolean(input.parent_page_id)) throw Error('database_id 与 parent_page_id 必须二选一');
  if (!UUID.test(input.database_id || input.parent_page_id)) throw Error('Runs 配置身份必须是 UUID');
  return { ...input, actor: input.actor.trim() };
}

async function readRegistry(client) {
  return (await client.query(`SELECT notion_db_id,brain_table,vessel,face,status FROM notion_projection_map`)).rows;
}
function assertOwnership(rows, target) {
  const own = rows.filter(r => r.brain_table === 'task_runs' && r.status === 'active');
  if (own.length > 1 || own.some(r => !target || compact(r.notion_db_id) !== compact(target))) throw Error('已存在另一个 active Runs 库');
  if (!target) return;
  const matches = rows.filter(r => compact(r.notion_db_id) === compact(target));
  if (matches.some(r => r.brain_table !== 'task_runs' || r.vessel !== TASK_RUNS_VESSEL || r.face !== 'mirror')) throw Error('目标库已有其它归属，拒绝抢占');
}
function assertDatabase(db, id) {
  if (compact(db?.id) !== compact(id) || db.archived || db.in_trash || !db.properties) throw Error('Runs 库不可达或身份不符');
  for (const [name, shape] of Object.entries(OPS_DB_PROPS.task_runs)) {
    const type = Object.keys(shape)[0];
    if (db.properties[name] && db.properties[name].type !== type) throw Error(`Runs 属性类型冲突: ${name}`);
  }
  if (Object.entries(db.properties).some(([name, prop]) => prop.type === 'title' && name !== 'Name')) throw Error('Runs 标题列必须是 Name');
}

/** 完整有界分页；未知/循环不能当成库不存在。 */
async function findDatabase(token, parent, notionReq) {
  const found = [], seen = new Set(); let cursor = null;
  for (let pageNo = 0; pageNo < 100; pageNo++) {
    const page = await notionReq(token, `/blocks/${parent}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET');
    if (!Array.isArray(page?.results) || typeof page.has_more !== 'boolean' || page.results.length > 100) throw Error('Runs 父页分页不完整');
    found.push(...page.results.filter(b => !b.archived && !b.in_trash && b.type === 'child_database' && b.child_database?.title === TASK_RUNS_TITLE));
    if (!page.has_more) {
      if (page.next_cursor != null) throw Error('Runs 父页分页终态不完整');
      if (found.length > 1) throw Error('Runs 父页出现重复库');
      if (!found.length) return null;
      const db = await notionReq(token, `/databases/${found[0].id}`, 'GET');
      if (compact(db.parent?.page_id) !== compact(parent) || text(db.description) !== TASK_RUNS_MARKER) throw Error('Runs 既有库来源不符');
      assertDatabase(db, found[0].id); return db.id;
    }
    if (typeof page.next_cursor !== 'string' || !page.next_cursor || page.next_cursor.length > 2000 || seen.has(page.next_cursor)) throw Error('Runs 父页分页 cursor 缺失或循环');
    cursor = page.next_cursor; seen.add(cursor);
  }
  throw Error('Runs 父页分页超过上限');
}

export async function configureTaskRunsProjection(pool, input, { token, notionReq = defaultNotionReq } = {}) {
  const config = validateTaskRunsConfig(input), client = await pool.connect(); let locked = false, tx = false;
  try {
    // session lock 横跨远程创建，避免两个 bootstrap 各建一库。
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [TASK_RUNS_VESSEL]); locked = true;
    const rows = await readRegistry(client);
    let target = config.database_id;
    if (!target && rows.some(r => r.brain_table === 'task_runs' && r.status === 'active')) {
      target = rows.find(r => r.brain_table === 'task_runs' && r.status === 'active').notion_db_id;
    }
    assertOwnership(rows, target);
    token ||= getToken();
    if (!target) {
      target = await findDatabase(token, config.parent_page_id, notionReq);
      if (!target) {
        const created = await notionReq(token, '/databases', 'POST', {
          parent: { page_id: config.parent_page_id }, title: [{ type: 'text', text: { content: TASK_RUNS_TITLE } }],
          description: [{ type: 'text', text: { content: TASK_RUNS_MARKER } }], properties: OPS_DB_PROPS.task_runs,
        });
        if (!UUID.test(created?.id)) throw Error('Runs 创建未返回身份');
        target = created.id;
      }
    }
    assertOwnership(rows, target);
    let db = await notionReq(token, `/databases/${target}`, 'GET');
    assertDatabase(db, target);
    if (config.parent_page_id && (compact(db.parent?.page_id) !== compact(config.parent_page_id) || text(db.description) !== TASK_RUNS_MARKER)) throw Error('Runs 父页来源不符');
    const missing = diffMissingProps(db.properties, OPS_DB_PROPS.task_runs);
    if (Object.keys(missing).length) {
      await notionReq(token, `/databases/${target}`, 'PATCH', { properties: missing });
      db = await notionReq(token, `/databases/${target}`, 'GET');
      assertDatabase(db, target);
      if (Object.keys(diffMissingProps(db.properties, OPS_DB_PROPS.task_runs)).length) throw Error('Runs 补列读回不完整');
    }
    await client.query('BEGIN'); tx = true;
    assertOwnership(await readRegistry(client), target);
    const inserted = await client.query(`INSERT INTO notion_projection_map(notion_db_id,title,face,brain_table,direction,vessel,status,space,notes)
      VALUES($1,$2,'mirror','task_runs','push',$3,'active','system',$4)
      ON CONFLICT(notion_db_id,COALESCE(brain_table,'')) DO UPDATE SET direction='push',status='active',updated_at=NOW()
      WHERE notion_projection_map.brain_table='task_runs' AND notion_projection_map.vessel=$3 AND notion_projection_map.face='mirror'
      RETURNING notion_db_id`, [db.id, TASK_RUNS_TITLE, TASK_RUNS_VESSEL, `显式启用；actor=${config.actor}`]);
    if (!inserted.rowCount) throw Error('Runs 登记归属冲突');
    await client.query('COMMIT'); tx = false;
    return { database_id: db.id, url: `https://www.notion.so/${compact(db.id)}`, vessel: TASK_RUNS_VESSEL, status: 'active', enabled: true };
  } catch (error) {
    if (tx) await client.query('ROLLBACK'); throw error;
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [TASK_RUNS_VESSEL]).catch(() => {});
    client.release();
  }
}
