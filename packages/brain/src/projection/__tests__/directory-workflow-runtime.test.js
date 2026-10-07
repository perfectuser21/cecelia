/** Notion「流程」库的运行情况列：runs 表 7 天真实统计（次数/失败/成功率/平均时长）+ 最近运行、在用吗、怎么运行；「你的标记」是人工列，系统只建列不写值。 */
import { describe, it, expect } from 'vitest';
import { buildDirectoryRows, workflowUsageStatus } from '../directory-source.js';
import { buildDirectorySchemas } from '../directory-schema.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dbs = Object.fromEntries(['areas', 'value_streams', 'capabilities', 'workflows', 'activities', 'steps'].map((k, i) => [k, id(900 + i)]));
const text = p => (p?.rich_text || []).map(t => t.text.content).join('');

function sample(runtime) {
  return {
    areas: [], journeys: [{ id: id(2), name: '能力', kind: 'capability', parent_journey_id: null }],
    workflows: [{ id: id(4), key: 'ops', name: '运维', capability_id: id(2) }, { id: id(5), key: 'pipe', name: '流水线', capability_id: id(2) },
      { id: id(6), key: 'ghost', name: '空壳', capability_id: id(2) }, { id: id(7), key: 'idle', name: '任务没动静', capability_id: id(2) },
      { id: id(8), key: 'runs', name: '只有运行记录', capability_id: id(2) }],
    activities: [{ id: id(20), name: '活动', executor_kind: 'agent', contract: {} }],
    steps: [], cells: [], uses: [], map_nodes: [],
    refs: [{ workflow_id: id(5), activity_id: id(20), slot_key: 's1', sequence_no: 1, active: true }],
    workflow_runtime: runtime,
  };
}
const runtime = [
  { workflow_id: id(4), alarms: 3, ran7: 2, last_run: '2026-10-06T09:15:42Z', runs7: 0, failed7: 0, success_rate: null, avg_duration_ms: null, last_started: null,
    items: [{ label: 'worker-pool-dispatch', schedule: '每 5 分钟', enabled: true, status: '正常', last: '2026-10-06T09:15:42Z', source: 'brain' },
      { label: 'one-shot', schedule: '{"kind":"at","at":"2026-10-05T12:30:00.000Z"}', enabled: false, status: '无记录', last: null, source: 'openclaw' }] },
  { workflow_id: id(5), alarms: 0, ran7: 0, last_run: null, runs7: 0, failed7: 0, success_rate: null, avg_duration_ms: null, last_started: null, items: [] },
  { workflow_id: id(6), alarms: 0, ran7: 0, last_run: null, runs7: 0, failed7: 0, success_rate: null, avg_duration_ms: null, last_started: null, items: [] },
  { workflow_id: id(7), alarms: 2, ran7: 0, last_run: '2026-09-01T00:00:00Z', runs7: 0, failed7: 0, success_rate: null, avg_duration_ms: null, last_started: null, items: [] },
  { workflow_id: id(8), alarms: 0, ran7: 0, last_run: '2026-10-01T00:00:00Z', runs7: 137, failed7: 3, success_rate: 0.9781, avg_duration_ms: 12345, last_started: '2026-10-06T09:40:10Z', items: [] },
];
const rowOf = (rows, wf) => rows.find(r => r.layer === 'workflows' && r.id === wf);

