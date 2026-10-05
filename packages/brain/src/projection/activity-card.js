/**
 * Activity 页 15 列 + 8 格颜色、Step 页三列（树+仓库 v3.0）：Brain 真身 → Notion 目录库的机器列。
 * 列名与取值只在这里定义一次：目录 schema 建列、目录源构造行都读它，不会各写各的。
 * 人只拍板三问（承诺 / 哪些失败要人 / 判定点误判后果），其余列全部机器写、Notion 上手改会被覆盖。
 */
// 与 directory-source.rich 同形（不 import 它，避免两模块互相引用）
const rich = value => ({ rich_text: value == null || value === '' ? [] : [{ text: { content: (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 1900) } }] });

/** 8 个标准格 → 页面列名；顺序固定 = 验收 8 列的顺序。 */
export const CELL_KEYS = Object.freeze({
  promise: '格·承诺', nfr: '格·NFR', judgment: '格·判定点', invariants: '格·不变量',
  failure: '格·失败', readback: '格·读回', adversarial: '格·对抗', shelf_life: '格·保质期',
});
export const CELL_COLUMNS = Object.freeze(Object.values(CELL_KEYS));

/** 格子状态 → 选项（名字带色块，颜色同时写进库定义，页面一眼看出红绿灰）。 */
export const CELL_STATUS_OPTIONS = Object.freeze([
  { status: 'green', name: '🟢 绿', color: 'green' },
  { status: 'red', name: '🔴 红', color: 'red' },
  { status: 'pending', name: '🟡 待判', color: 'yellow' },
  { status: 'gray', name: '⚪ 灰', color: 'gray' },
]);
const GRAY = CELL_STATUS_OPTIONS[3].name;
const statusName = status => CELL_STATUS_OPTIONS.find(o => o.status === status)?.name ?? GRAY;

/** 文字/数字机器列：页面列名 → Activity 真身列。 */
const TEXT_COLUMNS = Object.freeze({
  '承诺': 'promise', '输入': 'inputs', '输出': 'outputs', '前提': 'preconditions', '不变量': 'invariants',
  'NFR': 'nfr', '失败语义': 'failure', '读回': 'readback', '判定点': 'judgment', '对抗': 'adversarial',
});
export const ACTIVITY_CARD_COLUMNS = Object.freeze([...Object.keys(TEXT_COLUMNS), '保质期(天)', '用料', ...CELL_COLUMNS]);
export const STEP_CARD_COLUMNS = Object.freeze(['动作', '失败处理', '模式']);

const isEmpty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/**
 * @param {object} a      activities 一行（含 15 列）
 * @param {object[]} cells 该 Activity 的格子行（cell_key / cell_status / parent_cell_key）
 * @param {object[]} uses  该 Activity 的用料（item_name / role）
 */
export function buildActivityCardProps(a = {}, cells = [], uses = []) {
  const props = {};
  for (const [column, field] of Object.entries(TEXT_COLUMNS)) props[column] = rich(isEmpty(a[field]) ? null : a[field]);
  props['保质期(天)'] = { number: Number.isFinite(a.shelf_life_days) ? a.shelf_life_days : null };
  props['用料'] = rich(uses.length ? uses.map(u => `${u.item_name}（${u.role}）`).join('；') : null);
  const byKey = new Map(cells.filter(c => !c.parent_cell_key).map(c => [c.cell_key, c.cell_status]));
  for (const [key, column] of Object.entries(CELL_KEYS)) props[column] = { select: { name: statusName(byKey.get(key)) } };
  return props;
}

/** Step 三列：动作（按脚本精度）、失败处理（retry:N | abort）、模式。名字/进出/读回沿用目录既有列。 */
export function buildStepCardProps(s = {}) {
  return {
    '动作': rich(s.action ?? null),
    '失败处理': rich(s.on_fail ?? null),
    '模式': { select: { name: s.mode || 'action' } },
  };
}

/** 目录 schema 里的列定义（建列用；格子列带颜色选项，重跑只补缺不改已有）。 */
export function activityCardSchema() {
  const cell = () => ({ select: { options: CELL_STATUS_OPTIONS.map(({ name, color }) => ({ name, color })) } });
  return {
    ...Object.fromEntries(Object.keys(TEXT_COLUMNS).map(c => [c, { rich_text: {} }])),
    '保质期(天)': { number: {} }, '用料': { rich_text: {} },
    ...Object.fromEntries(CELL_COLUMNS.map(c => [c, cell()])),
  };
}
export function stepCardSchema() {
  return { '动作': { rich_text: {} }, '失败处理': { rich_text: {} }, '模式': { select: {} } };
}
