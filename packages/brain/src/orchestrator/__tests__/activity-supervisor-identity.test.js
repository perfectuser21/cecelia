import {afterEach,expect,test,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';

const probe=vi.hoisted(()=>({calls:0,mode:'healthy'}));
// 运行原 state 源码；只替换 Darwin 系统探测边界，Linux CI 也能覆盖该错误。
vi.mock('../activity-supervisor-state.cjs',async()=>{
 const fs=await import('node:fs'),vm=await import('node:vm');
 const {createRequire}=await import('node:module'),{fileURLToPath}=await import('node:url');
 const file=fileURLToPath(new URL('../activity-supervisor-state.cjs',import.meta.url));
 const realRequire=createRequire(file),module={exports:{}};
 const runtime={...process,platform:'darwin',kill(pid,signal){
  if(probe.mode==='absent'&&probe.calls>1)throw Object.assign(Error('no such process'),{code:'ESRCH'});
  return process.kill(pid,signal);
 }};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,Buffer,require(name){
  if(name==='node:process')return runtime;
  if(name==='node:child_process')return {...realRequire(name),spawnSync(){
   probe.calls++;
   const failed=probe.mode==='initial-unknown'||(probe.calls>1&&(['always-unknown','absent'].includes(probe.mode)||probe.mode==='transient'&&probe.calls===2));
   if(failed)return {status:null,stdout:'',error:Object.assign(Error('probe timeout'),{code:'ETIMEDOUT'})};
   return {status:0,stdout:probe.mode==='reused'&&probe.calls>1?'99:88':'12:34'};
  }};
  return realRequire(name);
 }},{filename:file});
 return {default:module.exports};
});
import {waitSupervisedActivity,durableWrite} from '../activity-supervisor.js';

const realState=createRequire(import.meta.url)('../activity-supervisor-state.cjs');
const fixtures=[];
afterEach(async()=>{
 for(const f of fixtures.splice(0)){
  for(const timer of f.timers)clearTimeout(timer);
  if(f.child.exitCode===null){const closed=once(f.child,'close');f.child.kill('SIGTERM');await closed;}
  fs.rmSync(f.root,{recursive:true,force:true});
 }
 probe.calls=0;probe.mode='healthy';
});
async function fixture(mode,{deadline=Date.now()+4000,grace=0}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'supervisor-identity-'));
 const directory=path.join(root,'actions','one');fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 await once(child,'spawn');
 const binding={run_id:'isolated-cleanup',activity_key:'cleanup',action_id:'original-action'};
 const manifest={protocol:'activity-supervisor/v1',binding,nonce:'fixed-fixture-nonce',deadline,cleanup_grace_s:grace,pid:child.pid,birth:'darwin:12:34'};
 durableWrite(path.join(directory,'manifest.json'),manifest);
 const f={root,directory,child,binding,manifest,timers:[]};fixtures.push(f);probe.mode=mode;probe.calls=0;
 f.finish=(delay=120,corrupt=null)=>f.timers.push(setTimeout(()=>{
  const transport={stdout:'{"status":"completed"}',stderr:'',exit_code:0,execution_stopped:true};
  const result={protocol:'activity-supervisor-result/v1',nonce:manifest.nonce,binding,deadline,transport,transport_sha256:realState.digest(transport)};
  if(corrupt==='binding')result.binding={...binding,action_id:'another-action'};
  else if(corrupt==='nonce')result.nonce='wrong';
  else if(corrupt==='digest')result.transport_sha256='wrong';
  else if(corrupt==='deadline')result.deadline++;
  durableWrite(path.join(directory,'result.json'),result);
 },delay));
 return f;
}

test('实际wait遇活进程一次Darwin探测超时不取消，仍消费同一原绑定结果',async()=>{
 const f=await fixture('transient');f.finish();
 const outcome=await waitSupervisedActivity(f.directory,f.binding).then(value=>({value}),error=>({error:error.message}));
 expect(outcome.error).toBeUndefined();
 expect(outcome.value.exit_code).toBe(0);
 expect(probe.calls).toBeGreaterThan(2);
 expect(fs.existsSync(path.join(f.directory,'cancel.json'))).toBe(false);
 expect(()=>process.kill(f.child.pid,0)).not.toThrow();
});

test('持续探测不确定也只等原deadline加原grace，不提前取消或伪造停止',async()=>{
 const f=await fixture('always-unknown',{deadline:Date.now()-1500});
 let error;
 try{await waitSupervisedActivity(f.directory,f.binding);}catch(e){error=e;}
 expect(Date.now()).toBeGreaterThanOrEqual(f.manifest.deadline+2000);
 expect(error.message).toBe('activity_supervisor_unconfirmed');
 expect(error.executionStopped).toBe(false);
 expect(JSON.parse(fs.readFileSync(path.join(f.directory,'cancel.json'))).nonce).toBe(f.manifest.nonce);
});

test('明确出生身份变化仍拒绝，不向复用PID发送信号',async()=>{
 const f=await fixture('reused');
 await expect(waitSupervisedActivity(f.directory,f.binding)).rejects.toThrow('activity_supervisor_unconfirmed');
 expect(()=>process.kill(f.child.pid,0)).not.toThrow();
});

test('只有明确ESRCH的消失证据才提前拒绝，仍不宣称所有子动作停止',async()=>{
 const f=await fixture('absent');
 await expect(waitSupervisedActivity(f.directory,f.binding)).rejects.toMatchObject({message:'activity_supervisor_unconfirmed',executionStopped:false});
});

test('初次身份未确认仍fail closed，不能以unknown接管现有运行',async()=>{
 const f=await fixture('initial-unknown');
 await expect(waitSupervisedActivity(f.directory,f.binding)).rejects.toThrow('activity_supervisor_missing');
 expect(fs.existsSync(path.join(f.directory,'cancel.json'))).toBe(false);
});

test.each(['nonce','binding','digest','deadline'])('等待期间错误%s结果仍拒绝，不把出现result文件当成功',async corrupt=>{
 const f=await fixture('healthy');f.finish(60,corrupt);
 await expect(waitSupervisedActivity(f.directory,f.binding)).rejects.toThrow('activity_supervisor_result_invalid');
});
