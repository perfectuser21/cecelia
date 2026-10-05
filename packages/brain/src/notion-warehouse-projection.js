/**
 * notion-warehouse-projection.js — 仓库物件库 + 用料库（树+仓库 v3.0 第 3 刀 c 段）
 *
 * 仓库只有一张表 warehouse_items，shelf 分八个货架；用料 activity_uses 记「哪个 Activity 用了哪件物件」。
 * 两张表单向（Brain 真身 → Notion）投影，走统一引擎 pushRegisteredRows（指纹去重 / PATCH 或 POST / 记账列回写）。
 *
 * 库的来历：Notion 里缺库就在目录父页下建（带来源标记，认领已有同名同标记的库，绝不重复建），建好登记进
 * notion_projection_map（push/active）。库 id 只认注册表；Notion 上手改这些库的列会被下一轮覆盖，
 * 改仓库请改 Brain 真身（合同/沉淀技能），Notion 自动跟。
 *
 * 货架视图：Notion API 不能建「按货架过滤的视图」，库里有「货架」选项列（8 个中文货架，带色），
 * 在 Notion 里按这一列分组/过滤就是 8 个货架视图。
 */
import { notionReq as defaultNotionReq } from './recurring-notion-sync.js';
import { pushRegisteredRows, resolveDbId, isWrongDatabaseError } from './lib/notion-projection-engine.js';
import { ensureOpsDbProps } from './ops-quota-notion.js';

const RT_MAX = 1900;
export const MARKERS = Object.freeze({
  warehouse_items: 'Brain warehouse_items（仓库物件，v3.0）',
  activity_uses: 'Brain activity_uses（Activity 用料，v3.0）',
});
export const SHELF_LABELS = Object.freeze({
  platform_action: '平台动作', generic_action: '通用动作', data: '数据', service: '服务',
  ui: '界面', infrastructure: '基础设施', external_dependency: '外部依赖', account_secret: '账号与密钥',
});
const SHELF_COLORS = ['blue', 'purple', 'green', 'orange', 'pink', 'gray', 'yellow', 'red'];
const VESSELS = Object.freeze({
  warehouse_items: 'notion-warehouse-projection.pushWarehouseItems',
  activity_uses: 'notion-warehouse-projection.pushActivityUses',
});
const TITLES = Object.freeze({ warehouse_items: '仓库物件', activity_uses: '用料' });

const rt = text => (text === null || text === undefined || text === '' ? [] : [{ type: 'text', text: { content: String(text).slice(0, RT_MAX) } }]);
const rich = text => ({ rich_text: rt(text) });
const sel = value => ({ select: { name: String(value ?? 'unknown').slice(0, 100) } });

/** warehouse_items 一行（used_by = 用到它的 Activity 名数组）→「仓库物件」库属性。 */
export function buildWarehouseItemProps(r) {
  return {
    Name: { title: rt(r.name) },
    Key: rich(r.key),
    '货架': sel(SHELF_LABELS[r.shelf] ?? r.shelf),
    '种类': sel(r.kind),
    '实现位置': rich(r.impl_ref),
    '负责人': rich(r.owner),
    '说明': rich(r.description),
    '失败语义': rich(r.failure_semantics),
    '保质期(天)': { number: Number.isFinite(r.shelf_life_days) ? r.shelf_life_days : null },
    '启用': { checkbox: r.active !== false },
    '来源': rich([r.source_table, r.source_ref].filter(Boolean).join(' / ')),
    '被用于': rich((r.used_by || []).join('；')),
    'Brain ID': rich(r.id),
  };
}

/** activity_uses 一行（含 Activity/物件名与两边的 Notion 页 id）→「用料」库属性。 */
export function buildActivityUseProps(r) {
  return {
    '名称': { title: rt(`${r.activity_name} ← ${r.item_name}`) },
    Activity: { relation: r.activity_page_id ? [{ id: r.activity_page_id }] : [] },
    '物件': { relation: r.item_page_id ? [{ id: r.item_page_id }] : [] },
    '角色': sel(r.role),
    '断言引用': rich(r.assertion_ref),
    '格子状态': sel(r.cell_status),
    'Brain ID': rich(r.id),
  };
}

