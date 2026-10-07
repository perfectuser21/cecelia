/** Notion 目录每一层都带完整祖先链（公司/部门/价值流/能力/流程）：选项列用来分组，「树位置」一行文字看全路径（更深的部门层只进树位置）。 */
import { describe, it, expect } from 'vitest';
import { buildDirectoryRows } from '../directory-source.js';
import { buildDirectorySchemas } from '../directory-schema.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dbs = Object.fromEntries(['areas', 'value_streams', 'capabilities', 'workflows', 'activities', 'steps'].map((k, i) => [k, id(900 + i)]));
const sel = (row, key) => row.properties[key]?.select?.name;
const txt = (row, key) => (row.properties[key]?.rich_text || []).map(t => t.text.content).join('');

function sample() {
  return {
    areas: [{ id: id(1), name: '公司R', parent_area_id: null }, { id: id(2), name: '部门D', parent_area_id: id(1) }, { id: id(3), name: '子部门S', parent_area_id: id(2) }],
    journeys: [
      { id: id(10), name: '价值流V', kind: 'value_stream', area_id: id(2) },
      { id: id(11), name: '能力C1', kind: 'capability', parent_journey_id: id(10), area_id: null },
      { id: id(12), name: '能力C2,带逗号', kind: 'capability', parent_journey_id: id(10), area_id: id(3) },
      { id: id(13), name: '无部门价值流', kind: 'value_stream', area_id: null },
      { id: id(14), name: '能力C3', kind: 'capability', parent_journey_id: id(13), area_id: null },
    ],
    workflows: [{ id: id(21), key: 'w1', name: '流程W1', capability_id: id(11) }, { id: id(22), key: 'w2', name: '流程W2', capability_id: id(12) },
      { id: id(23), key: 'w3', name: '流程W3', capability_id: id(14) }],
    activities: [{ id: id(31), name: '共用活动', executor_kind: 'agent', contract: {} }, { id: id(32), name: '独有活动', executor_kind: 'agent', contract: {} },
      { id: id(33), name: '没挂流程的活动', executor_kind: 'agent', contract: {} }],
    steps: [{ id: id(41), activity_id: id(31), key: 's1', active: true, readback: {} }],
    cells: [], uses: [], map_nodes: [],
    refs: [{ workflow_id: id(21), activity_id: id(31), slot_key: 'a', sequence_no: 1, active: true, source_ref: 'external' },
      { workflow_id: id(22), activity_id: id(31), slot_key: 'b', sequence_no: 1, active: true, source_ref: null },
      { workflow_id: id(21), activity_id: id(32), slot_key: 'c', sequence_no: 2, active: true, source_ref: 'external' }],
  };
}
const rows = buildDirectoryRows(sample(), {});
const of = (layer, rid) => rows.find(r => r.layer === layer && r.id === rid);

