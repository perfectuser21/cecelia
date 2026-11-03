import {it,expect} from 'vitest';
import {invocationTaskPrompt,invocationBridgeRequired,prepareInvocationDispatch,guardInvocationCallback} from './runtime.js';
it('普通历史任务保持既有提示词与派发路径，不借调用器换执行体',async()=>{
 const task={id:'ordinary',payload:{}};
 expect(invocationTaskPrompt(task,'run')).toBe(null);
 await expect(prepareInvocationDispatch({},task,'run')).resolves.toBe(null);
});
it('未核验的调用快照不能进入真实执行提示词',()=>{
 expect(()=>invocationTaskPrompt({id:'task',payload:{invocation:{envelope:{protocol:'unknown'}}}},'run')).toThrow('未知调用协议');
});
it('回执run身份与服务端预留不符在任何终态写入前拒绝',async()=>{
 let reads=0;
 const db={query:async()=>{reads++;return {rows:[{payload:{invocation:{dispatch:{run_id:'original'}}}}]};}};
 await expect(guardInvocationCallback(db,{task_id:'task',run_id:'other',status:'AI Done',result:{}})).rejects.toThrow('run 身份');
 expect(reads).toBe(1);
});

it('固定纯Skill调用始终要求原生research桥接，不能借其他task_type改变执行通道',()=>{
 expect(invocationBridgeRequired({task_type:'research',payload:{invocation:{}}})).toBe(true);
 expect(invocationBridgeRequired({task_type:'research',payload:{}})).toBe(false);
 expect(()=>invocationBridgeRequired({task_type:'coding_workflow',payload:{invocation:{}}})).toThrow('调用任务类型');
});

it('整包Agent回执即使schema正确，没有公共Runner终态证明不能完成父任务',async()=>{
 const {createSkillEnvelope}=await import('../orchestrator/skill-activity-adapter.js');
 const schema={type:'object',properties:{text:{type:'string'}},required:['text']};
 const envelope=await createSkillEnvelope({tenant_id:'t',target:{id:'a'},input:{text:'x'},input_sha256:(await import('../workflow-authoring/contracts.js')).definitionDigest({text:'x'}),plan:{output_schema:schema,output_mapping:{text:'$activity.one.text'},activities:[{key:'one',input_schema:schema,output_schema:schema,input_mapping:{text:'$input.text'},implementation:{kind:'skill',repo:'perfectuser21/cecelia',path:'skills/pure/SKILL.md',revision:'a'.repeat(40)}}]}},{readFile:async()=> '---\nname: pure\nversion: 1.0.0\n---\ntext'});
 const receipt={protocol:'skill-invocation-result-v1',task_id:'task',run_id:'run',tenant_id:'t',target:envelope.target,input_sha256:envelope.input_sha256,activities:[{key:'one',skill_sha256:envelope.activities[0].skill_sha256,outputs:{text:'x'}}],outputs:{text:'x'}};
 const db={query:async(sql)=>({rows:sql.includes('FROM tasks')?[{payload:{invocation:{envelope,dispatch:{run_id:'run'}}}}]:[]})};
 await expect(guardInvocationCallback(db,{task_id:'task',run_id:'run',status:'AI Done',result:receipt})).rejects.toThrow('公共Runner');
});
