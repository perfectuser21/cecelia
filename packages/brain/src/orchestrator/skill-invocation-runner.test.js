import {it,expect} from 'vitest';
import {runSkillInvocation,INVOCATION_RUNNER_POLICY} from './skill-activity-adapter.js';
import {definitionDigest} from '../workflow-authoring/contracts.js';
const schema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
const contract={input_schema:schema,output_schema:schema,acceptance:['符合给定主题'],mutation_intent:'none'};
function envelope(){const body={protocol:'skill-invocation-v1',runner_policy:structuredClone(INVOCATION_RUNNER_POLICY),tenant_id:'tenant',target:{kind:'workflow',id:'wf'},input:{text:'input'},input_sha256:definitionDigest({text:'input'}),output_schema:schema,output_mapping:{text:'$activity.second.text'},activities:['first','second'].map((key,i)=>({key,input_mapping:{text:i?'$activity.first.text':'$input.text'},input_schema:schema,output_schema:schema,activity_contract:contract,skill_content:key,skill_sha256:definitionDigest(key),implementation:{kind:'skill',repo:'perfectuser21/cecelia',revision:'a'.repeat(40),path:`skills/${key}/SKILL.md`}}))};return body;}
// Envelope hashes use raw Skill bytes, independently of JSON hashes.
import {createHash} from 'node:crypto';
function frozen(){const e=envelope();for(const a of e.activities)a.skill_sha256=createHash('sha256').update(a.skill_content).digest('hex');return {...e,envelope_sha256:definitionDigest(e)};}
const offline={status:'unavailable',wake:async()=>{},sleep:async()=>{},notify:async()=>({action:'none'}),takeGuidance:()=>[],isAborted:()=>false};
const response=request=>({protocol:'skill-activity-result-v1',...request.identity,outputs:{text:request.input.text+'!'}});
it('公共Runner逐Activity调用仅一个Skill，独立schema/validator，顺序输出映射，记录固定身份',async()=>{
 const calls=[],events=[];const e=frozen();
 const result=await runSkillInvocation(e,'task','run',{commander:offline,executeSkill:async(request)=>{calls.push(request);return response(request);},validator:async()=>({verdict:'pass',evidence:['independent readback']}),onEvent:event=>events.push(event)});
 expect(calls.map(c=>c.identity.activity)).toEqual(['first','second']);expect(calls[0].skill.content).toBe('first');expect(calls[0].activities).toBeUndefined();expect(calls[1].input).toEqual({text:'input!'});
 expect(result.receipt.outputs).toEqual({text:'input!!'});expect(result.runtime.activities.every(a=>a.validator_verdict.verdict==='pass')).toBe(true);expect(events.some(e=>e.event_type==='ACTIVITY_CHECKED')).toBe(true);
});
it('缺合同不执行；质量判断缺独立validator不得因schema或worker自称完成通过',async()=>{
 let calls=0;const executeSkill=async request=>{calls++;return {...response(request),verdict:'pass'};};
 const result=await runSkillInvocation(frozen(),'task','run',{commander:offline,executeSkill});expect(result.runtime.status).toBe('needs_review');expect(result.receipt).toBe(null);expect(calls).toBe(1);
 const e=frozen();delete e.activities[0].activity_contract;delete e.envelope_sha256;e.envelope_sha256=definitionDigest(e);
 const missing=await runSkillInvocation(e,'task','run',{commander:offline,executeSkill});expect(missing.runtime.status).toBe('needs_review');expect(calls).toBe(1);
});
it('steer进入下一turn且failed check仅一次recovery，仍失败停review不执行下一Activity',async()=>{
 const requests=[],events=[];let correction=[];
 const commander={status:'available',wake:async()=>{},sleep:async()=>{},notify:async()=>({action:'none'}),isAborted:()=>false,takeGuidance:()=>{const c=correction;correction=[];return c;},interventions:()=>1,recovery:async()=>{correction=['按验收规则改正'];return {action:'steer',text:correction[0]};}};
 const result=await runSkillInvocation(frozen(),'task','run',{commander,executeSkill:async request=>{requests.push(request);return response(request);},validator:async()=>({verdict:'fail',evidence:['incorrect']}),onEvent:e=>events.push(e)});
 expect(requests).toHaveLength(2);expect(requests[1].guidance).toEqual(['按验收规则改正']);expect(result.runtime.status).toBe('needs_review');expect(result.runtime.activities).toHaveLength(1);
});
it('单Activity伪造身份或schema失败不能推进',async()=>{
 const result=await runSkillInvocation(frozen(),'task','run',{commander:offline,executeSkill:async request=>({...response(request),tenant_id:'other'}),validator:async()=>({verdict:'pass',evidence:['ok']})});expect(result.runtime.status).toBe('needs_review');expect(result.receipt).toBe(null);
});

