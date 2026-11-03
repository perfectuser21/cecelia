import {test, expect} from 'vitest';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const {createWorkflowRunner,profileDigest}=require('./workflow-runner.cjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wf-commander-'));
 const work=`import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);fs.appendFileSync('effects',x.name||'work');console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:'completed',outputs:{answer:42},metrics:{},evidence:[{file:'effects'}]}));`;
 const check=`let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);console.log(JSON.stringify({verdict:x.acceptance.ref==='reject'?'fail':'pass',acceptance_ref:x.acceptance.ref,evidence:[{answer:x.receipt.outputs.answer}]}));`;
 const commander=`let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);console.log(JSON.stringify({action:'none'}));`;
 const files={'work.mjs':work,'check.mjs':check,'commander.mjs':commander,'commander.md':'Observe and steer; never judge.'};
 for(const [entry,body] of Object.entries(files))fs.writeFileSync(path.join(root,entry),body);
 const activity=(key,order,phase='source')=>({key,order,budget:{max_duration_s:3,heartbeat_s:1},failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:[]}},runtime:{protocol:'json-stdio-v1',phase,entry:'work.mjs',input:{run_tag:'$input.run_tag',name:'$input.name'}}});
 const profile={cwd:root,files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,hash(v)])),contract:{workflow:'demo',activities:[activity('work',1)]},metadata:{work:{activity_id:randomUUID(),executor_kind:'code',questions:{A4:{ref:'accept'}}}},validators:{workflow:{entry:'check.mjs',acceptance:{ref:'accept'}}},commander:{entry:'commander.mjs',skill:{entry:'commander.md',version:'1.0.0'},timeout_s:1}};
 const id=()=>({run_id:randomUUID(),task_id:randomUUID(),profile:'demo',input:{run_tag:'demo',name:'work'},mode:'exploration',profile_sha256:profileDigest(profile)});
 const events=[];
 const options={stateRoot:path.join(root,'state'),machineId:'test',profiles:{demo:profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:()=>({onEvent:async e=>events.push(e),recordValidation:async()=>{},finalize:async()=>{},flush:async()=>({pending:0,blocked:0})})};
 return {root,profile,id,options,events,activity};
}
async function terminal(r,id){for(let i=0;i<200;i++){const s=await r.inspect(id);if(!['running','starting','validating'].includes(s.status))return s;await new Promise(r=>setTimeout(r,20));}throw Error('not terminal');}
test('公共入口真实唤醒Commander并持久记录休眠，重复start不重复执行',async()=>{
 const f=fixture();let r;try{r=createWorkflowRunner(f.options);const id=f.id();await r.start(id);await r.start(id);const result=await terminal(r,id);
 expect(result.status).toBe('completed');expect(f.events.some(e=>e.event_type.startsWith('COMMANDER_'))).toBe(true);
 const saved=JSON.parse(fs.readFileSync(path.join(f.root,'state',id.run_id+'.json')));expect(saved.commander_status).toBe('available');
 expect(fs.readFileSync(path.join(f.root,'effects'),'utf8')).toBe('work');
 expect(f.events.map(e=>e.cursor)).toEqual(f.events.map((_,i)=>i+1));
 }finally{r?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
test('Commander休眠事件必须在最后一次回写清单内，不能提前声明全部ACK',async()=>{
 const f=fixture();let r;try{let flushed=[];
 f.options.createRecorder=()=>({onEvent:async e=>f.events.push(e),recordValidation:async()=>{},finalize:async()=>{},flush:async()=>{flushed=[...f.events];return {pending:0,blocked:0,total:flushed.length};}});
 r=createWorkflowRunner(f.options);const id=f.id();await r.start(id);await terminal(r,id);await new Promise(resolve=>setTimeout(resolve,50));
 expect(flushed.at(-1).event_type).toBe('COMMANDER_SLEEP');
 expect((await r.inspect(id)).writeback.total).toBe(f.events.length);
 }finally{r?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
test('Commander真实进程不可达保留诊断但代码验收仍通过',async()=>{
 const f=fixture();let r;try{const source='process.exit(9);';fs.writeFileSync(path.join(f.root,'commander.mjs'),source);f.profile.files['commander.mjs']=hash(source);r=createWorkflowRunner(f.options);const id=f.id();await r.start(id);
 const s=await terminal(r,id);expect(s.status).toBe('completed');expect(s.commander_status).toBe('unavailable');expect(f.events.some(e=>e.event_type==='COMMANDER_UNAVAILABLE')).toBe(true);
 }finally{r?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
test('Commander可读取本Activity冻结的完成标准与来源摘要',async()=>{
 const f=fixture();let r;try{
 const source=`let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);if(x.activity==='work'&&(!x.activity_contract?.questions?.A4?.ref||!x.profile_sha256))process.exit(8);console.log('{"action":"none"}');`;
 fs.writeFileSync(path.join(f.root,'commander.mjs'),source);f.profile.files['commander.mjs']=hash(source);
 r=createWorkflowRunner(f.options);const id=f.id();await r.start(id);const s=await terminal(r,id);
 expect(s.status).toBe('completed');expect(s.commander_status).toBe('available');
 }finally{r?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
test('逐Activity独立验收失败在下一业务动作前停止，finalize仍执行',async()=>{
 const f=fixture();let r;try{f.profile.contract.activities.push(f.activity('later',2),f.activity('cleanup',3,'finalize'));
 for(const key of ['later','cleanup'])f.profile.metadata[key]={activity_id:randomUUID(),executor_kind:'code',questions:{}};
 f.profile.metadata.work.questions.A4.ref='reject';f.profile.validators.work={entry:'check.mjs',acceptance:{ref:'reject'}};
 r=createWorkflowRunner(f.options);const id=f.id();await r.start(id);const s=await terminal(r,id);
 expect(s.status).toBe('needs_review');expect(fs.readFileSync(path.join(f.root,'effects'),'utf8')).toBe('workwork');
 expect(f.events.some(e=>e.event_type==='WF_OWNER_REVIEW_REQUIRED')).toBe(true);
 const saved=JSON.parse(fs.readFileSync(path.join(f.root,'state',id.run_id+'.json')));
 expect(saved.sample_candidates[0].activity).toBe('work');expect(saved.sample_candidates[0].confirmed).toBe(false);
 }finally{r?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
test('未列入固定清单的Commander入口不能在业务启动后读取或执行',async()=>{
 const f=fixture();let r;try{delete f.profile.files['commander.mjs'];r=createWorkflowRunner(f.options);
 await expect(r.start(f.id())).rejects.toThrow(/source_mismatch/);expect(fs.existsSync(path.join(f.root,'effects'))).toBe(false);
 }finally{r?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
test('公共入口将一次纠正交给固定Skill下一回合，第二次独立验收通过才救回',async()=>{
 const f=fixture();let r;try{
 const work=`import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);fs.appendFileSync('effects',String(x.attempt));console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:'completed',outputs:{answer:x.commander_guidance?.includes('fix')?42:0},metrics:{},evidence:[{attempt:x.attempt}]}));`;
 const check=`let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);console.log(JSON.stringify({verdict:x.receipt.outputs.answer===42?'pass':'fail',acceptance_ref:x.acceptance.ref,evidence:[{answer:x.receipt.outputs.answer}]}));`;
 const commander=`let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);console.log(JSON.stringify(x.phase==='recovery'?{action:'steer',text:'fix'}:{action:'none'}));`;
 for(const [entry,body]of Object.entries({'work.mjs':work,'check.mjs':check,'commander.mjs':commander})){fs.writeFileSync(path.join(f.root,entry),body);f.profile.files[entry]=hash(body);}
 f.profile.metadata.work.executor_kind='agent';f.profile.metadata.work.skill={entry:'commander.md',version:'1'};f.profile.metadata.work.recovery_safe=true;
 f.profile.contract.activities[0].runtime.recovery_safe=true;f.profile.validators.work={entry:'check.mjs',acceptance:{ref:'accept'}};
 r=createWorkflowRunner(f.options);const id=f.id();await r.start(id);expect((await terminal(r,id)).status).toBe('completed');
 const saved=JSON.parse(fs.readFileSync(path.join(f.root,'state',id.run_id+'.json')));
 expect(fs.readFileSync(path.join(f.root,'effects'),'utf8')).toBe('12');expect(saved.receipt.activities[0].rescued).toBe(true);
 expect(saved.receipt.activities[0].commander_interventions).toBe(1);
 }finally{r?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
