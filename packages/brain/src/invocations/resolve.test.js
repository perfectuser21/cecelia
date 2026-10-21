import {it,expect} from 'vitest';
import {validateTargetRequest,probeInvocationRuntime,resolveInvocation} from './resolve.js';
import {definitionDigest} from '../workflow-authoring/contracts.js';
const id='11111111-1111-4111-8111-111111111111';
it('正式调用必须提供固定版本，候选必须有管理任务与摘要',()=>{
 const base={target:{kind:'activity',id},mode:'released',input:{}};
 expect(()=>validateTargetRequest(base)).toThrow('definition_version_id');
 expect(()=>validateTargetRequest({...base,target:{...base.target,definition_version_id:id}})).not.toThrow();
 expect(()=>validateTargetRequest({...base,mode:'candidate',authoring_task_id:id,compose_sha256:'other'})).toThrow('compose_sha256');
 expect(()=>validateTargetRequest({...base,mode:'candidate',authoring_task_id:id,compose_sha256:'a'.repeat(64)})).not.toThrow();
});
it('所有真实目录执行体探活失败时不返回可用资源',async()=>{
 const result=await probeInvocationRuntime({fetchFn:async()=>{throw Error('offline');}});
 expect(result).toEqual({ready:false,code:'transport_resource_unavailable'});
});
it('仅有slot key的新建活动可解析确定性候选身份，两slot不合并且不能伪选正式UUID',async()=>{
 const schema={type:'object',properties:{text:{type:'string'}},required:['text']};
 const slot=key=>({key,executor_kind:'agent',runtime:{transport:'codex-bridge'},mutation_intent:'none',
  input_schema:schema,output_schema:schema,acceptance:['真实产物'],implementation:{kind:'skill',skill_id:id,
   repo:'perfectuser21/cecelia',path:'skills/pure/SKILL.md',revision:'a'.repeat(40)}});
 const definition={key:'pure',tenant_id:'company-a',source:{repo:'perfectuser21/cecelia',ref:'pure.json',revision:'a'.repeat(40)},
  input_schema:schema,output_schema:schema,activities:[slot('one'),slot('two')]};
 const db={query:async sql=>({rows:sql.includes('FROM tasks')?[{id,payload:{workflow_authoring:true,tenant_id:'company-a'},status:'in_progress',result:{workflow_authoring:{outputs:{compose:{definition}}}}}]:sql.includes('skill_registry')?[{id,status:'active'}]:[]})};
 const options={readFile:async()=> '---\nname: pure\nversion: 1.0.0\n---\n转成大写',probeRuntime:async()=>({ready:true})};
 const body={target:{kind:'activity',id,slot_key:'one'},input:{text:'abc'},mode:'candidate',authoring_task_id:id,compose_sha256:definitionDigest(definition)};
 const one=await resolveInvocation(db,body,'company-a',options);
 expect(one.readiness).toBe('ready');expect(one.target.slot_key).toBe('one');expect(one.target.id).not.toBe(id);
 expect((await resolveInvocation(db,{...body,target:one.target},'company-a',options)).target).toEqual(one.target);
 const two=await resolveInvocation(db,{...body,target:{...body.target,slot_key:'two'}},'company-a',options);
 expect(two.target.id).not.toBe(one.target.id);
 await expect(resolveInvocation(db,{...body,target:{...body.target,id:'22222222-2222-4222-8222-222222222222'}},'company-a',options)).rejects.toThrow();
});