describe('目录祖先链', () => {
  it('流程：能力继承价值流的部门；能力挂了更深的部门，分组仍按部门、树位置写全链；不再有子部门列', () => {
    const w1 = of('workflows', id(21)), w2 = of('workflows', id(22));
    expect([sel(w1, '分组·公司'), sel(w1, '分组·部门'), sel(w1, '分组·价值流'), sel(w1, '分组·能力')]).toEqual(['公司R', '部门D', '价值流V', '能力C1']);
    expect(txt(w1, '树位置')).toBe('公司R › 部门D › 价值流V › 能力C1');
    expect(sel(w2, '分组·部门')).toBe('部门D');
    for (const r of rows) expect(r.properties, r.layer).not.toHaveProperty('分组·子部门');
    expect(txt(w2, '树位置')).toBe('公司R › 部门D › 子部门S › 价值流V › 能力C2，带逗号');
  });

  it('追不到部门的一律标「(未归属)」，不留空（Notion 空选项没法分组）', () => {
    const w3 = of('workflows', id(23));
    expect([sel(w3, '分组·公司'), sel(w3, '分组·部门'), sel(w3, '分组·价值流'), sel(w3, '分组·能力')]).toEqual(['(未归属)', '(未归属)', '无部门价值流', '能力C3']);
  });

  it('选项名不含英文逗号（Notion 会拒绝）、不超过 100 字', () => {
    const rs = buildDirectoryRows(sample(), {});
    for (const r of rs) for (const [k, v] of Object.entries(r.properties)) {
      if (!k.startsWith('分组·')) continue;
      expect(v.select.name, `${r.layer}:${k}`).not.toContain(',');
      expect(v.select.name.length).toBeLessThanOrEqual(100);
    }
    expect(sel(of('workflows', id(22)), '分组·能力')).toBe('能力C2，带逗号');
  });

  it('Activity：取「归属引用」（source_ref 为空）所在流程；没有归属引用取第一条；没挂流程标「(未挂流程)」', () => {
    const shared = of('activities', id(31)), own = of('activities', id(32)), none = of('activities', id(33));
    expect(sel(shared, '分组·流程')).toBe('流程W2');
    expect(sel(shared, '分组·能力')).toBe('能力C2，带逗号');
    expect(txt(shared, '树位置')).toBe('公司R › 部门D › 子部门S › 价值流V › 能力C2，带逗号 › 流程W2');
    expect(sel(own, '分组·流程')).toBe('流程W1');
    expect(sel(none, '分组·流程')).toBe('(未挂流程)');
    expect(sel(none, '分组·部门')).toBe('(未归属)');
  });

  it('Step 继承所属 Activity 的整条链', () => {
    const step = of('steps', id(41));
    expect(sel(step, '分组·流程')).toBe('流程W2');
    expect(txt(step, '树位置')).toContain('能力C2，带逗号 › 流程W2');
  });

  it('能力库带公司/部门/价值流；价值流库带公司/部门', () => {
    const c2 = of('capabilities', id(12)), v = of('value_streams', id(10));
    expect([sel(c2, '分组·公司'), sel(c2, '分组·部门'), sel(c2, '分组·价值流')]).toEqual(['公司R', '部门D', '价值流V']);
    expect([sel(v, '分组·公司'), sel(v, '分组·部门')]).toEqual(['公司R', '部门D']);
    expect(v.properties['分组·价值流']).toBeUndefined();
  });

  it('部门环路不会死循环', () => {
    const d = sample();
    d.areas = [{ id: id(1), name: 'A', parent_area_id: id(2) }, { id: id(2), name: 'B', parent_area_id: id(1) }];
    d.journeys[0].area_id = id(1);
    expect(() => buildDirectoryRows(d, {})).not.toThrow();
  });

  it('列定义：各库带对应的分组选项列和「树位置」，既有关联列不改名', () => {
    const s = buildDirectorySchemas(dbs);
    for (const k of ['分组·公司', '分组·部门']) expect(s.value_streams[k]).toEqual({ select: {} });
    for (const k of ['分组·公司', '分组·部门', '分组·价值流']) expect(s.capabilities[k]).toEqual({ select: {} });
    for (const k of ['分组·公司', '分组·部门', '分组·价值流', '分组·能力']) expect(s.workflows[k]).toEqual({ select: {} });
    for (const k of ['分组·公司', '分组·部门', '分组·价值流', '分组·能力', '分组·流程']) { expect(s.activities[k]).toEqual({ select: {} }); expect(s.steps[k]).toEqual({ select: {} }); }
    for (const layer of ['value_streams', 'capabilities', 'workflows', 'activities', 'steps']) { expect(s[layer]['树位置']).toEqual({ rich_text: {} }); expect(s[layer]).not.toHaveProperty('分组·子部门'); }
    expect(s.capabilities['所属价值流'].relation.database_id).toBe(dbs.value_streams);
    expect(s.workflows.Capability.relation.database_id).toBe(dbs.capabilities);
    expect(Object.keys(s.areas).some(k => k.startsWith('分组·'))).toBe(false);
  });
});
