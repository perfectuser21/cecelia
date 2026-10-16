import { describe, it, expect } from 'vitest';
const api = await import('./workflow-assembly-reconcile.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' && !error.message.includes('Failed to load url ./workflow-assembly-reconcile.js')) throw error;
  return {};
});
const identity = {tenant_id:'alpha',object_id:'authoring-a',target_version:'candidate:'+ 'a'.repeat(64),definition_sha256:'a'.repeat(64)};
const gap = {code:'recipe_missing',activity_key:'slot_a'};
const observation = extra => ({protocol:'workflow-authoring-execution-v1',...identity,status:'blocked',resource_condition:'ready',gaps:[gap],...extra});
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
    const next=evolve(first,observation({gaps:[],status:'verified',verification_id:proof,proof_sha256:proof}),{now:2000});
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
});
