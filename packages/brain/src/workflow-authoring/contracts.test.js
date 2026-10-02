import { describe, expect, it } from 'vitest';
import { definitionDigest, validateRequest, validateSubmission } from './contracts.js';

describe('workflow authoring 输入合同', () => {
  it('对象键顺序不改变定义指纹，活动顺序改变指纹', () => {
    expect(definitionDigest({ a: 1, b: [1, 2] })).toBe(definitionDigest({ b: [1, 2], a: 1 }));
    expect(definitionDigest({ b: [1, 2] })).not.toBe(definitionDigest({ b: [2, 1] }));
  });
  it.each([
    {}, { operation: 'delete', goal: 'g', actor: 'openclaw' },
    { operation: 'create', goal: ' ', actor: 'openclaw' },
    { operation: 'create', goal: 'g', actor: '' },
    { operation: 'update', goal: 'g', actor: 'openclaw' },
  ])('拒绝无效初始化参数 %j', request => {
    expect(() => validateRequest(request)).toThrow();
  });
  it('拒绝超大输出及无效阶段、版本、提交标识', () => {
    const valid = { stage: 'intake', revision: 0, submission_id: 'intake-1', output: {} };
    expect(() => validateSubmission(valid)).not.toThrow();
    for (const change of [{ stage: 'completed' }, { revision: -1 }, { submission_id: '' },
      { output: { evidence: 'a'.repeat(270000) } }]) {
      expect(() => validateSubmission({ ...valid, ...change })).toThrow();
    }
  });
  it('更新的 expected_version 使用语义版本，与状态 revision 整数区分', () => {
    const request = { operation: 'update', goal: '更新流程', actor: 'openclaw', expected_version: '1.0.0' };
    expect(() => validateRequest(request)).not.toThrow();
    for (const expected_version of [1, '1', '01.0.0', '', null]) {
      expect(() => validateRequest({ ...request, expected_version })).toThrow();
    }
  });
});
