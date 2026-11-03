// GP-Anchor: f1/step4 — 固定装配计划到Skill载荷、再到交付回执；任一身份漂移不得完成。
import {it,expect} from 'vitest';
import {compileInvocation} from '../../../packages/brain/src/orchestrator/invocation-plan.js';
import {createSkillEnvelope,assertSkillEnvelope,invocationPrompt,activityInvocationPrompt,validateSkillReceipt} from '../../../packages/brain/src/orchestrator/skill-activity-adapter.js';
import {runInvocationActivities,guardInvocationCallback} from '../../../packages/brain/src/invocations/runtime.js';
import {definitionDigest} from '../../../packages/brain/src/workflow-authoring/contracts.js';
it('F1 step4 固定Skill全文进入调用边，结构化产物与原输入/版本/运行完全一致才交付',async()=>{
 const schema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
 const skill_id='11111111-1111-4111-8111-111111111111';
 const definition={key:'pure',source:{repo:'perfectuser21/cecelia',ref:'flow.json',revision:'a'.repeat(40)},input_schema:schema,output_schema:schema,activities:[{key:'pure',executor_kind:'agent',mutation_intent:'none',runtime:{transport:'codex-bridge'},input_schema:schema,output_schema:schema,acceptance:['输出原文'],implementation:{kind:'skill',skill_id,repo:'perfectuser21/cecelia',path:'pure/SKILL.md',revision:'a'.repeat(40)}}]};
 const input={text:'交付回执'},plan=compileInvocation(definition,{skills:[{id:skill_id,status:'active'}]},{input});
 expect(plan.gaps).toEqual([]);
 const content='---\nname: pure\nversion: 1.0.0\n---\n仅把输入text返回为输出text。';
 const candidateTrace={protocol:'workflow-authoring-execution-v1',authoring_task_id:'authoring',tenant_id:'default',definition_sha256:definitionDigest(definition),workflow_id:'workflow',workflow_definition_version_id:'version',slots:[{slot_key:'pure',activity_id:'activity',activity_definition_version_id:'build',steps:[]}]};
 const envelope=await createSkillEnvelope({candidateTrace,tenant_id:'default',target:{kind:'workflow',id:'fixture',definition_version_id:'fixed'},input,input_sha256:definitionDigest(input),plan},{readFile:async()=>content});
 expect(()=>assertSkillEnvelope(envelope)).not.toThrow();
 expect(()=>assertSkillEnvelope({...envelope,candidate_trace:{...candidateTrace,tenant_id:'other'}})).toThrow('快照摘要');
 expect(()=>assertSkillEnvelope({...envelope,candidate_trace:{...candidateTrace,slots:[]}})).toThrow('快照摘要');
 expect(()=>invocationPrompt(envelope,'task','run')).toThrow('公共Runner逐Activity');
 expect(envelope.candidate_trace).toEqual(candidateTrace);
 expect(envelope.runner_policy.protocol).toBe('skill-invocation-runner-v1');
 expect(()=>invocationPrompt({...envelope,candidate_trace:{...candidateTrace,workflow_id:'other'}},'task','run')).toThrow('快照摘要');
 const events=[],requests=[];
 const task={id:'task',payload:{invocation:{tenant_id:'default',target:envelope.target,input_sha256:envelope.input_sha256,request_key:'fixed-receipt',envelope,dispatch:{run_id:'run'}}}};
 const db={query:async(sql,args)=>{events.push({sql,payload:JSON.parse(args[1])});return {rows:[]};}};
 const outcome=await runInvocationActivities(db,task,'run',{
  commander:{status:'unavailable',wake:async()=>{},sleep:async()=>{},notify:async()=>({action:'none'}),takeGuidance:()=>[]},
  executeSkill:async request=>{
   requests.push(request);expect(request.activities).toBeUndefined();
   expect(activityInvocationPrompt(request)).toContain(content);
   expect(request.identity).toMatchObject({task_id:'task',run_id:'run',tenant_id:'default',activity:'pure',envelope_sha256:envelope.envelope_sha256,skill_sha256:envelope.activities[0].skill_sha256});
   return {protocol:'skill-activity-result-v1',...request.identity,outputs:{text:request.input.text}};
  },
  validator:async({input:activityInput,outputs,contract})=>{
   expect(contract.acceptance).toEqual(['输出原文']);
   return {verdict:outputs.text===activityInput.text?'pass':'fail',evidence:['独立代码逐字比较输入与产物']};
  },
 });
 expect(requests).toHaveLength(1);
 expect(outcome.runtime.status).toBe('completed');
 expect(outcome.runtime.activities[0].validator_verdict).toMatchObject({verdict:'pass',evidence:['独立代码逐字比较输入与产物']});
 expect(events.some(e=>e.payload.event_type==='ACTIVITY_CHECKED'&&e.payload.phase==='start'&&e.payload.verdict.verdict==='pass')).toBe(true);
 expect(events.some(e=>e.payload.event_type==='ACTIVITY_CHECKED'&&e.payload.phase==='end'&&e.payload.verdict.verdict==='pass')).toBe(true);
 const receipt=outcome.receipt;
 const finalized=events.find(e=>e.sql.includes("'invocation_runner_finalized'"))?.payload;
 expect(finalized).toMatchObject({status:'completed',tenant_id:'default',request_key:'fixed-receipt',envelope_sha256:envelope.envelope_sha256,receipt_sha256:definitionDigest(receipt)});
 // schema正确也不能绕过公共Runner签发证明。
 const withoutProof={query:async sql=>({rows:sql.includes('FROM tasks')?[task]:[]})};
 await expect(guardInvocationCallback(withoutProof,{task_id:'task',run_id:'run',status:'AI Done',result:receipt})).rejects.toThrow('公共Runner终态证明');
 expect(validateSkillReceipt(envelope,receipt,'task','run').outputs).toEqual(input);
 expect(()=>validateSkillReceipt(envelope,{...receipt,run_id:'other'},'task','run')).toThrow('身份不匹配');
 expect(()=>validateSkillReceipt(envelope,{...receipt,outputs:{text:7}},'task','run')).toThrow('schema');
});
