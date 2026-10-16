import {describe,it,expect} from 'vitest';
import * as native from './workflow-assembly-native.js';

describe('native对账只报告真实本轮结果，不授业务测试资格',()=>{
  it.each([
    [{checked:0,errors:0},'pass','empty'],
    [{checked:2,errors:0},'pass','checked'],
    [{checked:1,errors:1},'fail','partial_error'],
    [{checked:1,errors:0,stopped:'budget'},'timeout','budget'],
    [{stopped:'cancelled'},'unknown','cancelled'],
    [{skipped:'locked'},'skipped','locked'],
  ])('结果%j不能误映射成完全通过',(report,outcome,reason)=>{
    expect(native.nativeReconcileOutcome(report)).toEqual({outcome,reason});
  });
  it('管理员全局入口拒绝伪装成单租户与放大预算的请求',()=>{
    for(const input of [{tenant_id:'alpha'},{budgetMs:60000},{runner:'other'},{scope:'tenant'}]){
      expect(()=>native.validateNativeReconcileRequest(input)).toThrow();
    }
    expect(native.validateNativeReconcileRequest({request_key:'review-1'})).toEqual({request_key:'review-1'});
  });
});
