/**
 * 六层目录清理计划（纯函数，scripts/ops/notion-tree-cleanup.mjs 调它）：
 * 列——在目录列合同（directory-schema）里或登记过的人工列 → 留；两样都不是 → 删。
 * 页——没有 Brain ID 的页不是 Brain 投影出来的：价值流/能力/Activity/Step 归档（30 天可恢复），流程库只列待拍板，部门库是人建的不动。
 */
import { buildDirectorySchemas, DIRECTORY_COLUMN_SOURCES, DIRECTORY_HUMAN_COLUMNS } from './directory-schema.js';

const LAYERS = ['areas', 'value_streams', 'capabilities', 'workflows', 'activities', 'steps'];
export const ARCHIVE_UNBOUND_LAYERS = Object.freeze(['value_streams', 'capabilities', 'activities', 'steps']);
const plain = values => (values || []).map(v => v.plain_text ?? v.text?.content ?? '').join('');
const titleOf = page => plain(Object.values(page.properties || {}).find(p => p?.type === 'title')?.title);

/** 一格算不算有值（与人眼看 Notion 一致：空文本/空关联/未勾选/空公式都算空）。 */
export function hasValue(property) {
  const type = property?.type, v = property?.[type];
  if (['rich_text', 'title', 'relation', 'multi_select', 'people', 'files'].includes(type)) return Array.isArray(v) && v.length > 0;
  if (type === 'checkbox') return v === true;
  if (type === 'formula' || type === 'rollup') { const inner = v?.[v?.type]; return !(inner == null || inner === '' || inner === false || inner === 0 || (Array.isArray(inner) && !inner.length)); }
  return v != null && v !== '';
}

export function planDirectoryCleanup({ databases, pages }) {
  const schemas = buildDirectorySchemas(Object.fromEntries(LAYERS.map(l => [l, databases[l].id])));
  const plan = {};
  for (const layer of LAYERS) {
    const actual = databases[layer].properties || {}, rows = pages[layer] || [], human = DIRECTORY_HUMAN_COLUMNS[layer];
    const filled = name => rows.filter(p => hasValue(p.properties?.[name])).length;
    const keep = [], drop = [];
    for (const [name, prop] of Object.entries(actual)) {
      if (Object.hasOwn(schemas[layer], name)) keep.push({ name, type: prop.type, source: DIRECTORY_COLUMN_SOURCES[layer][name], filled: filled(name) });
      else if (human.includes(name) || prop.type === 'title') keep.push({ name, type: prop.type, source: '人工', filled: filled(name) });
      else drop.push({ name, type: prop.type, filled: filled(name) });
    }
    const unbound = rows.filter(p => !plain(p.properties?.['Brain ID']?.rich_text).trim()).map(p => ({ id: p.id, title: titleOf(p) }));
    plan[layer] = {
      database_id: databases[layer].id, before: Object.keys(actual).length, after: keep.length, rows: rows.length, keep, drop,
      missing: Object.keys(schemas[layer]).filter(name => !Object.hasOwn(actual, name)),
      archive: ARCHIVE_UNBOUND_LAYERS.includes(layer) ? unbound : [],
      pending: layer === 'workflows' ? unbound : [],
    };
  }
  return plan;
}

/** 汇总/公式依赖关系列：先删公式、再删汇总、最后删关系与普通列，反序 Notion 会拒。 */
export function dropBatches(drop) {
  const rank = c => (c.type === 'formula' ? 0 : c.type === 'rollup' ? 1 : 2);
  return [0, 1, 2].map(r => drop.filter(c => rank(c) === r).map(c => c.name)).filter(batch => batch.length);
}

/** 删前备份：被删列逐页原值、被归档页全部属性。 */
export function buildCleanupBackup(plan, pages) {
  const backup = {};
  for (const [layer, p] of Object.entries(plan)) {
    const names = p.drop.map(c => c.name), archived = new Set(p.archive.map(a => a.id)), columns = {};
    for (const page of pages[layer] || []) {
      const values = Object.fromEntries(names.filter(n => hasValue(page.properties?.[n])).map(n => [n, page.properties[n]]));
      if (Object.keys(values).length) columns[page.id] = { brain_id: plain(page.properties?.['Brain ID']?.rich_text), title: titleOf(page), values };
    }
    backup[layer] = { database_id: p.database_id, dropped: names, columns,
      archived: (pages[layer] || []).filter(page => archived.has(page.id)).map(page => ({ id: page.id, title: titleOf(page), properties: page.properties })) };
  }
  return backup;
}

/** 新投影器建的列还没出现 = 新代码没上线；这时删旧列会被旧写入方补回来，拒绝执行。 */
export function assertReadyToApply(plan) {
  const missing = Object.entries(plan).filter(([, p]) => p.missing.length).map(([layer, p]) => `${layer}: ${p.missing.join('、')}`);
  if (missing.length) throw new Error(`目录投影新列尚未建出（新代码未上线或投影未跑过），拒绝删列：${missing.join('；')}`);
}
