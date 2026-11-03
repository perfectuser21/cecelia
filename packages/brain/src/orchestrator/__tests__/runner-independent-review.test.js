import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createWorkflowRecorder} from '../workflow-recorder.js';
import {runActivityContract} from '../activity-runtime.js';
const require=createRequire(import.meta.url);
const {createWorkflowRunner,profileDigest}=require('../../../scripts/fleet-worker/workflow-runner.cjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const activity=(key,entry,phase='source')=>({key,order:phase==='finalize'?2:1,budget:{max_duration_s:1,heartbeat_s:1},failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:['review']}},runtime:{entry,phase,protocol:'json-stdio-v1'}});

test('独立审查：Commander睡眠最后事件必须进入中央读回后的最终manifest',async()=>{
 const root=await fs.mkdtemp(join(tmpdir(),'commander-record-review-')),rows=[];
 const server=createServer(async(req,res)=>{res.setHeader('content-type','application/json');if(req.method==='POST'){let s='';for await(const c of req)s+=c;rows.push(JSON.parse(s));res.end('{}');}else res.end(JSON.stringify({spans:rows}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let runner,recorder;
 try{
  const work=`let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:'completed',outputs:{answer:42},metrics:{},evidence:[]}));`;
  const check=`let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);console.log(JSON.stringify({verdict:'pass',acceptance_ref:x.acceptance.ref,evidence:[{observed:42}]}));`;
  const cmd=`let s='';for await(const c of process.stdin)s+=c;console.log('{"action":"none"}');`;
  for(const [file,value]of Object.entries({'work.mjs':work,'check.mjs':check,'cmd.mjs':cmd,'commander.md':'只观察纠偏'}))await fs.writeFile(join(root,file),value);
  const profile={cwd:root,files:{'work.mjs':hash(work),'check.mjs':hash(check),'cmd.mjs':hash(cmd),'commander.md':hash('只观察纠偏')},contract:{workflow:'demo',activities:[activity('work','work.mjs')]},metadata:{work:{activity_id:randomUUID(),executor_kind:'code',questions:{}}},validators:{workflow:{entry:'check.mjs',acceptance:{ref:'dod@1'}}},commander:{entry:'cmd.mjs',skill:{entry:'commander.md',version:'1'}}};
  const id={run_id:randomUUID(),task_id:randomUUID(),mode:'exploration',profile:'demo',profile_sha256:profileDigest(profile),input:{run_tag:'review'}};
  runner=createWorkflowRunner({stateRoot:join(root,'state'),machineId:'review',profiles:{demo:profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:s=>recorder=createWorkflowRecorder({root:join(root,'record'),runId:id.run_id,taskId:id.task_id,machineId:'review',profileDigest:id.profile_sha256,mode:'exploration',metadata:s.profile.metadata,brainUrl:`http://127.0.0.1:${server.address().port}`})});
  await runner.start(id);
  for(let n=0;n<200&&!recorder?.inspect().events.some(e=>e.event.event_type==='COMMANDER_SLEEP');n++)await wait(10);
  for(let n=0;n<200&&['starting','running','validating'].includes((await runner.inspect(id)).status);n++)await wait(10);
  const saved=await runner.inspect(id),actual=recorder.inspect();
  expect(actual.events.some(e=>e.event.event_type==='COMMANDER_SLEEP')).toBe(true);
  expect(saved.writeback.total).toBe(actual.spans.length);
  expect(actual.pending).toBe(0);
 }finally{runner?.close();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
});

test('独立审查：超时的脱离进程子任务仍存活时不得清场释放',async()=>{
 const root=await fs.mkdtemp(join(tmpdir(),'commander-unknown-review-'));let detached;
 try{
  const work=`import {spawn} from 'node:child_process';import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});child.unref();fs.writeFileSync('pid',String(child.pid));setInterval(()=>{},1000);`;
  const cleanup=`import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);fs.writeFileSync('cleanup','ran');console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:'completed',outputs:{},metrics:{},evidence:[]}));`;
  await fs.writeFile(join(root,'work.mjs'),work);await fs.writeFile(join(root,'cleanup.mjs'),cleanup);
  const result=await runActivityContract({workflow:'review',activities:[activity('work','work.mjs'),activity('cleanup','cleanup.mjs','finalize')]},{run_tag:'review'},{cwd:root,checkActivity:async()=>({verdict:'pass'})});
  detached=Number(await fs.readFile(join(root,'pid'),'utf8'));
  expect(()=>process.kill(detached,0)).not.toThrow();
  expect(result.execution_unknown).toBe(true);
  expect(await fs.access(join(root,'cleanup')).then(()=>true,()=>false)).toBe(false);
 }finally{if(detached)try{process.kill(detached,'SIGKILL');}catch{}await fs.rm(root,{recursive:true,force:true});}
},10000);

test('独立停止读回确认受控子进程已结束后才允许安全清场',async()=>{
 const root=await fs.mkdtemp(join(tmpdir(),'commander-stop-readback-'));let pid;
 try{
  const work=`import {spawn} from 'node:child_process';import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync('pid',String(child.pid));process.on('SIGTERM',()=>child.kill('SIGTERM'));child.on('close',()=>{console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:'partial',failure_class:'retryable',outputs:{},metrics:{},evidence:[]}));});`;
  const cleanup=`import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);fs.writeFileSync('cleanup','ran');console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:'completed',outputs:{},metrics:{},evidence:[]}));`;
  await fs.writeFile(join(root,'work.mjs'),work);await fs.writeFile(join(root,'cleanup.mjs'),cleanup);
  let readback=false;
  const result=await runActivityContract({workflow:'review',activities:[activity('work','work.mjs'),activity('cleanup','cleanup.mjs','finalize')]},{run_tag:'review'},{cwd:root,checkActivity:async()=>({verdict:'pass'}),canFinalize:async()=>{
   pid=Number(await fs.readFile(join(root,'pid'),'utf8'));
   try{process.kill(pid,0);return false;}catch(e){if(e.code==='ESRCH'){readback=true;return true;}throw e;}
  }});
  expect(readback).toBe(true);
  expect(result.activities.at(-1).status).toBe('completed');
  expect(await fs.readFile(join(root,'cleanup'),'utf8')).toBe('ran');
 }finally{if(pid)try{process.kill(pid,'SIGKILL');}catch{}await fs.rm(root,{recursive:true,force:true});}
},10000);

test('无效身份产物不能抹掉执行者终止未知标志',async()=>{
 let cleanups=0;
 const result=await runActivityContract({workflow:'review',activities:[activity('work','work.mjs'),activity('cleanup','cleanup.mjs','finalize')]},{run_tag:'review'},
  {checkActivity:async()=>({verdict:'pass'}),executeActivity:async(a,input)=>{
   if(a.key==='cleanup')cleanups++;
   return {schema_version:1,run_tag:a.key==='work'?'foreign':input.run_tag,status:'completed',outputs:{},metrics:{},evidence:[],execution_stopped:a.key!=='work'};
  }});
 expect(result.execution_unknown).toBe(true);
 expect(cleanups).toBe(0);
});

test('异常路径保留未知外部副作用，后续只读恢复能看见原事实',async()=>{
 const result=await runActivityContract({workflow:'review',activities:[activity('work','work.mjs')]},{run_tag:'review'},
  {checkActivity:async()=>({verdict:'pass'}),executeActivity:async()=>{throw Object.assign(Error('reply_lost'),{externalEffect:'unknown',executionStopped:true});}});
 expect(result.activities[0].attempts[0].external_effect).toBe('unknown');
});
