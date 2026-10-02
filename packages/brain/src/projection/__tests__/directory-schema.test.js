import { describe, expect, it } from 'vitest';
import { buildDirectorySchemas, ensureDirectorySchemas } from '../directory-schema.js';

const names = ['areas', 'value_streams', 'capabilities', 'workflows', 'activities', 'steps'];
const dbs = Object.fromEntries(names.map((name, i) => [name, `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]));
const copy = value => structuredClone(value);
function boundary(change = () => {}) {
  const schemas = buildDirectorySchemas(dbs);
  const pages = Object.fromEntries(names.map(name => [dbs[name], { id: dbs[name], properties: copy(schemas[name]) }]));
  change(pages);
  const calls = [];
  const notionReq = async (_token, path, method, body) => {
    calls.push({ path, method, body });
    const row = pages[path.split('/').at(-1)];
    if (method === 'PATCH') Object.assign(row.properties, copy(body.properties));
    return copy(row);
  };
  return { calls, pages, notionReq };
}

describe('六层目录字段契约', () => {
  it('关系指向规范层级，Activity保留多流程引用，Step直接归Activity', () => {
    const s = buildDirectorySchemas(dbs);
    expect(s.workflows.Capability.relation.database_id).toBe(dbs.capabilities);
    expect(s.activities['所属Workflows'].relation.database_id).toBe(dbs.workflows);
    expect(s.steps['所属Activity'].relation.database_id).toBe(dbs.activities);
    expect(s.value_streams['所属部门'].relation.database_id).toBe(dbs.areas);
    expect(s.capabilities['所属价值流'].relation.database_id).toBe(dbs.value_streams);
    expect(s.areas['价值流'].relation.database_id).toBe(dbs.value_streams);
    expect(s.activities).not.toHaveProperty('Order');
    expect(s.activities).not.toHaveProperty('Capability');
    expect(s.steps).not.toHaveProperty('所属Workflow');
    expect(s.areas).not.toHaveProperty('Parent item');
    for (const n of names) {
      expect(s[n]['Brain ID']).toEqual({ rich_text: {} });
      expect(s[n]['登记缺口']).toEqual({ rich_text: {} });
      expect(s[n]).not.toHaveProperty('Owner');
      expect(s[n]).not.toHaveProperty('负责人');
    }
  });
  it('拒绝缺失、重复或非法库ID，防止把两层写进同一库', () => {
    expect(() => buildDirectorySchemas({ ...dbs, capabilities: null })).toThrow(/capabilities/);
    expect(() => buildDirectorySchemas({ ...dbs, steps: dbs.activities })).toThrow(/duplicate/);
    expect(() => buildDirectorySchemas({ ...dbs, steps: '../pages' })).toThrow(/steps/);
  });
  it('先检查全部库，末库已有同名错类型时零PATCH', async () => {
    const b = boundary(p => {
      delete p[dbs.areas].properties['Brain ID'];
      p[dbs.steps].properties['Brain ID'] = { type: 'number', number: {} };
    });
    await expect(ensureDirectorySchemas({ dbs, token: 'test', notionReq: b.notionReq })).rejects.toThrow(/steps.*Brain ID.*rich_text/);
    expect(b.calls.filter(c => c.method === 'PATCH')).toHaveLength(0);
  });
  it('已有relation指错数据库时拒绝；不重定向或删除既有引用', async () => {
    const b = boundary(p => { p[dbs.workflows].properties.Capability.relation.database_id = dbs.areas; });
    await expect(ensureDirectorySchemas({ dbs, token: 'test', notionReq: b.notionReq })).rejects.toThrow(/workflows.*Capability.*target/);
    expect(b.calls.filter(c => c.method === 'PATCH')).toHaveLength(0);
  });
  it('仅补缺失字段，保留人工列与select颜色，重跑零写', async () => {
    const b = boundary(p => {
      delete p[dbs.steps].properties['所属Activity'];
      p[dbs.steps].properties['负责人'] = { type: 'people', people: {} };
      p[dbs.steps].properties['登记状态'] = { type: 'select', select: { options: [{ name: 'active', color: 'green' }] } };
    });
    const before = copy(b.pages[dbs.steps].properties);
    const result = await ensureDirectorySchemas({ dbs, token: 'test', notionReq: b.notionReq });
    expect(result.verified).toBe(true);
    expect(result.added.steps).toEqual(['所属Activity']);
    const writes = b.calls.filter(c => c.method === 'PATCH');
    expect(writes).toHaveLength(1);
    expect(Object.keys(writes[0].body.properties)).toEqual(['所属Activity']);
    expect(b.pages[dbs.steps].properties['负责人']).toEqual(before['负责人']);
    expect(b.pages[dbs.steps].properties['登记状态']).toEqual(before['登记状态']);
    b.calls.length = 0;
    await ensureDirectorySchemas({ dbs, token: 'test', notionReq: b.notionReq });
    expect(b.calls.every(c => c.method === 'GET')).toBe(true);
  });
  it('PATCH成功但GET读回缺列，不能报告补齐成功', async () => {
    const b = boundary(p => { delete p[dbs.steps].properties['Brain ID']; });
    const notionReq = (...args) => args[2] === 'PATCH' ? Promise.resolve({}) : b.notionReq(...args);
    await expect(ensureDirectorySchemas({ dbs, token: 'test', notionReq })).rejects.toThrow(/steps.*Brain ID.*missing/);
  });
  it('库不可写或返回错库ID时全批拒绝', async () => {
    for (const broken of [{ archived: true }, { in_trash: true }, { id: dbs.areas }]) {
      const b = boundary(p => Object.assign(p[dbs.steps], broken));
      await expect(ensureDirectorySchemas({ dbs, token: 'test', notionReq: b.notionReq })).rejects.toThrow(/steps/);
      expect(b.calls.filter(c => c.method === 'PATCH')).toHaveLength(0);
    }
  });
  it('relation UUID带连字符与紧凑格式等价', async () => {
    const b = boundary(p => { p[dbs.workflows].properties.Capability.relation.database_id = dbs.capabilities.replaceAll('-', ''); });
    expect((await ensureDirectorySchemas({ dbs, token: 'test', notionReq: b.notionReq })).verified).toBe(true);
  });
  it('既有标题列改名时拒绝新增第二个title，既有版本列也必须验型', async () => {
    const s = buildDirectorySchemas(dbs);
    expect(s.workflows.Workflow).toEqual({ title: {} });
    expect(s.workflows['版本']).toEqual({ rich_text: {} });
    expect(s.activities.Name).toEqual({ title: {} });
    expect(s.steps['步骤']).toEqual({ title: {} });
    const b = boundary(p => {
      delete p[dbs.workflows].properties.Workflow;
      p[dbs.workflows].properties['改名标题'] = { type: 'title', title: {} };
    });
    await expect(ensureDirectorySchemas({ dbs, token: 'test', notionReq: b.notionReq })).rejects.toThrow(/workflows.*title/);
    expect(b.calls.filter(c => c.method === 'PATCH')).toHaveLength(0);
  });
});
