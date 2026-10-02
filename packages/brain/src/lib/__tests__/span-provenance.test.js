import { it,expect } from 'vitest';
import { normalizeSpan } from '../span-ingestion.js';
import { validateSpanBinding } from '../span-provenance.js';
const id=n=>`a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const raw=()=>({run_id:'external__attempt1',activity_id:id(1),workflow_id:id(2),step_id:id(3),started_at:'2026-10-02T10:00:00Z',executor_kind:'code',occurrence_key:'step-first',identity_protocol:2,run_binding_id:id(4),reference_id:id(5),workflow_definition_version_id:id(6),activity_definition_version_id:id(7),attempt_key:'attempt1'});
function fixed(){return {binding:{id:id(4),run_id:'external__attempt1',workflow_id:id(2),workflow_definition_version_id:id(6),attempt_key:'attempt1'},release:{payload:{allowed_enabler_calls:[{id:id(8),enabler_id:id(9),caller_type:'step',caller_id:id(3),activity_id:id(1),step_id:id(3),source_status:'verified'}]}},workflow:{id:id(6),workflow_id:id(2),payload:{activities:[{reference_id:id(5),activity_id:id(1),activity_version_id:id(7)}]}},activities:[{id:id(7),activity_id:id(1),payload:{steps:[{step_id:id(3)}]}}]};}
it('v2把冻结归属纳入服务端摘要，同位置错身份不能以旧摘要冒充重传',()=>{
  const a=normalizeSpan(raw(),0),b=normalizeSpan({...raw(),reference_id:id(10)},0);
  expect(a.identity_protocol).toBe(2);expect(a.payload_sha256).not.toBe(b.payload_sha256);expect(validateSpanBinding(a,fixed())).toBeUndefined();
});
it.each(['run_binding_id','reference_id','workflow_definition_version_id','activity_definition_version_id','attempt_key'])('v2缺必填身份%s不能降级',field=>{
  const input=raw();delete input[field];expect(()=>normalizeSpan(input,0)).toThrow();
});
it('v1摘要字节协议保持，不能静默丢弃v2顶层身份',()=>{
  const input=raw();delete input.identity_protocol;expect(()=>normalizeSpan(input,0)).toThrow();
});
it.each(['run_id','workflow_id','activity_id','step_id','reference_id','activity_definition_version_id','workflow_definition_version_id','attempt_key'])('冻结运行拒绝串线：%s',field=>{
  const input={...raw(),[field]:field==='run_id'?'other-run':field==='attempt_key'?'other-attempt':id(20)};
  expect(()=>validateSpanBinding(normalizeSpan(input,0),fixed())).toThrow();
});
it('同一Activity允许两个冻结使用位置，未冻结的位置拒绝',()=>{
  const binding=fixed();binding.workflow.payload.activities.push({reference_id:id(10),activity_id:id(1),activity_version_id:id(7)});
  expect(()=>validateSpanBinding(normalizeSpan({...raw(),reference_id:id(10)},0),binding)).not.toThrow();
});
it('Enabler必须来自该运行冻结的具体caller关系',()=>{
  const input={...raw(),enabler_id:id(9),enabler_call_id:id(8)};
  expect(()=>validateSpanBinding(normalizeSpan(input,0),fixed())).not.toThrow();
  expect(()=>validateSpanBinding(normalizeSpan({...input,enabler_call_id:id(10)},0),fixed())).toThrow();
  expect(()=>validateSpanBinding(normalizeSpan({...input,step_id:null},0),fixed())).toThrow();
});
it('绑定或固定版本不存在时保持缺证据错误，绝不借当前定义',()=>{
  expect(()=>validateSpanBinding(normalizeSpan(raw(),0),null)).toThrow();
  const binding=fixed();binding.activities=[];expect(()=>validateSpanBinding(normalizeSpan(raw(),0),binding)).toThrow();
});
it('已绑定本机冻结摘要时，Span不能来自另一份代码或计划副本',()=>{
  const context=fixed();context.binding.payload={runtime_snapshot_sha256:'a'.repeat(64)};
  expect(()=>validateSpanBinding(normalizeSpan(raw(),0),context)).toThrow();
  expect(()=>validateSpanBinding(normalizeSpan({...raw(),evidence:{runtime_snapshot_sha256:'b'.repeat(64)}},0),context)).toThrow();
  expect(()=>validateSpanBinding(normalizeSpan({...raw(),evidence:{runtime_snapshot_sha256:'a'.repeat(64)}},0),context)).not.toThrow();
});
