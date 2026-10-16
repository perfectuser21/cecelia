import { describe, it, expect } from 'vitest';
const api = await import('./workflow-assembly-reconcile.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' && !error.message.includes('Failed to load url ./workflow-assembly-reconcile.js')) throw error;
  return {};
});
const identity = {tenant_id:'alpha',object_id:'authoring-a',target_version:'candidate:'+ 'a'.repeat(64),definition_sha256:'a'.repeat(64)};
const gap = {code:'recipe_missing',activity_key:'slot_a'};
const observation = extra => ({protocol:'workflow-authoring-execution-v1',...identity,status:'blocked',qualified:true,resource_condition:'ready',gaps:[gap],...extra});
const evolve = (...args) => {
  expect(api.reconcileGapState).toBeTypeOf('function');
  return api.reconcileGapState(...args);
};
describe('固定租户对象版本的持续对账',()=>{
  it('同gap稳定身份不受错误文案及修复任务completed影响',()=>{
    const first=evolve(null,observation(),{now:1000});
    const issue=Object.values(first.issues)[0];issue.repair_task_id='repair-a';issue.repair_task_status='completed';
    const next=evolve(first,observation({gaps:[{...gap,message:'different error'}]}),{now:2000});
    expect(Object.keys(next.issues)).toEqual(Object.keys(first.issues));
    expect(Object.values(next.issues)[0]).toMatchObject({status:'open',repair_task_id:'repair-a'});
  });
  it('缺口消失但没有同版本真实proof仍不得关闭',()=>{
    const first=evolve(null,observation(),{now:1000});
    const pending=evolve(first,observation({gaps:[]}),{now:2000});
    expect(Object.values(pending.issues)[0].status).toBe('awaiting_verification');
    const forged=evolve(pending,observation({gaps:[],status:'verified',verification_id:'text-PASS'}),{now:3000});
    expect(Object.values(forged.issues)[0].status).not.toBe('closed');
  });
  it('同版本可信readiness才关闭，保留责任单及proof身份',()=>{
    const first=evolve(null,observation(),{now:1000});
    Object.values(first.issues)[0].repair_task_id='repair-a';
    const proof='b'.repeat(64);
    const next=evolve(first,observation({gaps:[],status:'verified',verification_id:proof,proof_sha256:proof,verification_at:new Date(1500).toISOString()}),{now:2000});
    expect(Object.values(next.issues)[0]).toMatchObject({status:'closed',repair_task_id:'repair-a',verification_id:proof});
  });
  it('新版本独立计数，跨租户或对象state不允许混用',()=>{
    const first=evolve(null,observation(),{now:1000});
    const version=evolve(first,observation({target_version:'candidate:'+'c'.repeat(64),definition_sha256:'c'.repeat(64)}),{now:2000});
    expect(Object.keys(version.issues)).not.toEqual(Object.keys(first.issues));
    expect(()=>evolve(first,observation({tenant_id:'beta'}),{now:2000})).toThrow(/identity/);
    expect(()=>evolve(first,observation({object_id:'other'}),{now:2000})).toThrow(/identity/);
  });
  it('safe_stop退避保留原修复链，unknown不当恢复，ready后才接回',()=>{
    const first=evolve(null,observation(),{now:1000});Object.values(first.issues)[0].repair_task_id='repair-a';
    const stopped=evolve(first,observation({resource_condition:'safe_stop'}),{now:2000});
    expect(stopped).toMatchObject({status:'waiting_resource',next_check_at:62000});
    expect(Object.values(stopped.issues)[0].repair_task_id).toBe('repair-a');
    const again=evolve(stopped,observation({resource_condition:'safe_stop'}),{now:3000});
    expect(again.next_check_at).toBe(stopped.next_check_at);
    const unknown=evolve(again,observation({resource_condition:'unknown'}),{now:63000});
    expect(unknown.status).toBe('waiting_resource');
    const resumed=evolve(unknown,observation(),{now:200000});
    expect(resumed.status).toBe('open');
    expect(Object.values(resumed.issues)[0].repair_task_id).toBe('repair-a');
  });
  it('同target但不同定义摘要不能借proof关闭旧问题',()=>{
    const first=evolve(null,observation(),{now:1000});
    const proof='b'.repeat(64);
    const next=evolve(first,observation({definition_sha256:'c'.repeat(64),gaps:[],status:'verified',verification_id:proof,proof_sha256:proof,verification_at:new Date(1500).toISOString()}),{now:2000});
    expect(Object.values(next.issues)[0].status).not.toBe('closed');
  });
  it('已关账再次发现缺口撤掉当前验证标记，保留历史proof',()=>{
    const first=evolve(null,observation(),{now:1000}),proof='b'.repeat(64);
    const closed=evolve(first,observation({gaps:[],status:'verified',verification_id:proof,proof_sha256:proof,verification_at:new Date(1500).toISOString()}),{now:2000});
    const opened=evolve(closed,observation(),{now:3000});
    expect(Object.values(opened.issues)[0]).toMatchObject({status:'open',last_verification_id:proof});
    expect(Object.values(opened.issues)[0].verification_id).toBeUndefined();
    expect(Object.values(opened.issues)[0].verified_at).toBeUndefined();
  });
});

