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

it('显式装配请求必须有冻结协议，不能回退到旧登记',()=>{
 expect(()=>validateRequest({operation:'create',actor:'装配器',goal:'登记',assembly_mode:true})).toThrow();
 expect(()=>validateRequest({operation:'create',actor:'装配器',goal:'登记',assembly_mode:true,registration_protocol:'definition-freeze-v1'})).not.toThrow();
});
it('新执行资格协议显式选择且必须严格冻结；旧文字PASS不自动升级',()=>{
 const base={operation:'create',actor:'装配器',goal:'验真'};
 expect(()=>validateRequest({...base,execution_protocol:'future'})).toThrow();
 expect(()=>validateRequest({...base,execution_protocol:'workflow-authoring-execution-v1'})).toThrow();
 expect(()=>validateRequest({...base,execution_protocol:'workflow-authoring-execution-v1',assembly_mode:true,registration_protocol:'definition-freeze-v1',validation_input:{text:'abc'}})).not.toThrow();
});
