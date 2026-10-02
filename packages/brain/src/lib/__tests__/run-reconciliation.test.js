import { it,expect } from 'vitest';
const service=await import('../run-reconciliation.js').catch(()=>({}));
const context={binding:{id:'binding',run_id:'run',release_id:'release',expected_path:[{reference_id:'ref-a',activity_id:'activity',activity_definition_version_id:'av',required:true},{reference_id:'ref-a',activity_id:'activity',activity_definition_version_id:'av',step_id:'step',required:true}]}};
const span=(extra={})=>({id:'span',run_id:'run',identity_protocol:2,run_binding_id:'binding',reference_id:'ref-a',activity_id:'activity',activity_definition_version_id:'av',started_at:'2026-10-02T00:00:00Z',ended_at:'2026-10-02T00:00:10Z',outcome:'pass',...extra});
const reconcile=(spans,extra={})=>service.reconcileRunEvidence({run_id:'run',context,spans,...extra});
it('无绑定旧记录明确unknown，不从活动名称或当前定义补造归属',()=>{
  expect(service.reconcileRunEvidence).toBeTypeOf('function');
  const r=reconcile([span()],{context:null});expect(r.evidence_status).toBe('unknown');expect(r.business_outcome).toBe('unknown');expect(r.gaps).toContainEqual(expect.objectContaining({code:'RUN_BINDING_MISSING'}));
});
it('缺Step不因Activity pass而判全过，业务结果和证据完整性分列',()=>{
  const r=reconcile([span()]);expect(r.evidence_status).toBe('incomplete');expect(r.business_outcome).toBe('unknown');expect(r.missing).toEqual([expect.objectContaining({step_id:'step'})]);
  const failed=reconcile([span({outcome:'fail'})]);expect(failed.business_outcome).toBe('fail');expect(failed.evidence_status).toBe('incomplete');
});
it('共享活动重复位置分别核验，另一个reference不能冒领必经路径',()=>{
  const r=reconcile([span({reference_id:'ref-b'}),span({reference_id:'ref-b',step_id:'step'})]);expect(r.missing).toHaveLength(2);expect(r.evidence_status).toBe('incomplete');
});
it('Activity/Step/Enabler耗时分别统计且墙钟不重复相加',()=>{
  const r=reconcile([span(),span({id:'step-span',step_id:'step'}),span({id:'call-span',step_id:'step',enabler_id:'enabler',ended_at:'2026-10-02T00:00:02Z'})]);
  expect(r.business_outcome).toBe('pass');expect(r.evidence_status).toBe('verified');expect(r.duration_ms).toEqual({wall:10000,activity:10000,step:10000,enabler:2000});
});
it('Enabler成功不代替Step成功，未结束段不能认作完整执行',()=>{
  expect(reconcile([span(),span({step_id:'step',enabler_id:'enabler'})]).missing).toHaveLength(1);
  const r=reconcile([span(),span({step_id:'step',ended_at:null})]);expect(r.business_outcome).toBe('unknown');expect(r.evidence_status).toBe('incomplete');
});
it('skipped需原因和分支证据，不能用静态步骤补造通过',()=>{
  const rows=[span(),span({step_id:'step',outcome:'skipped',evidence:{skip_reason:'无需操作'}})];
  expect(reconcile(rows).evidence_status).toBe('incomplete');
  rows[1].evidence.branch_evidence={condition:'empty-input',observed:true};
  const r=reconcile(rows);expect(r.evidence_status).toBe('verified');expect(r.business_outcome).toBe('skipped');
});
it('旧生命周期success不掩盖丢失Span，存在冲突须显式报告',()=>{
  const r=reconcile([span({outcome:'fail'})],{task_run:{status:'success'}});expect(r.business_outcome).toBe('fail');expect(r.gaps).toContainEqual(expect.objectContaining({code:'LIFECYCLE_OUTCOME_CONFLICT'}));
});
