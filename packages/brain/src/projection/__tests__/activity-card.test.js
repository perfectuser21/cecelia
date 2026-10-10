/**
 * Activity / Step 卡片（第二轮「人打开看得懂」）：列只放 承诺（FR）/输入/输出/谁来执行/还缺什么；
 * 前提/不变量/NFR/失败语义/读回/判定点/对抗/保质期/用料 9 项进页面正文；「还缺什么」一列人话替代 8 个格子列与登记缺口。
 */
import { describe, it, expect } from 'vitest';
import { buildDirectoryRows } from '../directory-source.js';
import { buildDirectorySchemas } from '../directory-schema.js';
import { buildActivityCardProps, buildStepCardProps, activityMissing, activityBodySections, humanize, executorLabel, judgmentText, releaseText, BODY_ITEMS } from '../activity-card.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const text = p => p.rich_text.map(t => t.text.content).join('');
const full = {
  promise: '每轮采到新的视频', inputs: [{ type: 'Video', fields: ['line_key', 'video_id'] }], outputs: [{ type: 'Lead', cardinality: 'many', effect: 'create', fields: ['id'] }],
  preconditions: ['设备在线'], invariants: ['不重复入库'], nfr: { timeout_s: 600 }, failure: { fatal: ['登录失效'] }, readback: [{ probe: 'p1', asserts: '有新视频' }],
  judgment: [{ point: '登录态', harm: '误判=整批丢' }], adversarial: '平台改版', shelf_life_days: 14, executor_kind: 'code',
};
const allGreen = ['promise', 'invariants', 'nfr', 'failure', 'readback', 'judgment', 'adversarial', 'shelf_life'].map(cell_key => ({ cell_key, cell_status: 'green' }));
const uses = [{ item_name: 'CRM 表', role: 'depends' }, { item_name: '设备锁', role: 'uses' }];

describe('Activity 卡片列', () => {
  it('只有 承诺（FR）/输入/输出/谁来执行/还缺什么 五列；jsonb 翻成人话（数据描述写成 类型(字段)）', () => {
    const p = buildActivityCardProps(full, allGreen, uses);
    expect(Object.keys(p).sort()).toEqual(['承诺（FR）', '输入', '输出', '谁来执行', '还缺什么'].sort());
    expect(text(p['承诺（FR）'])).toBe('每轮采到新的视频');
    expect(text(p['输入'])).toBe('Video(line_key, video_id)');
    expect(text(p['输出'])).toBe('Lead[] create(id)');
    expect(p['谁来执行']).toEqual({ select: { name: '代码' } });
    expect(text(p['还缺什么'])).toBe('齐了');
  });

  it('谁来执行：code/agent/human → 代码/AI/人，没写或乱写 → 未写', () => {
    expect(['code', 'agent', 'human', null, 'robot'].map(executorLabel)).toEqual(['代码', 'AI', '人', '未写', '未写']);
  });

  it('还缺什么：先列没写的标准项，再列 红/待判/未验 的格子，再加登记问题；子项格不算', () => {
    const a = { ...full, preconditions: [], adversarial: null, executor_kind: null };
    const cells = [{ cell_key: 'readback', cell_status: 'red' }, { cell_key: 'nfr', cell_status: 'pending' }, { cell_key: 'promise', cell_status: 'green' },
      { cell_key: 'readback.net', cell_status: 'green', parent_cell_key: 'readback' }];
    expect(activityMissing(a, cells, [], ['Step 登记对不上：x'])).toBe([
      '没写：前提、对抗、用料、谁来执行', '不变量：未验', 'NFR：待判', '失败语义：未验', '读回：红', '判定点：未验', '保质期：未验', 'Step 登记对不上：x',
    ].join('\n'));
  });

  it('全空的 Activity：13 项都列为没写，不报格子', () => {
    expect(activityMissing({}, [], [])).toBe('没写：承诺、输入、输出、前提、不变量、NFR、失败语义、读回、判定点、对抗、保质期、用料、谁来执行');
  });

  it('页面正文 9 段：顺序固定，没写的写「（未写）」，保质期带单位，用料列物件和角色', () => {
    const sections = activityBodySections({ ...full, adversarial: null }, uses);
    expect(sections.map(s => s.label)).toEqual([...BODY_ITEMS]);
    expect(sections.map(s => s.label)).toEqual(['前提', '不变量', 'NFR', '失败语义', '读回', '判定点', '对抗', '保质期', '用料']);
    const by = Object.fromEntries(sections.map(s => [s.label, s.text]));
    expect(by['前提']).toBe('设备在线');
    expect(by['对抗']).toBe('（未写）');
    expect(by['保质期']).toBe('14 天');
    expect(by['用料']).toBe('CRM 表（depends）；设备锁（uses）');
    expect(by['NFR']).toBe('timeout_s：600');
    expect(activityBodySections({}, []).every(s => s.text === '（未写）')).toBe(true);
  });

  it('humanize：字符串原样、数组一行一个、普通对象写「键：值」、空值为空串', () => {
    expect(humanize('x')).toBe('x');
    expect(humanize(['a', 'b'])).toBe('a\nb');
    expect(humanize({ a: 1, b: null })).toBe('a：1');
    expect(humanize(null)).toBe('');
    expect(humanize([])).toBe('');
    expect(humanize({ budget: { heartbeat_s: 60, max_duration_s: 1800 }, locks: ['device:x', 'acct:y'] })).toBe('budget：heartbeat_s 60，max_duration_s 1800；locks：device:x、acct:y');
  });

  it('Step 卡片：做什么、失败了怎么办；没写不编造', () => {
    expect(text(buildStepCardProps({ action: 'adb shell', on_fail: 'retry:3' })['做什么'])).toBe('adb shell');
    expect(buildStepCardProps({})['失败了怎么办'].rich_text).toEqual([]);
  });

  it('目录行：Activity 用自己的格子和用料算「还缺什么」，别的 Activity 的格子不串', () => {
    const data = {
      areas: [{ id: id(1), name: '部门' }], journeys: [{ id: id(2), name: '产品', kind: 'value_stream', area_id: id(1) }, { id: id(3), name: '能力', kind: 'capability', parent_journey_id: id(2) }],
      workflows: [{ id: id(4), key: 'a', name: '流程A', capability_id: id(3) }],
      activities: [{ id: id(6), name: '采集', ...full }], steps: [], map_nodes: [],
      refs: [{ workflow_id: id(4), activity_id: id(6), slot_key: 'first', sequence_no: 1, active: true }],
      cells: [...allGreen.map(c => ({ ...c, step_id: id(6) })), { step_id: id(99), cell_key: 'readback', cell_status: 'red' }],
      uses: [{ activity_id: id(6), item_name: '设备锁', role: 'uses' }, { activity_id: id(99), item_name: '别家', role: 'uses' }],
    };
    const a = buildDirectoryRows(data, {}).find(r => r.layer === 'activities');
    expect(text(a.properties['还缺什么'])).toBe('齐了');
    for (const k of Object.keys(a.properties)) expect(k.startsWith('格·')).toBe(false);
  });
});

