import {it,expect} from 'vitest';
import {createSkillEnvelope} from '../orchestrator/skill-activity-adapter.js';
import {definitionDigest} from './contracts.js';
import {verifyInvocationLedger} from './execution-ledger.js';
const id='11111111-1111-4111-8111-111111111111',schema={type:'object',properties:{text:{type:'string'}},required:['text']};
async function ledger(){
 const activities=['one','two'].map(key=>({key,input_schema:schema,output_schema:schema,input_mapping:{text:'$input.text'},implementation:{kind:'skill',repo:'perfectuser21/cecelia',path:'pure/SKILL.md',revision:'a'.repeat(40)}}));
 const e=await createSkillEnvelope({tenant_id:'company-a',target:{kind:'workflow',id},input:{text:'abc'},input_sha256:definitionDigest({text:'abc'}),
  plan:{activities,output_schema:schema,output_mapping:{text:'$activity.two.text'}},authoring_task_id:id,compose_sha256:'d'.repeat(64)},
 {readFile:async()=> '---\nname: pure\nversion: 1.0.0\n---\n大写'});
 const result={protocol:'skill-invocation-result-v1',task_id:id,run_id:'actual-run',tenant_id:e.tenant_id,target:e.target,input_sha256:e.input_sha256,
  activities:e.activities.map(a=>({key:a.key,skill_sha256:a.skill_sha256,outputs:{text:'ABC'}})),outputs:{text:'ABC'}};
 const identity={run_id:'actual-run',tenant_id:e.tenant_id,target:e.target,input_sha256:e.input_sha256,envelope_sha256:e.envelope_sha256};
 return {task:{id,status:'completed',payload:{invocation:{tenant_id:e.tenant_id,target:e.target,input_sha256:e.input_sha256,envelope:e,dispatch:{run_id:'actual-run'}}},result:{skill_invocation:result}},
 runs:[{task_id:id,run_id:'actual-run',status:'success',context:{...identity,source:'skill-invocation'}}],
 events:[{event_type:'invocation_dispatch_reserved',payload:{...identity,actor:'brain'}},
 ...result.activities.map(a=>({event_type:'invocation_activity_completed',payload:{...identity,...a,actor:'codex-bridge'}})),
 {event_type:'invocation_result_verified',payload:{...identity,actor:'brain',receipt_sha256:definitionDigest(result)}}],spans:[]};
}
it('逐slot验证成功run、执行事件和映射产物；同Skill两slot不合并',async()=>{
 expect(typeof verifyInvocationLedger).toBe('function');
 const result=verifyInvocationLedger(await ledger());expect(result.outputs).toEqual({text:'ABC'});
 expect(result.activities.map(a=>a.key)).toEqual(['one','two']);
});
it.each(['tenant_id','target','input_sha256','envelope_sha256','receipt_sha256','run_id','actor'])('伪造最终事件%s不能成为真实证明',async field=>{
 const l=await ledger();l.events.at(-1).payload[field]=field==='target'?{kind:'activity',id}:'forged';
 expect(()=>verifyInvocationLedger(l)).toThrow();
});
it('缺slot、重复slot、别run的slot及篡改产物全部拒绝',async()=>{
 for(const mutate of [l=>l.events.splice(1,1),l=>l.events.push(structuredClone(l.events[1])),l=>{l.events[1].payload.run_id='other';},l=>{l.events[1].payload.outputs={text:'FAKE'};},l=>{l.task.result.skill_invocation.outputs={text:'FAKE'};}]){
  const l=await ledger();mutate(l);expect(()=>verifyInvocationLedger(l)).toThrow();
 }
});
it('新严格资格要求实际spans，文本PASS和只有启动记录都不够',async()=>{
 const l=await ledger();expect(()=>verifyInvocationLedger(l,{requireSpans:true})).toThrow();
 l.runs[0].status='running';expect(()=>verifyInvocationLedger(l)).toThrow();
});
