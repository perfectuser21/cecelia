import { describe, expect, it } from 'vitest';
import { buildDirectorySchemas, ensureDirectorySchemas, pendingRenames, DIRECTORY_COLUMN_SOURCES, DIRECTORY_HUMAN_COLUMNS, DIRECTORY_RENAMES } from '../directory-schema.js';

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
    if (method === 'PATCH') {
      for (const [key, value] of Object.entries(copy(body.properties))) {
        if (value && Object.keys(value).length === 1 && typeof value.name === 'string') { row.properties[value.name] = row.properties[key]; delete row.properties[key]; }
        else row.properties[key] = value;
      }
    }
    return copy(row);
  };
  return { calls, pages, notionReq };
}

describe('六层目录字段契约', () => {
  it('每层只挂直接上级；关系指向规范层级', () => {
    const s = buildDirectorySchemas(dbs);
    expect(s.value_streams['所属部门'].relation.database_id).toBe(dbs.areas);
    expect(s.value_streams['能力'].relation.database_id).toBe(dbs.capabilities);
    expect(s.capabilities['所属价值流'].relation.database_id).toBe(dbs.value_streams);
    expect(s.capabilities['流程'].relation.database_id).toBe(dbs.workflows);
    expect(s.workflows['所属能力'].relation.database_id).toBe(dbs.capabilities);
    expect(s.workflows['Activity'].relation.database_id).toBe(dbs.activities);
    expect(s.activities['所属流程'].relation.database_id).toBe(dbs.workflows);
    expect(s.activities['Step'].relation.database_id).toBe(dbs.steps);
    expect(s.steps['所属Activity'].relation.database_id).toBe(dbs.activities);
    expect(s.areas['价值流'].relation.database_id).toBe(dbs.value_streams);
    expect(s.steps).not.toHaveProperty('所属Workflows');
    expect(s.areas).not.toHaveProperty('Parent item');
    for (const n of names) {
      expect(s[n]['Brain ID']).toEqual({ rich_text: {} });
      expect(s[n]['同步状态']).toEqual({ select: {} });
      for (const gone of ['登记缺口', '同步时间', 'Key', '分组·公司', '分组·部门', '分组·价值流', '分组·能力', '分组·流程']) expect(s[n], `${n}.${gone}`).not.toHaveProperty(gone);
    }
  });
  it('各库最终列名（人打开看得懂），每列都标了来源', () => {
    const s = buildDirectorySchemas(dbs);
    const cols = n => Object.keys(s[n]).filter(k => !['Brain ID', '同步状态'].includes(k)).sort();
    expect(cols('value_streams')).toEqual(['名称', '说明', '所属部门', '能力', '树位置'].sort());
    expect(cols('capabilities')).toEqual(['名称', '说明', '所属价值流', '流程', '状态', '树位置'].sort());
    expect(cols('workflows')).toEqual(['名称', '所属能力', 'Activity', 'Activity 顺序', '运行方式', '运行情况', '最近运行', '7天次数', '7天成功率', '平均时长', '去留（你填）', '树位置'].sort());
    expect(cols('activities')).toEqual(['名称', '所属流程', 'Step', '承诺（FR）', '输入', '输出', '谁来执行', '还缺什么', '树位置'].sort());
    expect(cols('steps')).toEqual(['名称', '所属Activity', '顺序', '做什么', '输入', '输出', '怎么验收', '失败了怎么办', '谁来执行', '还缺什么'].sort());
    for (const n of names) expect(Object.keys(DIRECTORY_COLUMN_SOURCES[n]).sort(), n).toEqual(Object.keys(s[n]).sort());
    expect(DIRECTORY_HUMAN_COLUMNS.areas).toEqual(expect.arrayContaining(['Parent item', 'Archive', 'Domain', 'Tasks', 'Projects']));
    expect(DIRECTORY_HUMAN_COLUMNS.workflows).toEqual(['去留（你填）']);
    expect(s.workflows['去留（你填）'].select.options.map(o => o.name)).toEqual(['有用', '没用', '过期', '删']);
  });
  it('改名映射的新名都在合同里；人工列「你的标记」改名保值成「去留（你填）」', () => {
    const s = buildDirectorySchemas(dbs);
    for (const n of names) for (const to of Object.values(DIRECTORY_RENAMES[n])) expect(s[n], `${n}.${to}`).toHaveProperty(to);
    expect(DIRECTORY_RENAMES.workflows['你的标记']).toBe('去留（你填）');
    expect(DIRECTORY_RENAMES.workflows.Capability).toBe('所属能力');
    expect(DIRECTORY_RENAMES.activities['所属Workflows']).toBe('所属流程');
  });
  it('首轮自动改名保值：旧名在新名不在 → 一次 PATCH 把旧列改名（不删重建），值与人工选项都还在；重跑零写', async () => {
    const b = boundary(p => {
      const wf = p[dbs.workflows].properties;
      wf['你的标记'] = { type: 'select', select: { options: [{ name: '有用', color: 'green' }] } }; delete wf['去留（你填）'];
      wf.Capability = wf['所属能力']; delete wf['所属能力'];
      wf.Workflow = wf['名称']; delete wf['名称'];
      const st = p[dbs.steps].properties;
      st['步骤'] = st['名称']; delete st['名称'];
      st['验收标准'] = st['怎么验收']; delete st['怎么验收'];
    });
    const result = await ensureDirectorySchemas({ dbs, token: 'test', notionReq: b.notionReq });
    expect(result.renamed.workflows.sort()).toEqual(['Capability→所属能力', 'Workflow→名称', '你的标记→去留（你填）'].sort());
    expect(result.added.workflows).toEqual([]);
    const patch = b.calls.find(c => c.method === 'PATCH' && c.path.endsWith(dbs.workflows)).body.properties;
    expect(patch['你的标记']).toEqual({ name: '去留（你填）' });
    expect(b.pages[dbs.workflows].properties['去留（你填）'].select.options).toEqual([{ name: '有用', color: 'green' }]);
    expect(b.pages[dbs.workflows].properties).not.toHaveProperty('你的标记');
    expect(b.pages[dbs.steps].properties).toHaveProperty('名称');
    b.calls.length = 0;
    await ensureDirectorySchemas({ dbs, token: 'test', notionReq: b.notionReq });
    expect(b.calls.every(c => c.method === 'GET')).toBe(true);
  });
  it('新旧两个名字都在时不改名（旧列交清理脚本删）；类型不同不改名（平均时长(秒) 数字 → 平均时长 文字）', () => {
    const s = buildDirectorySchemas(dbs);
    expect(pendingRenames('workflows', { '你的标记': { type: 'select' }, '去留（你填）': { type: 'select' } }, s.workflows)).toEqual([]);
    expect(pendingRenames('workflows', { '平均时长(秒)': { type: 'number' } }, s.workflows)).toEqual([]);
    expect(pendingRenames('workflows', { '在用吗': { type: 'rich_text' } }, s.workflows)).toEqual([]);
    expect(pendingRenames('workflows', { '在用吗': { type: 'select' } }, s.workflows)).toEqual([['在用吗', '运行情况']]);
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
    const b = boundary(p => { p[dbs.workflows].properties['所属能力'].relation.database_id = dbs.areas; });
    await expect(ensureDirectorySchemas({ dbs, token: 'test', notionReq: b.notionReq })).rejects.toThrow(/workflows.*所属能力.*target/);
    expect(b.calls.filter(c => c.method === 'PATCH')).toHaveLength(0);
  });
  it('仅补缺失字段，保留人工列与select颜色，重跑零写', async () => {
    const b = boundary(p => {
      delete p[dbs.steps].properties['所属Activity'];
      p[dbs.steps].properties['负责人'] = { type: 'people', people: {} };
      p[dbs.steps].properties['谁来执行'] = { type: 'select', select: { options: [{ name: '代码', color: 'green' }] } };
    });
    const before = copy(b.pages[dbs.steps].properties);
    const result = await ensureDirectorySchemas({ dbs, token: 'test', notionReq: b.notionReq });
    expect(result.verified).toBe(true);
    expect(result.added.steps).toEqual(['所属Activity']);
    const writes = b.calls.filter(c => c.method === 'PATCH');
    expect(writes).toHaveLength(1);
    expect(Object.keys(writes[0].body.properties)).toEqual(['所属Activity']);
    expect(b.pages[dbs.steps].properties['负责人']).toEqual(before['负责人']);
    expect(b.pages[dbs.steps].properties['谁来执行']).toEqual(before['谁来执行']);
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
    const b = boundary(p => { p[dbs.workflows].properties['所属能力'].relation.database_id = dbs.capabilities.replaceAll('-', ''); });
    expect((await ensureDirectorySchemas({ dbs, token: 'test', notionReq: b.notionReq })).verified).toBe(true);
  });
  it('标题列被人改成不认识的名字时拒绝新增第二个title', async () => {
    const s = buildDirectorySchemas(dbs);
    for (const n of ['value_streams', 'capabilities', 'workflows', 'activities', 'steps']) expect(s[n]['名称']).toEqual({ title: {} });
    const b = boundary(p => {
      delete p[dbs.workflows].properties['名称'];
      p[dbs.workflows].properties['改名标题'] = { type: 'title', title: {} };
    });
    await expect(ensureDirectorySchemas({ dbs, token: 'test', notionReq: b.notionReq })).rejects.toThrow(/workflows.*title/);
    expect(b.calls.filter(c => c.method === 'PATCH')).toHaveLength(0);
  });
  it('预检后人新增同名不同类型列，写前重读拒绝而不覆盖', async () => {
    const b = boundary(p => { delete p[dbs.areas].properties['Brain ID']; });
    let reads = 0;
    const notionReq = async (...args) => {
      const result = await b.notionReq(...args);
      if (args[2] === 'GET' && ++reads === names.length) {
        b.pages[dbs.areas].properties['Brain ID'] = { type: 'number', number: {} };
      }
      return result;
    };
    await expect(ensureDirectorySchemas({ dbs, token: 'test', notionReq })).rejects.toThrow(/areas.*Brain ID.*rich_text/);
    expect(b.calls.filter(c => c.method === 'PATCH')).toHaveLength(0);
    expect(b.pages[dbs.areas].properties['Brain ID']).toEqual({ type: 'number', number: {} });
  });
  it('无需补列也最终重新验全部库，预检后关系漂移不能标成功', async () => {
    const b = boundary(); let reads = 0;
    const notionReq = async (...args) => {
      const result = await b.notionReq(...args);
      if (args[2] === 'GET' && ++reads === names.length) {
        b.pages[dbs.workflows].properties['所属能力'].relation.database_id = dbs.areas;
      }
      return result;
    };
    await expect(ensureDirectorySchemas({ dbs, token: 'test', notionReq })).rejects.toThrow(/workflows.*所属能力.*target/);
  });
});
