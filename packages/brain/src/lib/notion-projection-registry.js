/**
 * notion-projection-registry.js — Notion 投影注册表（三面模型，决策 297ffee5）
 *
 * 血管注册制：每个 Notion 编制库在 notion_projection_map 登记「面 / 对应表 / 方向 / 血管」。
 *   mirror 🔒 只有 Brain 写，人只看（push）
 *   inlet  ✍️ 人/ChatGPT/员工写，Brain 收（ingest；冲突人赢留痕）
 *   truth  📚 Notion 即真身（知识三库 + 内容链），Brain 只存索引
 * 有 notion_id 列却未登记 = 守夜报红（findUnregisteredNotionTables 是 PR③ 遍历对账的口径来源）。
 *
 * 命名刻意避开 lib/map-* 与 map_projection_*——那是产品承诺地图，与本注册表无关。
 */

export const FACES = ['mirror', 'inlet', 'truth'];
export const FACE_ICON = Object.freeze({ mirror: '🔒', inlet: '✍️', truth: '📚' });
export const DIRECTIONS = ['push', 'ingest', 'both', 'none'];

export function assertFace(face) {
  if (!FACES.includes(face)) throw new Error(`invalid face: ${face}（合法值 ${FACES.join('/')}）`);
  return face;
}

/** Notion id 带/不带连字符视为同一库：统一去连字符小写 */
export function normalizeNotionId(id) {
  return String(id || '').replace(/-/g, '').toLowerCase();
}

/**
 * 读全部登记，返回 { rows, byFace, byTable, byNotionId }。
 * @param {{query: Function}} pool
 */
export async function loadProjectionMap(pool) {
  const { rows } = await pool.query(
    `SELECT notion_db_id, title, face, brain_table, direction, vessel, status, space, reconcile, notes
       FROM notion_projection_map
      ORDER BY face, title`);
  const byFace = { mirror: [], inlet: [], truth: [] };
  const byTable = new Map();
  const byNotionId = new Map();
  for (const r of rows) {
    if (byFace[r.face]) byFace[r.face].push(r);
    if (r.brain_table && !byTable.has(r.brain_table)) byTable.set(r.brain_table, r);
    byNotionId.set(normalizeNotionId(r.notion_db_id), r);
  }
  return { rows, byFace, byTable, byNotionId };
}

/**
 * 守夜口径：带 notion_id 列却未在注册表登记的表（按名排序）。
 * 注册表用 brain_table 归属；一表多库（knowledge 三库）算已登记。
 */
export async function findUnregisteredNotionTables(pool) {
  const { rows: cols } = await pool.query(
    `SELECT DISTINCT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'notion_id'`);
  const { rows: reg } = await pool.query(
    `SELECT DISTINCT brain_table FROM notion_projection_map WHERE brain_table IS NOT NULL`);
  const registered = new Set(reg.map(r => r.brain_table));
  return cols.map(r => r.table_name).filter(t => !registered.has(t)).sort();
}