it('Commander不可达仍按代码与schema完成，交换与sleep全部留痕',async()=>{
 const {createCommanderBridge}=await import('./runner-commander-bridge.js');const events=[];
 const commander=createCommanderBridge({run_id:'run',transport:async()=>{throw Error('offline');},onEvent:e=>events.push(e)});
 const e=frozen();for(const a of e.activities)a.activity_contract={...a.activity_contract,validation:{kind:'schema'}};
 delete e.envelope_sha256;e.envelope_sha256=definitionDigest(e);
 const outcome=await runSkillInvocation(e,'task','run',{commander,executeSkill:async request=>response(request)});
 expect(outcome.runtime.status).toBe('completed');expect(outcome.runtime.activities.every(a=>a.commander_status==='unavailable')).toBe(true);
 expect(events.some(e=>e.event_type==='COMMANDER_UNAVAILABLE')).toBe(true);expect(events.at(-1).event_type).toBe('COMMANDER_SLEEP');
});
it('旧子执行停止未知时不恢复、不推进，Commander仍sleep',async()=>{
 let calls=0,sleeps=0;const commander={...offline,sleep:async()=>{sleeps++;},recovery:async()=>{throw Error('不得恢复未知执行');}};
 const outcome=await runSkillInvocation(frozen(),'task','run',{commander,executeSkill:async()=>{calls++;throw Object.assign(Error('timeout'),{executionStopped:false});},validator:async()=>({verdict:'pass',evidence:['irrelevant']})});
 expect(outcome.runtime.status).toBe('needs_review');expect(outcome.runtime.execution_unknown).toBe(true);expect(calls).toBe(1);expect(sleeps).toBe(1);
});
it('同schema通过也不能覆盖独立Validator unknown或fail',async()=>{
 for(const verdict of ['unknown','fail']){
 const outcome=await runSkillInvocation(frozen(),'task','run',{commander:offline,executeSkill:async request=>response(request),validator:async()=>({verdict,checks:[{mode:'hard',pass:true}],evidence:['independent']})});
 expect(outcome.runtime.status).toBe('needs_review');expect(outcome.runtime.activities[0].validator_verdict.verdict).toBe(verdict);
 }
});
it('真实bridge修复交换写入记录，指导到下一turn，保留独立rescue计数',async()=>{
 const {createCommanderBridge}=await import('./runner-commander-bridge.js');const events=[],calls=[];
 const commander=createCommanderBridge({run_id:'run',transport:async request=>request.phase==='recovery'?{action:'steer',text:'按完成标准补齐!'}:{action:'none'},onEvent:e=>events.push(e)});
 const outcome=await runSkillInvocation(frozen(),'task','run',{commander,executeSkill:async request=>{calls.push(request);return response(request);},validator:async({outputs})=>({verdict:outputs.text==='input!'&&calls.length===1?'fail':'pass',evidence:['独立验收']})});
 expect(outcome.runtime.status).toBe('completed');expect(calls[1].guidance).toEqual(['按完成标准补齐!']);expect(events.some(e=>e.event_type==='COMMANDER_EXCHANGE'&&e.phase==='recovery'&&e.accepted)).toBe(true);
 expect(outcome.runtime.activities[0]).toMatchObject({rescued:true,skill_rescues:1,code_failures:0,commander_interventions:1});
});
