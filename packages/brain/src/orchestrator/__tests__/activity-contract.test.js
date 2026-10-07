import { describe, test, expect } from 'vitest';
import { parseActivityContract, parseActivityResult, readActivityPath } from '../activity-contract.js';

const activity = (key, order, runtime = {}) => ({ key, order,
  budget: { max_duration_s: 10, heartbeat_s: 1 },
  failure: { empty_ok: [], retryable: [], fatal: ['invalid'], needs_human: { cases: [] } },
  runtime: { protocol: 'json-stdio-v1', entry: '_nested/activity.js', phase: 'batch_end', ...runtime } });
const group = { group: 'objects', items: '$.objects', input: 'object', identity: 'id' };

describe('activity-contract JSON边界校验', () => {
  test('规范化排序使用副本，不能改变调用方冻结契约', () => {
    const source = { workflow: 'offline', activities: [activity('later', 2), activity('first', 1)] };
    const parsed = parseActivityContract(source);
    expect(parsed.activities.map(a => a.key)).toEqual(['first', 'later']);
    parsed.activities[0].budget.max_duration_s = 99;
    expect(source.activities.map(a => a.key)).toEqual(['later', 'first']);
    expect(source.activities[1].budget.max_duration_s).toBe(10);
  });
  test('同组绑定不同必须拒绝，不能让条目在活动之间换身份', () => {
    const first = activity('first', 1, { phase: 'per_item', per_item: group });
    const next = activity('next', 2, { phase: 'per_item', per_item: { ...group, identity: 'other_id' } });
    expect(() => parseActivityContract({ workflow: 'offline', activities: [first, next] })).toThrow('per_item_group_binding_mismatch');
  });
  test('同组跨batch分段必须拒绝，防止活动外循环重排条目链', () => {
    const first = activity('first', 1, { phase: 'per_item', per_item: group });
    const last = activity('last', 3, { phase: 'per_item', per_item: group });
    expect(() => parseActivityContract({ workflow: 'offline', activities: [first, activity('between', 2), last] })).toThrow('per_item_group_not_contiguous');
  });
  test('字段路径只读自身属性，原型链与危险字段不能作为输入', () => {
    const context = Object.create({ inherited: 'secret' }); context.present = 'local';
    const roots = { context, input: {}, item: {} };
    expect(readActivityPath('$.present', roots)).toBe('local');
    expect(readActivityPath('$.inherited', roots)).toBeUndefined();
    expect(() => readActivityPath('$input.constructor', roots)).toThrow('invalid_input_path');
  });
  test('completed携带失败类别或跨业务线回执必须拒绝', () => {
    const input = { run_tag: 'run', line_key: 'line' };
    const result = { schema_version: 1, run_tag: 'run', line_key: 'line', status: 'completed',
      failure_class: null, outputs: {}, metrics: {}, evidence: [] };
    expect(parseActivityResult(result, input)).toEqual(result);
    expect(() => parseActivityResult({ ...result, failure_class: 'fatal' }, input)).toThrow('activity_result_failure_invalid');
    expect(() => parseActivityResult({ ...result, line_key: 'another' }, input)).toThrow('activity_result_identity_mismatch');
  });
});
