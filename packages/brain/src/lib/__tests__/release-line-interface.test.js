/** 发布线·接口判定（决策 de6dff5d 第 3 步）：inputs/outputs 规范化、差异、受影响上下游。纯函数。 */
import { describe, it, expect } from 'vitest';
import { normalizeInterface, interfaceDiff, affectedByInterfaceChange, interfaceSha256 } from '../release-line-interface.js';

describe('接口判定', () => {
  const c1 = { inputs: [{ type: 'Device', fields: ['serial', 'host'], cardinality: 'one' }], outputs: [{ type: 'Lead', effect: 'create', fields: ['id'] }] };
  it('规范化：fields 排序、按 type 排序，字段顺序不影响哈希', () => {
    const shuffled = { inputs: [{ cardinality: 'one', fields: ['host', 'serial'], type: 'Device' }], outputs: c1.outputs };
    expect(normalizeInterface(shuffled)).toEqual(normalizeInterface(c1));
    expect(interfaceSha256(shuffled)).toBe(interfaceSha256(c1));
  });
  it('输出字段变了 → 变化的输出类型；下游消费该类型的被列为受影响，上游不受影响', () => {
    const c2 = { ...c1, outputs: [{ type: 'Lead', effect: 'create', fields: ['id', 'score'] }] };
    const diff = interfaceDiff(c1, c2);
    expect(diff).toEqual({ changed: true, changed_input_types: [], changed_output_types: ['Lead'] });
    const affected = affectedByInterfaceChange({ activityId: 'a', diff, workflows: [{ workflow_id: 'w', slots: [
      { activity_id: 'up', sequence_no: 1, contract: { outputs: [{ type: 'Device' }] } },
      { activity_id: 'a', sequence_no: 2, contract: c2 },
      { activity_id: 'down', sequence_no: 3, contract: { inputs: [{ type: 'Lead' }] } },
      { activity_id: 'other', sequence_no: 4, contract: { inputs: [{ type: 'Run' }] } },
    ] }] });
    expect(affected).toEqual([{ activity_id: 'down', relation: 'downstream', workflow_id: 'w' }]);
  });
  it('输入变了 → 上游产出该类型的受影响；接口没变 → 空', () => {
    const c3 = { ...c1, inputs: [{ type: 'Device', fields: ['serial'], cardinality: 'one' }] };
    const diff = interfaceDiff(c1, c3);
    expect(diff.changed_input_types).toEqual(['Device']);
    const affected = affectedByInterfaceChange({ activityId: 'a', diff, workflows: [{ workflow_id: 'w', slots: [
      { activity_id: 'up', sequence_no: 1, contract: { outputs: [{ type: 'Device' }] } }, { activity_id: 'a', sequence_no: 2, contract: c3 }] }] });
    expect(affected).toEqual([{ activity_id: 'up', relation: 'upstream', workflow_id: 'w' }]);
    expect(affectedByInterfaceChange({ activityId: 'a', diff: interfaceDiff(c1, c1), workflows: [] })).toEqual([]);
  });
});

