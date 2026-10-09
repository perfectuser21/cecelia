/** 每层只挂直接上级；上级的上级不再存列（分组·* 全删），只靠「树位置」一行文字显示全路径（部门树全链 + 价值流/能力/流程，不含自己）。 */
import { describe, it, expect } from 'vitest';
import { buildDirectoryRows } from '../directory-source.js';
import { buildDirectorySchemas } from '../directory-schema.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dbs = Object.fromEntries(['areas', 'value_streams', 'capabilities', 'workflows', 'activities', 'steps'].map((k, i) => [k, id(900 + i)]));
const txt = (row, key) => (row.properties[key]?.rich_text || []).map(t => t.text.content).join('');

function sample() {
  return {
    areas: [{ id: id(1), name: '公司R', parent_area_id: null }, { id: id(2), name: '部门D', parent_area_id: id(1) }, { id: id(3), name: '子部门S', parent_area_id: id(2) }],
    journeys: [
      { id: id(10), name: '价值流V', kind: 'value_stream', area_id: id(3) },
      { id: id(11), name: '能力C1', kind: 'capability', parent_journey_id: id(10), area_id: null },
      { id: id(12), name: '能力C2,带逗号', kind: 'capability', parent_journey_id: id(10), area_id: id(2) },
      { id: id(13), name: '无部门价值流', kind: 'value_stream', area_id: null },
      { id: id(14), name: '能力C3', kind: 'capability', parent_journey_id: id(13), area_id: null },
    ],
    workflows: [{ id: id(21), key: 'w1', name: '流程W1', capability_id: id(11) }, { id: id(22), key: 'w2', name: '流程W2', capability_id: id(12) },
      { id: id(23), key: 'w3', name: '流程W3', capability_id: id(14) }],
    activities: [{ id: id(31), name: '共用活动', executor_kind: 'agent' }, { id: id(32), name: '独有活动', executor_kind: 'agent' },
      { id: id(33), name: '没挂流程的活动', executor_kind: 'agent' }],
    steps: [{ id: id(41), activity_id: id(31), key: 's1', active: true, readback: {} }],
    cells: [], uses: [], map_nodes: [],
    refs: [{ workflow_id: id(21), activity_id: id(31), slot_key: 'a', sequence_no: 1, active: true, source_ref: 'external' },
      { workflow_id: id(22), activity_id: id(31), slot_key: 'b', sequence_no: 1, active: true, source_ref: null },
      { workflow_id: id(21), activity_id: id(32), slot_key: 'c', sequence_no: 2, active: true, source_ref: 'external' }],
  };
}
const rows = buildDirectoryRows(sample(), {});
const of = (layer, rid) => rows.find(r => r.layer === layer && r.id === rid);

describe('树位置与直接上级', () => {
  it('价值流可挂子部门：「所属部门」连子部门，树位置写公司›部门›子部门', () => {
    const v = of('value_streams', id(10));
    expect(v.relations['所属部门']).toEqual([{ layer: 'areas', id: id(3) }]);
    expect(txt(v, '树位置')).toBe('公司R › 部门D › 子部门S');
  });

  it('能力/流程：只挂直接上级，树位置写全部祖先；能力自己挂了部门用自己的，否则继承价值流的', () => {
    const c1 = of('capabilities', id(11)), w1 = of('workflows', id(21)), w2 = of('workflows', id(22));
    expect(Object.keys(c1.relations).sort()).toEqual(['所属价值流', '流程'].sort());
    expect(txt(c1, '树位置')).toBe('公司R › 部门D › 子部门S › 价值流V');
    expect(Object.keys(w1.relations).sort()).toEqual(['Activity', '所属能力'].sort());
    expect(txt(w1, '树位置')).toBe('公司R › 部门D › 子部门S › 价值流V › 能力C1');
    expect(txt(w2, '树位置')).toBe('公司R › 部门D › 价值流V › 能力C2,带逗号');
  });

  it('追不到部门的写「(未归属)」', () => {
    expect(txt(of('workflows', id(23)), '树位置')).toBe('(未归属) › 无部门价值流 › 能力C3');
  });

  it('Activity：取「归属引用」（source_ref 为空）所在流程；没有归属引用取第一条；没挂流程只写部门链', () => {
    expect(txt(of('activities', id(31)), '树位置')).toBe('公司R › 部门D › 价值流V › 能力C2,带逗号 › 流程W2');
    expect(txt(of('activities', id(32)), '树位置')).toBe('公司R › 部门D › 子部门S › 价值流V › 能力C1 › 流程W1');
    expect(txt(of('activities', id(33)), '树位置')).toBe('(未归属)');
    expect(Object.keys(of('activities', id(31)).relations).sort()).toEqual(['Step', '所属流程'].sort());
  });

  it('Step 只挂所属 Activity，不写树位置', () => {
    const step = of('steps', id(41));
    expect(Object.keys(step.relations)).toEqual(['所属Activity']);
    expect(step.properties).not.toHaveProperty('树位置');
  });

  it('任何层都不再写 分组·* 列', () => {
    for (const r of rows) for (const k of Object.keys(r.properties)) expect(k.startsWith('分组·'), `${r.layer}.${k}`).toBe(false);
    const s = buildDirectorySchemas(dbs);
    for (const layer of Object.keys(s)) for (const k of Object.keys(s[layer])) expect(k.startsWith('分组·')).toBe(false);
  });

  it('部门环路不会死循环', () => {
    const d = sample();
    d.areas = [{ id: id(1), name: 'A', parent_area_id: id(2) }, { id: id(2), name: 'B', parent_area_id: id(1) }];
    d.journeys[0].area_id = id(1);
    expect(() => buildDirectoryRows(d, {})).not.toThrow();
  });
});