export const WAREHOUSE_DB_PROPS = Object.freeze({
  Name: { title: {} }, Key: { rich_text: {} },
  '货架': { select: { options: Object.values(SHELF_LABELS).map((name, i) => ({ name, color: SHELF_COLORS[i] })) } },
  '种类': { select: {} }, '实现位置': { rich_text: {} }, '负责人': { rich_text: {} }, '说明': { rich_text: {} },
  '失败语义': { rich_text: {} }, '保质期(天)': { number: {} }, '启用': { checkbox: {} }, '来源': { rich_text: {} },
  '被用于': { rich_text: {} }, 'Brain ID': { rich_text: {} },
});
export const USES_DB_PROPS = ({ activities, warehouse }) => ({
  '名称': { title: {} },
  Activity: { relation: { database_id: activities, single_property: {} } },
  '物件': { relation: { database_id: warehouse, single_property: {} } },
  '角色': { select: {} }, '断言引用': { rich_text: {} }, '格子状态': { select: {} }, 'Brain ID': { rich_text: {} },
});

const compact = id => String(id || '').replaceAll('-', '').toLowerCase();

async function parentPageId(pool) {
  const { rows } = await pool.query(`SELECT config FROM projection_targets WHERE target = 'notion-directory'`);
  return rows[0]?.config?.parent_page_id || null;
}

