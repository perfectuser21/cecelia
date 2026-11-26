import {describe,it,expect,vi} from 'vitest';
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

const registered='a'.repeat(40);
const deployed='b'.repeat(40);

function fixture() {
  const pool={
    query:vi.fn(async()=>({rows:[{source_commit:registered}]})),
    connect:vi.fn(),
  };
  return pool;
}

it('已登记和已部署 Commit 相同时，固定来源读取失败不会重试或获得执行权限',async()=>{
  const pool=fixture(),failure=Error('GitHub Object Unavailable');
  const readSource=vi.fn(async()=>{throw failure;});
  await expect(native.runNativeReconcile(pool,{request_key:'same-source'},{
    readSource,revision:registered,
  })).rejects.toBe(failure);
  expect(readSource).toHaveBeenCalledTimes(1);
  expect(readSource.mock.calls[0][0]).toBe(registered);
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(pool.connect).not.toHaveBeenCalled();
});

it('已部署 Commit 不同，仍核验该固定来源，核验失败不执行',async()=>{
  const pool=fixture();
  const registeredFailure=Error('Registered Source Unavailable'),deployedFailure=Error('Deployed Source Unavailable');
  const readSource=vi.fn(async revision=>{
    throw revision===registered?registeredFailure:deployedFailure;
  });
  await expect(native.runNativeReconcile(pool,{request_key:'different-source'},{
    readSource,revision:deployed,
  })).rejects.toBe(deployedFailure);
  expect(readSource.mock.calls.map(([revision])=>revision)).toEqual([registered,deployed]);
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(pool.connect).not.toHaveBeenCalled();
});
