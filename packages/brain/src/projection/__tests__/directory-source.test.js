import { describe, it, expect } from 'vitest';
import { propsDigest } from '../../lib/notion-projection-engine.js';

const api = await import('../directory-source.js').catch(() => ({}));
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function sample() {
  return {
    areas: [{ id: uid(1), name: '部门', notion_id: uid(101) }],
    journeys: [{ id: uid(2), name: '产品', kind: 'value_stream', area_id: uid(1) },
      { id: uid(3), name: '能力', kind: 'capability', parent_journey_id: uid(2), area_id: null }],
    workflows: [{ id: uid(4), key: 'a', name: '流程A', capability_id: uid(3) },
      { id: uid(5), key: 'b', name: '流程B', capability_id: uid(3) }],
    activities: [{ id: uid(6), name: '共享活动', workflow_id: uid(4), executor_kind: 'agent', contract: {} }],
    steps: [{ id: uid(7), activity_id: uid(6), key: 'read', active: true, readback: { expect: '完成' } }],
    refs: [{ workflow_id: uid(4), activity_id: uid(6), slot_key: 'first', sequence_no: 1, active: true },
      { workflow_id: uid(5), activity_id: uid(6), slot_key: 'second', sequence_no: 2, active: true }],
    map_nodes: [{ scope: 'cecelia', node_key: 'product', name: '产品', notion_id: uid(102), active: true }],
  };
}
const config = { value_stream_bindings: [{ journey_id: uid(2), scope: 'cecelia', node_key: 'product' }] };
describe('六层目录源映射', () => {
  it('跨Workflow同sequence和slot的引用输入反序仍有相同使用位置、编排和属性hash', () => {
    const data = sample();
    data.refs = [
      { workflow_id: uid(5), activity_id: uid(6), slot_key: 'same', sequence_no: 1, active: true },
      { workflow_id: uid(4), activity_id: uid(6), slot_key: 'same', sequence_no: 1, active: true },
      { workflow_id: uid(4), activity_id: uid(6), slot_key: 'later', sequence_no: 2, active: true },
    ];
    const forward = api.buildDirectoryRows(data, config);
    const reverse = api.buildDirectoryRows({ ...data, refs: [...data.refs].reverse() }, config);
    const properties = rows => rows.map(r => ({ id: r.id, properties: r.properties }));
    expect(properties(reverse)).toEqual(properties(forward));
    expect(reverse.map(r => propsDigest(r.properties))).toEqual(forward.map(r => propsDigest(r.properties)));
    expect(forward.find(r => r.id === uid(6)).properties['使用位置'].rich_text[0].text.content).toBe(
      `${uid(4)} / same / 1\n${uid(5)} / same / 1\n${uid(4)} / later / 2`);
    expect(forward.find(r => r.id === uid(4)).properties['活动编排'].rich_text[0].text.content).toBe(
      `1. same → ${uid(6)}\n2. later → ${uid(6)}`);
  });
  it('显式binding分别固定两个模型名称，不要求同名；KR asserts不能丢',()=>{
    const data=sample();data.journeys[0].name='工厂价值流';data.map_nodes[0].name='工厂';
    data.steps[0].readback={asserts:'完整建议JSON',implementation:'repo#run'};
    const rows=api.buildDirectoryRows(data,{value_stream_bindings:[{...config.value_stream_bindings[0],expected_node_name:'工厂',expected_journey_name:'工厂价值流'}]});
    expect(rows.find(r=>r.id===uid(2)).pageId).toBe(uid(102));
    expect(rows.find(r=>r.id===uid(7)).properties['验收标准'].rich_text[0].text.content).toBe('完整建议JSON');
    expect(rows.find(r=>r.id===uid(4)).gaps).toEqual(expect.arrayContaining(['workflow_trigger_undeclared','workflow_input_undeclared','workflow_output_undeclared']));
  });
  it('导出独立源映射入口', () => expect(api.buildDirectoryRows).toBeTypeOf('function'));
  it('共享活动和步骤使用所有active引用，保真身ID而非legacy单父', () => {
    const rows = api.buildDirectoryRows(sample(), config);
    expect(rows.find(r => r.id === uid(6)).relations['所属Workflows']).toEqual([
      { layer: 'workflows', id: uid(4) }, { layer: 'workflows', id: uid(5) },
    ]);
    expect(rows.find(r => r.id === uid(7)).relations['所属Workflows']).toHaveLength(2);
    expect(rows.find(r => r.id === uid(6)).properties['使用位置'].rich_text[0].text.content).toContain('second');
  });
  it('无显式绑定不凭同名认领价值流，也不许可新建该层页', () => {
    const vs = api.buildDirectoryRows(sample(), {}).find(r => r.id === uid(2));
    expect(vs.pageId).toBeNull(); expect(vs.allowCreate).toBe(false);
    expect(vs.gaps).toContain('value_stream_binding_missing');
  });
  it('绑定来源名不匹配、失活或重复都拒绝', () => {
    const data = sample(); data.map_nodes[0].name = '其它';
    expect(() => api.buildDirectoryRows(data, config)).toThrow(/绑定/);
    data.map_nodes[0].name = '产品'; data.map_nodes[0].active = false;
    expect(() => api.buildDirectoryRows(data, config)).toThrow(/绑定/);
    expect(() => api.buildDirectoryRows(sample(), { value_stream_bindings: [...config.value_stream_bindings, ...config.value_stream_bindings] })).toThrow(/重复/);
  });
  it('Areas只写机器列，不改Name、Parent、负责人；执行体不是负责人', () => {
    const rows = api.buildDirectoryRows(sample(), config);
    const area = rows.find(r => r.layer === 'areas');
    expect(area.properties).not.toHaveProperty('Name'); expect(area.properties).not.toHaveProperty('Parent');
    expect(area.properties).not.toHaveProperty('负责人');
    expect(rows.find(r => r.id === uid(6)).properties['责任主体'].rich_text[0].text.content).toBe('unknown');
  });
  it('缺实现声明保留gap；关系移除生成已知空数组', () => {
    const data = sample(); data.refs = [];
    const rows = api.buildDirectoryRows(data, config);
    expect(rows.find(r => r.id === uid(7)).gaps).toContain('implementation_unknown');
    expect(rows.find(r => r.id === uid(4)).relations.Activities).toEqual([]);
  });
});