/** 在目录父页下找同名且来源标记吻合的库；多个或标记/父页不符一律拒绝认领（宁可不推也不乱认）。 */
async function findClaimable({ token, parentId, table, notionReq }) {
  const found = [];
  let cursor = null;
  do {
    const page = await notionReq(token, `/blocks/${parentId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET');
    for (const b of page.results || []) if (b.type === 'child_database' && b.child_database?.title === TITLES[table]) found.push(b.id);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  if (found.length === 0) return null;
  if (found.length > 1) throw new Error(`${TITLES[table]} 库在目录父页下重复，拒绝认领`);
  const db = await notionReq(token, `/databases/${found[0]}`, 'GET');
  const marker = (db.description || []).map(t => t.plain_text ?? t.text?.content ?? '').join('');
  if (db.archived || db.in_trash || compact(db.parent?.page_id) !== compact(parentId) || marker !== MARKERS[table]) {
    throw new Error(`${TITLES[table]} 库来源标记或父页不符，拒绝认领`);
  }
  return found[0];
}

async function register(pool, dbId, table) {
  await pool.query(
    `INSERT INTO notion_projection_map(notion_db_id, title, brain_table, vessel, face, direction, status, space)
     SELECT $1, $2, $3, $4, 'mirror', 'push', 'active', 'system'
      WHERE NOT EXISTS (SELECT 1 FROM notion_projection_map WHERE notion_db_id = $1 AND brain_table = $3)`,
    [dbId, TITLES[table], table, VESSELS[table]]);
  // 迁移 524 给这两张表留的「待建库」占位行，真库登记后就没用了（留着会和真行互相矛盾）
  await pool.query(`DELETE FROM notion_projection_map WHERE notion_db_id = 'unmapped:' || $1 AND brain_table = $1`, [table]);
}

/**
 * 缺库才建：注册表 active 行 → 认领父页下同名同标记库 → 新建。建/认领后登记 push/active。
 * 前提不足（无目录父页、Activity 库未知）返回 null，不建任何库。
 * @returns {Promise<{warehouse:string, uses:string}|null>}
 */
export async function ensureWarehouseDatabases(pool, token, { notionReq = defaultNotionReq, resolveActivities = p => resolveDbId(p, 'activities') } = {}) {
  let warehouse = await resolveDbId(pool, 'warehouse_items');
  let uses = await resolveDbId(pool, 'activity_uses');
  if (warehouse && uses) return { warehouse, uses };
  const parentId = await parentPageId(pool);
  const activities = await resolveActivities(pool);
  if (!parentId || !activities) return null;

  const make = async (table, properties) => {
    const claimed = await findClaimable({ token, parentId, table, notionReq });
    const dbId = claimed || (await notionReq(token, '/databases', 'POST', {
      parent: { page_id: parentId },
      title: [{ type: 'text', text: { content: TITLES[table] } }],
      description: [{ type: 'text', text: { content: MARKERS[table] } }],
      properties,
    })).id;
    await register(pool, dbId, table);
    return dbId;
  };
  if (!warehouse) warehouse = await make('warehouse_items', WAREHOUSE_DB_PROPS);
  if (!uses) uses = await make('activity_uses', USES_DB_PROPS({ activities, warehouse }));
  return { warehouse, uses };
}

async function ensureCols(pool, token, dbId, props, label, { notionReq, logSyncError }) {
  try {
    const { added } = await ensureOpsDbProps(token, dbId, props, { notionReq });
    if (added.length) console.log(`[warehouse-projection] ${label} 补列: ${added.join(', ')}`);
  } catch (err) {
    await logSyncError(pool, `[warehouse-projection] ${label} 补列失败: ${err.message}`);
  }
}

const ROW_LIMIT = 200;

/** 仓库物件全量（二十来件）：指纹没变不打 Notion；被用于随用料变化。 */
export async function pushWarehouseItems(pool, token, dbId, deps = {}) {
  const { notionReq = defaultNotionReq, logSyncError = async () => {} } = deps;
  const { rows } = await pool.query(
    `SELECT i.*, COALESCE((SELECT array_agg(DISTINCT a.name ORDER BY a.name) FROM activity_uses u JOIN activities a ON a.id = u.activity_id
                            WHERE u.item_id = i.id), '{}') AS used_by
       FROM warehouse_items i ORDER BY i.shelf, i.name LIMIT ${ROW_LIMIT}`);
  return pushRegisteredRows(pool, token, {
    table: 'warehouse_items', dbId, rows, buildProps: buildWarehouseItemProps,
    notionReq, logSyncError, isWrongDatabaseError, label: 'warehouse_item',
  });
}

/** 用料：两边页面都已建好才推（relation 需要页 id）；Activity 页 id 取旧列或目录投影链接。 */
export async function pushActivityUses(pool, token, dbId, deps = {}) {
  const { notionReq = defaultNotionReq, logSyncError = async () => {} } = deps;
  const { rows } = await pool.query(
    `SELECT u.*, a.name AS activity_name, i.name AS item_name, i.notion_id AS item_page_id,
            COALESCE(a.notion_id, pl.external_id) AS activity_page_id
       FROM activity_uses u
       JOIN activities a ON a.id = u.activity_id
       JOIN warehouse_items i ON i.id = u.item_id
       LEFT JOIN projection_links pl ON pl.target = 'notion-directory' AND pl.entity_type = 'activities' AND pl.entity_id = a.id
      WHERE i.notion_id IS NOT NULL AND COALESCE(a.notion_id, pl.external_id) IS NOT NULL
      ORDER BY u.created_at LIMIT ${ROW_LIMIT}`);
  return pushRegisteredRows(pool, token, {
    table: 'activity_uses', dbId, rows, buildProps: buildActivityUseProps,
    notionReq, logSyncError, isWrongDatabaseError, label: 'activity_use',
  });
}

/** 一轮：建/认领库 → 补列 → 先推物件（拿到页 id）再推用料。库前提不足整段跳过，失败只记日志（Postgres 才是真相）。 */
export async function runWarehouseProjection(pool, { token, notionReq = defaultNotionReq, logSyncError = async () => {} } = {}) {
  const dbs = await ensureWarehouseDatabases(pool, token, { notionReq });
  if (!dbs) return null;
  const deps = { notionReq, logSyncError };
  const activities = await resolveDbId(pool, 'activities');
  await ensureCols(pool, token, dbs.warehouse, WAREHOUSE_DB_PROPS, '仓库物件', deps);
  await ensureCols(pool, token, dbs.uses, USES_DB_PROPS({ activities, warehouse: dbs.warehouse }), '用料', deps);
  const items = await pushWarehouseItems(pool, token, dbs.warehouse, deps);
  const usesStat = await pushActivityUses(pool, token, dbs.uses, deps);
  return { items, uses: usesStat };
}
