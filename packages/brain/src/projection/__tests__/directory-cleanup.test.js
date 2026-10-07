/** 六层目录清理计划：每列要么来自 Brain（原样/派生），要么是登记过的人工列，两样都不是就删；不是 Brain 投影出来的页归档。 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildDirectorySchemas } from '../directory-schema.js';
import { planDirectoryCleanup, dropBatches, buildCleanupBackup, assertReadyToApply } from '../directory-cleanup.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LAYERS = ['areas', 'value_streams', 'capabilities', 'workflows', 'activities', 'steps'];
const dbs = Object.fromEntries(LAYERS.map((k, i) => [k, id(900 + i)]));
const typed = props => Object.fromEntries(Object.entries(props).map(([k, v]) => [k, { ...v, type: Object.keys(v)[0] }]));
const text = s => ({ type: 'rich_text', rich_text: s ? [{ plain_text: s }] : [] });

function world() {
  const schemas = buildDirectorySchemas(dbs);
  const databases = Object.fromEntries(LAYERS.map(l => [l, { id: dbs[l], properties: typed(schemas[l]) }]));
  Object.assign(databases.areas.properties, { Key: { type: 'rich_text', rich_text: {} }, Tasks: { type: 'relation', relation: {} }, Archive: { type: 'checkbox', checkbox: {} } });
  Object.assign(databases.workflows.properties, { Trigger: { type: 'rich_text', rich_text: {} }, '业务线': { type: 'select', select: {} } });
  Object.assign(databases.steps.properties, {
    '状态(判定)': { type: 'formula', formula: {} }, '失败次数(rollup)': { type: 'rollup', rollup: {} },
    'Ops Runs': { type: 'relation', relation: {} }, Staging: { type: 'rich_text', rich_text: {} },
  });
  const page = (layer, n, brainId, extra = {}) => ({ id: id(n), properties: { 'Brain ID': text(brainId), ...extra } });
  const pages = {
    areas: [page('areas', 1, id(11), { Key: text(id(11)) })],
    value_streams: [page('value_streams', 2, id(12)), page('value_streams', 3, '', { Name: { type: 'title', title: [{ plain_text: '旧地图页' }] } })],
    capabilities: [], activities: [],
    workflows: [page('workflows', 4, id(14), { '业务线': { type: 'select', select: { name: '金诺' } } }), page('workflows', 5, '')],
    steps: [page('steps', 6, id(16), { Staging: text('2-discovery') }), page('steps', 7, '', { Staging: text('旧'), '步骤': { type: 'title', title: [{ plain_text: '旧步骤' }] } })],
  };
  return { databases, pages };
}

describe('目录清理计划', () => {
  it('删掉既不来自 Brain 也不是登记人工列的列；部门库 PARA 人工列与流程库「去留（你填）」保留', () => {
    const plan = planDirectoryCleanup(world());
    expect(plan.areas.drop.map(c => c.name)).toEqual(['Key']);
    expect(plan.areas.keep.map(c => c.name)).toEqual(expect.arrayContaining(['Tasks', 'Archive', 'Name', 'Brain ID', '价值流']));
    expect(plan.areas.keep.find(c => c.name === 'Tasks').source).toBe('人工');
    expect(plan.workflows.drop.map(c => c.name).sort()).toEqual(['Trigger', '业务线']);
    expect(plan.workflows.keep.find(c => c.name === '去留（你填）').source).toBe('人工');
    expect(plan.workflows.keep.find(c => c.name === '7天次数').source).toMatch(/v_workflow_run_stats/);
    expect(plan.steps.drop.map(c => c.name).sort()).toEqual(['Ops Runs', 'Staging', '失败次数(rollup)', '状态(判定)']);
    expect(plan.steps.drop.find(c => c.name === 'Staging').filled).toBe(2);
    expect(plan.workflows.before).toBe(plan.workflows.keep.length + 2);
    expect(plan.workflows.after).toBe(plan.workflows.keep.length);
  });

  it('待改名的旧列（上线首轮投影器自动改名保值）不删、不算缺列；改名没完成时拒绝 --apply', () => {
    const w = world();
    const wf = w.databases.workflows.properties;
    wf['你的标记'] = wf['去留（你填）']; delete wf['去留（你填）'];
    wf['在用吗'] = wf['运行情况']; delete wf['运行情况'];
    wf['平均时长(秒)'] = { type: 'number', number: {} };
    const plan = planDirectoryCleanup(w);
    expect(plan.workflows.rename).toEqual([{ from: '在用吗', to: '运行情况' }, { from: '你的标记', to: '去留（你填）' }]);
    expect(plan.workflows.keep.find(c => c.name === '你的标记').source).toMatch(/^待改名→去留（你填）/);
    expect(plan.workflows.drop.map(c => c.name)).toEqual(expect.arrayContaining(['平均时长(秒)']));
    expect(plan.workflows.drop.map(c => c.name)).not.toContain('你的标记');
    expect(plan.workflows.missing).toEqual([]);
    expect(() => assertReadyToApply(plan)).toThrow(/workflows.*你的标记→去留（你填）/);
  });

  it('删列分批：公式先删、汇总再删、关系与普通列最后（汇总/公式依赖关系，反序会被 Notion 拒）', () => {
    const plan = planDirectoryCleanup(world());
    expect(dropBatches(plan.steps.drop)).toEqual([['状态(判定)'], ['失败次数(rollup)'], ['Ops Runs', 'Staging']]);
    expect(dropBatches([])).toEqual([]);
  });

  it('没有 Brain ID 的页：价值流/能力/Activity/Step 归档；流程库只列待拍板不动', () => {
    const plan = planDirectoryCleanup(world());
    expect(plan.value_streams.archive).toEqual([{ id: id(3), title: '旧地图页' }]);
    expect(plan.steps.archive).toEqual([{ id: id(7), title: '旧步骤' }]);
    expect(plan.workflows.archive).toEqual([]);
    expect(plan.workflows.pending.map(p => p.id)).toEqual([id(5)]);
    expect(plan.areas.archive).toEqual([]);
  });

  it('备份：被删列逐页原值 + 被归档页全部属性，删之前先落盘', () => {
    const w = world(), plan = planDirectoryCleanup(w), backup = buildCleanupBackup(plan, w.pages);
    expect(backup.steps.columns[id(6)]).toMatchObject({ brain_id: id(16), values: { Staging: text('2-discovery') } });
    expect(backup.workflows.columns[id(4)].values['业务线']).toEqual({ type: 'select', select: { name: '金诺' } });
    expect(backup.steps.archived.map(p => p.id)).toEqual([id(7)]);
    expect(backup.steps.archived[0].properties.Staging).toEqual(text('旧'));
  });

  it('新投影器还没把新列建出来（没上线）时拒绝 --apply，免得旧写入方把列补回来', () => {
    const w = world();
    delete w.databases.workflows.properties['7天次数'];
    const plan = planDirectoryCleanup(w);
    expect(plan.workflows.missing).toEqual(['7天次数']);
    expect(() => assertReadyToApply(plan)).toThrow(/workflows.*7天次数/);
    expect(() => assertReadyToApply(planDirectoryCleanup(world()))).not.toThrow();
  });

  it('旧写入方已断开：Activity 契约推送器不再补英文列、价值流地图镜子不再挂在推送轮里、KR 登记不再写 Step/Activity 旧列', () => {
    const src = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    expect(src('activity-contract-sync.js')).not.toMatch(/BACKBONE_DB_PROPS|pushBackboneActivities|ensureOpsDbProps|syncBackboneBodies|notionReq/);
    expect(src('notion-push-sync.js')).not.toContain('runValueStreamMirror(');
    const kr = src('projection/company-kr-registration-notion.js');
    expect(kr).not.toMatch(/Staging|所属Workflow'|有确定性判定|buildBackboneActivityProps/);
  });
});