describe('流程库运行情况列', () => {
  it('在用吗：runs 近 7 天有记录或闹钟近 7 天跑过=在跑；有任务但近 7 天没跑；只登记 Activity；空壳', () => {
    expect(workflowUsageStatus({ ran7: 2, alarms: 3, runs7: 0, acts: 0 })).toBe('在跑');
    expect(workflowUsageStatus({ ran7: 0, alarms: 0, runs7: 9, acts: 8 })).toBe('在跑');
    expect(workflowUsageStatus({ ran7: 0, alarms: 2, runs7: 0, acts: 0 })).toBe('有任务近7天没跑');
    expect(workflowUsageStatus({ ran7: 0, alarms: 0, runs7: 0, acts: 5 })).toBe('只登记没运行');
    expect(workflowUsageStatus({ ran7: 0, alarms: 0, runs7: 0, acts: 0 })).toBe('空壳');
    expect(workflowUsageStatus(undefined)).toBe('空壳');
  });

  it('7 天统计来自 runs：次数、失败、成功率（百分比列存小数）、平均时长（秒，一位小数）；没运行记录时次数写 0、成功率与时长留空（不伪造 0%）', () => {
    const rows = buildDirectoryRows(sample(runtime), {});
    const busy = rowOf(rows, id(8)).properties, ops = rowOf(rows, id(4)).properties;
    expect(busy['7天次数']).toEqual({ number: 137 });
    expect(busy['7天失败']).toEqual({ number: 3 });
    expect(busy['7天成功率']).toEqual({ number: 0.9781 });
    expect(busy['平均时长(秒)']).toEqual({ number: 12.3 });
    expect(busy['在用吗']).toEqual({ select: { name: '在跑' } });
    expect(ops['7天次数']).toEqual({ number: 0 });
    expect(ops['7天成功率']).toEqual({ number: null });
    expect(ops['平均时长(秒)']).toEqual({ number: null });
    expect(ops['在用吗']).toEqual({ select: { name: '在跑' } });
    expect(rowOf(rows, id(5)).properties['在用吗']).toEqual({ select: { name: '只登记没运行' } });
    expect(rowOf(rows, id(6)).properties['在用吗']).toEqual({ select: { name: '空壳' } });
    expect(rowOf(rows, id(7)).properties['在用吗']).toEqual({ select: { name: '有任务近7天没跑' } });
  });

  it('旧的任务计数列一律不再写（闹钟数/启用数/失败数/静默数/步骤级运行次数/Activity 数/旧功能状态）', () => {
    for (const r of buildDirectoryRows(sample(runtime), {}).filter(r => r.layer === 'workflows')) {
      for (const k of ['Activity 数', '定时任务数', '启用任务数', '近7天有跑', '失败任务数', '静默任务数', '步骤级运行次数', '旧功能状态']) expect(r.properties).not.toHaveProperty(k);
    }
  });

  it('最近运行取 runs 与闹钟两边较新的一次，按分钟取整（Notion 日期只到分钟）；没有运行是空日期', () => {
    const rows = buildDirectoryRows(sample(runtime), {});
    expect(rowOf(rows, id(4)).properties['最近运行']).toEqual({ date: { start: '2026-10-06T09:15:00.000Z' } });
    expect(rowOf(rows, id(8)).properties['最近运行']).toEqual({ date: { start: '2026-10-06T09:40:00.000Z' } });
    expect(rowOf(rows, id(5)).properties['最近运行']).toEqual({ date: null });
  });

  it('怎么运行：逐条列出任务（启用 ●/停用 ○、频率、最近状态、最近运行），一次性任务把 JSON 化简成人话', () => {
    const rows = buildDirectoryRows(sample(runtime), {});
    const how = text(rowOf(rows, id(4)).properties['怎么运行']);
    expect(how).toContain('● worker-pool-dispatch · 每 5 分钟 · 正常');
    expect(how).toContain('○ one-shot · 一次性 2026-10-05 20:30 · 无记录'); // 上海时区：UTC 12:30 = 20:30
    expect(how).toContain('最近 10-06 17:15'); // 09:15Z = 17:15 上海
    expect(how).not.toContain('{"kind"');
    expect(text(rowOf(rows, id(5)).properties['怎么运行'])).toBe('');
  });

  it('没带运行数据（旧调用）也不报错：按引用判「只登记没运行」', () => {
    const rows = buildDirectoryRows(sample(undefined), {});
    expect(rowOf(rows, id(5)).properties['在用吗']).toEqual({ select: { name: '只登记没运行' } });
    expect(rowOf(rows, id(5)).properties['7天次数']).toEqual({ number: 0 });
  });

  it('「你的标记」是人工列：行里永远不写它，系统不会覆盖主理人点的结果', () => {
    for (const r of buildDirectoryRows(sample(runtime), {}).filter(r => r.layer === 'workflows')) {
      expect(Object.keys(r.properties)).not.toContain('你的标记');
    }
  });

  it('列定义：运行列 + 「你的标记」四个选项；其它库不受影响', () => {
    const s = buildDirectorySchemas(dbs);
    for (const k of ['7天次数', '7天失败', '平均时长(秒)']) expect(s.workflows[k]).toEqual({ number: { format: 'number' } });
    expect(s.workflows['7天成功率']).toEqual({ number: { format: 'percent' } });
    expect(s.workflows['最近运行']).toEqual({ date: {} });
    expect(s.workflows['在用吗']).toEqual({ select: {} });
    expect(s.workflows['怎么运行']).toEqual({ rich_text: {} });
    expect(s.workflows['你的标记'].select.options.map(o => o.name)).toEqual(['有用', '没用', '过期', '删']);
    expect(Object.keys(s.capabilities)).not.toContain('在用吗');
  });
});