it('故障前旧成功run不能关闭修复后的缺口，修复后新真实完成时间才可关闭',()=>{
 const first=evolve(null,observation(),{now:1000}),proof='d'.repeat(64);
 Object.values(first.issues)[0].repaired_at=2000;
 const old=evolve(first,observation({gaps:[],status:'verified',proof_sha256:proof,verification_id:proof,verification_at:new Date(500).toISOString()}),{now:3000});
 expect(old.status).toBe('open');expect(Object.values(old.issues)[0].status).toBe('awaiting_verification');
 const fresh=evolve(old,observation({gaps:[],status:'verified',proof_sha256:proof,verification_id:proof,verification_at:new Date(2500).toISOString()}),{now:4000});
 expect(Object.values(fresh.issues)[0].status).toBe('closed');
});
it('已关闭故障复发必须重新设定检测时刻，不能借之前新于首次检测的proof',()=>{
 const first=evolve(null,observation(),{now:1000}),proof='d'.repeat(64);
 const closed=evolve(first,observation({gaps:[],status:'verified',proof_sha256:proof,verification_id:proof,verification_at:new Date(1500).toISOString()}),{now:2000});
 const reopened=evolve(closed,observation(),{now:3000});
 const stale=evolve(reopened,observation({gaps:[],status:'verified',proof_sha256:proof,verification_id:proof,verification_at:new Date(1500).toISOString()}),{now:4000});
 expect(Object.values(stale.issues)[0].status).toBe('awaiting_verification');
});
it('真实proof已绿但尚无匹配测试资格时不得宣称整体闭环完成',()=>{
 const proof='e'.repeat(64),ready=observation({gaps:[],status:'verified',proof_sha256:proof,verification_id:proof,verification_at:new Date(1500).toISOString()});
 expect(evolve(null,{...ready,qualified:false},{now:2000}).status).not.toBe('verified');
 expect(evolve(null,{...ready,qualified:undefined},{now:2000}).status).not.toBe('verified');
 expect(evolve(null,{...ready,qualified:true},{now:2000}).status).toBe('verified');
});
it('新目标版本不继承旧版本资源退避窗口',()=>{
 const a=evolve(null,observation({resource_condition:'safe_stop'}),{now:1000});
 const b=evolve(a,observation({resource_condition:'safe_stop'}),{now:100000});expect(b.resource_attempts).toBe(2);
 const next=evolve(b,observation({resource_condition:'safe_stop',target_version:'candidate:'+'f'.repeat(64),definition_sha256:'f'.repeat(64)}),{now:101000});
 expect(next.resource_attempts).toBe(1);expect(next.next_check_at).toBe(161000);
});
it('正常执行等待不启动资源退避，但明确safe_stop优先且仍不授资格',()=>{
 const pending=evolve(null,observation({resource_condition:'unknown',awaiting_execution:true}),{now:1000});
 expect(pending.status).toBe('awaiting_execution');expect(pending.next_check_at).toBe(0);expect(pending.resource_attempts).toBe(0);expect(pending.qualified).toBe(false);
 const stopped=evolve(null,observation({resource_condition:'safe_stop',awaiting_execution:true}),{now:1000});
 expect(stopped.status).toBe('waiting_resource');expect(stopped.next_check_at).toBe(61000);
});
