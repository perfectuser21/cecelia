import {it,expect,vi} from 'vitest';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {reconcileInvocationLiveness} from './runtime.js';
import {createSkillEnvelope} from '../orchestrator/skill-activity-adapter.js';
import {definitionDigest} from '../workflow-authoring/contracts.js';
const schema={type:'object',properties:{text:{type:'string'}}};
async function fixture(){const e=await createSkillEnvelope({tenant_id:'t',target:{id:'wf'},input:{text:'x'},input_sha256:definitionDigest({text:'x'}),plan:{activities:[{key:'one',input_mapping:{text:'$input.text'},input_schema:schema,output_schema:schema,implementation:{kind:'skill',repo:'perfectuser21/cecelia',path:'skills/pure/SKILL.md',revision:'a'.repeat(40)}}],output_schema:schema,output_mapping:{text:'$activity.one.text'}}},{readFile:async()=> '---\nname: pure\nversion: 1.0.0\n---\n纯Skill'});
const inv={protocol:'invocation-request-v1',runner:'shared-activity-runner',tenant_id:'t',target:e.target,input_sha256:e.input_sha256,request_key:'key',dispatch:{run_id:'run'},envelope:e};
const task={id:'parent',task_type:'research',payload:{invocation:inv,current_run_id:'run'}};
const run={run_id:'run',status:'running',ended_at:null,context:{source:'skill-invocation',tenant_id:'t',target:e.target,input_sha256:e.input_sha256,envelope_sha256:e.envelope_sha256}};
const writes=[];const db={query:async(sql,args)=>{if(sql.includes('FROM task_runs'))return {rows:[run]};writes.push({sql,args});return {rows:[],rowCount:1};}};
return {task,run,db,writes};}
it('活公共Invocation须匹配冻结dispatch/run与真实controller Promise，无父PID不判孤儿',async()=>{const f=await fixture();const entry={source:'shared-activity-runner',runId:'run',invocationController:new Promise(()=>{})};expect(await reconcileInvocationLiveness(f.db,f.task,{entry})).toMatchObject({verdict:'alive'});expect(f.writes).toEqual([]);});
it('重启无controller时将匹配旧run标needs_review/unknown，不重发或假close',async()=>{const f=await fixture();expect(await reconcileInvocationLiveness(f.db,f.task)).toMatchObject({verdict:'unknown'});expect(f.writes.some(w=>w.sql.includes("status='blocked'"))).toBe(true);expect(f.writes.some(w=>/status='queued'|UPDATE task_runs/.test(w.sql))).toBe(false);expect(JSON.stringify(f.writes)).toContain('execution_unknown');});
it('任意payload标记、错dispatch/run、错source/digest均不永久alive',async()=>{for(const kind of ['payload','dispatch','context','hash']){const f=await fixture();if(kind==='payload')f.task.payload.invocation={runner:'shared-activity-runner'};if(kind==='dispatch')f.task.payload.current_run_id='other';if(kind==='context')f.run.context.source='other';if(kind==='hash')f.run.context.envelope_sha256='other';expect(await reconcileInvocationLiveness(f.db,f.task,{entry:{source:'shared-activity-runner',runId:'run',invocationController:Promise.resolve()}})).toBe(null);expect(f.writes).toEqual([]);}});
it.each(['probeTaskLiveness','syncOrphanTasksOnStartup'])('%s先核公共Invocation身份，不按父PID误回队',async name=>{const source=readFileSync(new URL('../executor.js',import.meta.url),'utf8');const expression=source.match(new RegExp(`async function ${name}\\([^]*?^\\}`,'m'))[0];const task={id:'parent',payload:{invocation:{}},task_type:'research'};const check=vi.fn(async()=>({verdict:'unknown'}));const noPid=vi.fn(()=>{throw Error('不得按父PID误判');});const fn=vm.runInNewContext(`(${expression})`,{pool:{query:async()=>({rows:[task]})},reconcileInvocationLiveness:check,activeProcesses:new Map(),suspectProcesses:new Map(),process:{env:{}},console:{log(){},warn(){}},isTaskProcessAlive:noPid,isRunIdProcessAlive:noPid,isExternallyExecuted:()=>false,EXTERNAL_ACTIVITY_AGE_SQL:'0',externalStaleNoted:{prune(){}}});await fn();expect(check).toHaveBeenCalled();expect(noPid).not.toHaveBeenCalled();});
it('身份核验失败的旧controller条目不能借通用无PID分支获得alive',async()=>{
 const source=readFileSync(new URL('../executor.js',import.meta.url),'utf8'),task={id:'parent',task_type:'research',payload:{invocation:{},current_run_id:'wrong'}},suspects=new Map();
 const expression=source.match(/async function probeTaskLiveness\([^]*?^\}/m)[0];
 const fn=vm.runInNewContext(`(${expression})`,{pool:{query:async()=>({rows:[task]})},reconcileInvocationLiveness:async()=>null,activeProcesses:new Map([['parent',{source:'shared-activity-runner',runId:'old',invocationController:Promise.resolve()}]]),suspectProcesses:suspects,process:{env:{}},console:{log(){}},EXTERNAL_ACTIVITY_AGE_SQL:'0',externalStaleNoted:{prune(){}},CONTENT_PIPELINE_EXTERNAL_WORKER_TYPES:[],RECOVERY_HARNESS_TASK_TYPES:[],EXTERNAL_WATCHDOG_TASK_TYPES:[],isExternalRunMirror:()=>false,isExternallyExecuted:()=>false,REVIEW_TASK_TYPES:[],isPhoneDispatchTask:()=>false});
 await fn();expect(suspects.has('parent')).toBe(true);
});
it('startup同样不信任未通过身份核验的内存controller条目',async()=>{
 const source=readFileSync(new URL('../executor.js',import.meta.url),'utf8');const expression=source.match(/async function syncOrphanTasksOnStartup\([^]*?^\}/m)[0];
 const fn=vm.runInNewContext(`(${expression})`,{pool:{query:async()=>({rows:[{id:'parent',task_type:'research',payload:{current_run_id:'wrong'}}]})},reconcileInvocationLiveness:async()=>null,activeProcesses:new Map([['parent',{source:'shared-activity-runner',runId:'old'}]]),process:{env:{}},console:{log(){}},isExternallyExecuted:()=>false,isTaskProcessAlive:()=>{throw Error('按原通用路径复核');}});
 await expect(fn()).rejects.toThrow('按原通用路径复核');
});
