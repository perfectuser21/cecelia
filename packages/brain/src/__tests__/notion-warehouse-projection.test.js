/**
 * 仓库物件库 + 用料库（树+仓库 v3.0 第 3 刀 c 段）：Brain warehouse_items / activity_uses → Notion。
 * 货架 8 个中文标签；Notion 库缺则在目录父页下建（带来源标记），建后登记进注册表；重复运行不再建库。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  SHELF_LABELS, MARKERS, buildWarehouseItemProps, buildActivityUseProps, ensureWarehouseDatabases, WAREHOUSE_DB_PROPS, USES_DB_PROPS,
} from '../notion-warehouse-projection.js';

const text = p => p.rich_text.map(t => t.text.content).join('');

describe('货架标签', () => {
  it('8 个货架全有中文名', () => {
    expect(Object.keys(SHELF_LABELS).sort()).toEqual(
      ['account_secret', 'data', 'external_dependency', 'generic_action', 'infrastructure', 'platform_action', 'service', 'ui']);
    expect(SHELF_LABELS.platform_action).toBe('平台动作');
    expect(SHELF_LABELS.account_secret).toBe('账号与密钥');
  });
});

describe('仓库物件行 → Notion 属性', () => {
  const row = { id: 'i1', key: 'device_lock', name: '设备锁', kind: 'service', shelf: 'service', impl_ref: 'packages/brain/src/device-locks.js',
    owner: '基础设施', description: '手机资源互斥锁', failure_semantics: '拿不到锁=排队', shelf_life_days: 30, active: true,
    source_table: 'journey_features', source_ref: 'f1', used_by: ['客服.回复', '获客.外呼'] };
  it('列值来自真身，货架转中文，被用于列出 Activity', () => {
    const p = buildWarehouseItemProps(row);
    expect(p.Name.title[0].text.content).toBe('设备锁');
    expect(p['货架']).toEqual({ select: { name: '服务' } });
    expect(p['种类']).toEqual({ select: { name: 'service' } });
    expect(p['启用']).toEqual({ checkbox: true });
    expect(p['保质期(天)']).toEqual({ number: 30 });
    expect(text(p['被用于'])).toBe('客服.回复；获客.外呼');
    expect(text(p['Brain ID'])).toBe('i1');
  });
  it('空值不编造：没有的列为空，未知货架照原值显示', () => {
    const p = buildWarehouseItemProps({ id: 'i2', name: 'x', shelf: 'new_shelf', active: false });
    expect(p['货架']).toEqual({ select: { name: 'new_shelf' } });
    expect(p['启用']).toEqual({ checkbox: false });
    expect(p['保质期(天)']).toEqual({ number: null });
    expect(p['说明'].rich_text).toEqual([]);
    expect(p['被用于'].rich_text).toEqual([]);
  });
  it('库定义含全部列与 8 个货架选项', () => {
    expect(WAREHOUSE_DB_PROPS['货架'].select.options.map(o => o.name)).toEqual(Object.values(SHELF_LABELS));
    for (const col of Object.keys(buildWarehouseItemProps({ id: 'i', name: 'n' }))) expect(WAREHOUSE_DB_PROPS).toHaveProperty(col);
  });
});

describe('用料行 → Notion 属性', () => {
  it('Activity 与物件都是 relation，角色/断言/格子状态照真身', () => {
    const p = buildActivityUseProps({ id: 'u1', activity_name: '回复', item_name: '设备锁', role: 'uses', assertion_ref: 'probe:lock_ok',
      cell_status: 'green', activity_page_id: 'pa', item_page_id: 'pi' });
    expect(p['名称'].title[0].text.content).toBe('回复 ← 设备锁');
    expect(p['Activity']).toEqual({ relation: [{ id: 'pa' }] });
    expect(p['物件']).toEqual({ relation: [{ id: 'pi' }] });
    expect(p['角色']).toEqual({ select: { name: 'uses' } });
    expect(text(p['断言引用'])).toBe('probe:lock_ok');
    expect(p['格子状态']).toEqual({ select: { name: 'green' } });
  });
  it('库定义的列覆盖构造出的每一列', () => {
    const defs = USES_DB_PROPS({ activities: 'a-db', warehouse: 'w-db' });
    for (const col of Object.keys(buildActivityUseProps({ id: 'u', activity_name: 'a', item_name: 'i' }))) expect(defs).toHaveProperty(col);
    expect(defs['Activity'].relation.database_id).toBe('a-db');
    expect(defs['物件'].relation.database_id).toBe('w-db');
  });
});

describe('ensureWarehouseDatabases：缺库才建，建后登记，重跑不重复建', () => {
  function world({ registered = {}, existingChildren = [] } = {}) {
    const calls = [];
    const registry = [...Object.entries(registered).map(([table, id]) => ({ brain_table: table, notion_db_id: id }))];
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (/FROM projection_targets/.test(sql)) return { rows: [{ config: { parent_page_id: 'parent-1' } }] };
        if (/FROM notion_projection_map/.test(sql) && /SELECT/.test(sql)) {
          return { rows: registry.filter(r => r.brain_table === params[0]).map(r => ({ notion_db_id: r.notion_db_id })) };
        }
        if (/INSERT INTO notion_projection_map/.test(sql)) { registry.push({ brain_table: params[2], notion_db_id: params[0] }); return { rowCount: 1, rows: [] }; }
        return { rows: [] };
      }),
    };
    let n = 0;
    const notionReq = vi.fn(async (_t, path, method, body) => {
      calls.push({ path, method, body });
      if (method === 'GET' && path.startsWith('/blocks/parent-1/children')) return { results: existingChildren, has_more: false };
      if (method === 'POST' && path === '/databases') return { id: `new-db-${++n}` };
      if (method === 'GET' && path.startsWith('/databases/')) return { id: path.split('/').pop(), archived: false, parent: { page_id: 'parent-1' },
        description: [{ plain_text: path.endsWith('exist-w') ? MARKERS.warehouse_items : MARKERS.activity_uses }] };
      return {};
    });
    return { pool, notionReq, calls, registry };
  }
  const activitiesResolver = async () => 'activities-db';

  it('都没有：在目录父页下建两个库，带来源标记，关系指向 Activity 库，并登记 push/active', async () => {
    const w = world();
    const dbs = await ensureWarehouseDatabases(w.pool, 'tok', { notionReq: w.notionReq, resolveActivities: activitiesResolver });
    expect(dbs).toEqual({ warehouse: 'new-db-1', uses: 'new-db-2' });
    const creates = w.calls.filter(c => c.method === 'POST' && c.path === '/databases');
    expect(creates).toHaveLength(2);
    expect(creates[0].body.parent).toEqual({ page_id: 'parent-1' });
    expect(creates[0].body.description[0].text.content).toBe(MARKERS.warehouse_items);
    expect(creates[0].body.title[0].text.content).toBe('仓库物件');
    expect(creates[1].body.title[0].text.content).toBe('用料');
    expect(creates[1].body.properties['Activity'].relation.database_id).toBe('activities-db');
    expect(creates[1].body.properties['物件'].relation.database_id).toBe('new-db-1');
    expect(w.registry.map(r => r.brain_table).sort()).toEqual(['activity_uses', 'warehouse_items']);
  });

  it('注册表已有 active 库：不建库、不扫父页', async () => {
    const w = world({ registered: { warehouse_items: 'reg-w', activity_uses: 'reg-u' } });
    const dbs = await ensureWarehouseDatabases(w.pool, 'tok', { notionReq: w.notionReq, resolveActivities: activitiesResolver });
    expect(dbs).toEqual({ warehouse: 'reg-w', uses: 'reg-u' });
    expect(w.calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });

  it('父页下已有同名且来源标记吻合的库：认领并登记，不重复建', async () => {
    const w = world({ existingChildren: [{ type: 'child_database', id: 'exist-w', child_database: { title: '仓库物件' } }] });
    const dbs = await ensureWarehouseDatabases(w.pool, 'tok', { notionReq: w.notionReq, resolveActivities: activitiesResolver });
    expect(dbs.warehouse).toBe('exist-w');
    expect(w.calls.filter(c => c.method === 'POST' && c.path === '/databases')).toHaveLength(1);
  });

  it('没有目录父页配置或 Activity 库未知：不建任何库，返回 null', async () => {
    const w = world();
    expect(await ensureWarehouseDatabases(w.pool, 'tok', { notionReq: w.notionReq, resolveActivities: async () => null })).toBeNull();
    expect(w.calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });
});
