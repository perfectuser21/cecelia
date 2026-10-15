import { describe,it,expect } from 'vitest';
import { createSkillEnvelope, invocationPrompt, validateSkillReceipt } from './skill-activity-adapter.js';
import { definitionDigest } from '../workflow-authoring/contracts.js';
const skill='---\nname: pure\nversion: 1.0.0\n---\n把输入text原样输出。';
const schema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
const identity={tenant_id:'t',target:{kind:'activity',id:'a',definition_version_id:'v'},input:{text:'x'},input_sha256:definitionDigest({text:'x'}),plan:{output_schema:schema,activities:[{key:'pure',input_mapping:{text:'$input.text'},input_schema:schema,output_schema:schema,implementation:{kind:'skill',repo:'perfectuser21/cecelia',path:'skills/pure/SKILL.md',revision:'a'.repeat(40)}}],output_mapping:{text:'$activity.pure.text'}}};
describe('固定Skill真实载荷',()=>{
 it('固定全文进入现有进程提示词且摘要绑定字节',async()=>{const e=await createSkillEnvelope(identity,{readFile:async()=>skill});const prompt=invocationPrompt(e,'task','run');expect(prompt).toContain(skill);expect(prompt).toContain(e.activities[0].skill_sha256);});
 it('回执必须逐项绑定task/run/租户/版本/输入/Skill摘要与结构化产物',async()=>{const e=await createSkillEnvelope(identity,{readFile:async()=>skill});const r={protocol:'skill-invocation-result-v1',task_id:'task',run_id:'run',tenant_id:e.tenant_id,target:e.target,input_sha256:e.input_sha256,activities:[{key:'pure',skill_sha256:e.activities[0].skill_sha256,outputs:{text:'x'}}],outputs:{text:'x'}};expect(validateSkillReceipt(e,r,'task','run').outputs).toEqual({text:'x'});for(const field of ['task_id','run_id','tenant_id','input_sha256'])expect(()=>validateSkillReceipt(e,{...r,[field]:'bad'},'task','run')).toThrow();expect(()=>validateSkillReceipt(e,{...r,outputs:{text:4}},'task','run')).toThrow();});
 it('来源摘要不符不得下发',async()=>{const v=structuredClone(identity);v.plan.activities[0].implementation.sha256='0'.repeat(64);await expect(createSkillEnvelope(v,{readFile:async()=>skill})).rejects.toThrow();});
});