describe('目录库 schema', () => {
  const names = ['areas', 'value_streams', 'capabilities', 'workflows', 'activities', 'steps'];
  const dbs = Object.fromEntries(names.map((n, i) => [n, id(500 + i)]));
  it('Activity 库没有格子列与 9 项正文列；Step 库有 做什么/失败了怎么办', () => {
    const s = buildDirectorySchemas(dbs);
    for (const col of ['格·承诺', '格·读回', '前提', '不变量', 'NFR', '失败语义', '读回', '判定点', '对抗', '保质期(天)', '用料']) expect(s.activities, col).not.toHaveProperty(col);
    for (const col of ['做什么', '失败了怎么办']) expect(s.steps[col]).toEqual({ rich_text: {} });
    expect(s.steps).not.toHaveProperty('模式');
  });
});

describe('裁判结论一列人话（五块模型第 2 步裁判接线后接进 Activity 页，任务 f6ad056e）', () => {
  it('四种裁决翻中文并带连续绿/要求绿；没裁判过写「未裁判」', () => {
    expect(judgmentText({ verdict: 'converged', consecutive_green: 3, required_green: 3 })).toBe('收敛 · 连续绿 3/3');
    expect(judgmentText({ verdict: 'converging', consecutive_green: 1, required_green: 3 })).toBe('收敛中 · 连续绿 1/3');
    expect(judgmentText({ verdict: 'diverged', consecutive_green: 0, required_green: 3 })).toBe('发散 · 连续绿 0/3');
    expect(judgmentText({ verdict: 'no_data', consecutive_green: 0, required_green: 3 })).toBe('无数据 · 连续绿 0/3');
    expect(judgmentText(null)).toBe('未裁判');
  });
});

describe('生产版本一列人话（发布线生产指针，任务 1b3c0000）', () => {
  it('v<版本号> + 收敛过 / 冷启动（未收敛过）；没有生产指针给空', () => {
    expect(releaseText({ version_no: 2, ever_converged: true })).toBe('v2 · 收敛过');
    expect(releaseText({ version_no: 1, ever_converged: false })).toBe('v1 · 冷启动（未收敛过）');
    expect(releaseText(null)).toBe(null);
  });
});
