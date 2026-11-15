import {test,expect,afterEach} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRuntime} from '../../../scripts/commander-workflow/skill-adapter.mjs';
import {loadCommanderManifest} from '../../../scripts/commander-workflow/host.mjs';

const roots=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const sha=value=>createHash('sha256').update(value).digest('hex');
const hash=file=>sha(fs.readFileSync(file));
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'commander-session-groups-'));roots.push(root);
 const home=path.join(root,'api-home');fs.mkdirSync(home,{mode:0o700});
 fs.writeFileSync(path.join(home,'auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'synthetic-key'}),{mode:0o600});
 const bin=path.join(root,'codex'),capture=path.join(root,'calls.jsonl'),mode=path.join(root,'mode.json');
 fs.writeFileSync(bin,`#!${process.execPath}
const fs=require('fs'),crypto=require('crypto');let prompt='';
process.stdin.on('data',d=>prompt+=d);process.stdin.on('end',()=>{
 const args=process.argv.slice(2),resume=args.includes('resume'),thread=resume?args.at(-2):crypto.randomUUID();
 fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({args,thread,prompt})+'\\n');
 fs.writeFileSync(args[args.indexOf('-o')+1],'{}');
 const mode=fs.existsSync(${JSON.stringify(mode)})?JSON.parse(fs.readFileSync(${JSON.stringify(mode)},'utf8')):{};
 if(mode.changed){process.on('SIGTERM',()=>process.exit(0));console.log(JSON.stringify({type:'thread.started',thread_id:crypto.randomUUID()}));setTimeout(()=>process.exit(0),1000);}
 else {console.log(JSON.stringify({type:'thread.started',thread_id:thread}));console.log(JSON.stringify({type:'turn.completed'}));}
});`,{mode:0o755});
 fs.writeFileSync(path.join(root,'skill.txt'),'仅执行指定活动');fs.writeFileSync(path.join(root,'tools.txt'),'测试工具');
 fs.writeFileSync(path.join(root,'check.cjs'),`let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const r=JSON.parse(s);console.log(JSON.stringify({identity:Object.fromEntries(['task_id','run_id','run_tag','workflow','activity','attempt'].map(k=>[k,r[k]])),nonce:r.nonce,outcome:'passed',checks:r.checks.map(id=>({id,status:'passed',evidence:[{source:'fixture',observation:{exists:true}}]})),output:{checked:true}}));});`);
 fs.writeFileSync(path.join(root,'work.js'),'// 冻结的Activity入口');
 const checker={command:process.execPath,command_sha256:hash(process.execPath),entry:'check.cjs',start_checks:['authority'],required_checks:['product']};
 const profile={cwd:root,codex_auth:{mode:'api-only',home},files:Object.fromEntries(['skill.txt','tools.txt','check.cjs','work.js'].map(f=>[f,hash(path.join(root,f))])),skill_runtime:{control_dir:'control',tools:'tools.txt',codex:{command:bin,command_sha256:hash(bin)},activities:{}}};
 const run={task_id:'task',run_id:'run',input:{run_tag:'tag'},contract:{workflow:'fixture'}};
 function activity(key,group,kind='agent'){
  profile.skill_runtime.activities[key]={skill:'skill.txt',checker,...(group===undefined?{}:{session_group:group})};
  return {key,budget:{max_duration_s:5,heartbeat_s:1},runtime:{phase:'source',executor_kind:kind,protocol:'json-stdio-v1',entry:'work.js',interactive:false}};
 }
 const identity=(key,action)=>({task_id:run.task_id,run_id:run.run_id,action_id:action,activity_key:key});
 async function execute(a,action=a.key){
  const runtime=await createRuntime({profile,run});
  return runtime.executeActivity(a,run.input,{identity:identity(a.key,action),cwd:root,deadlineMs:Date.now()+5000});
 }
 const calls=()=>fs.existsSync(capture)?fs.readFileSync(capture,'utf8').trim().split('\n').map(JSON.parse):[];
 const threadFile=group=>path.join(root,'control',run.run_id,...(group===undefined?[]:['sessions',sha(group)]),'thread.json');
 return {root,home,mode,profile,run,activity,identity,execute,calls,threadFile};
}

test('不同Activity同组resume、异组fresh，runtime重建后各组接回原线程',async()=>{
 const f=fixture();
 for(const [key,group] of [['a','work'],['b','qa'],['c','work'],['d','qa']])expect((await f.execute(f.activity(key,group))).status).toBe('completed');
 const calls=f.calls();expect(calls.map(c=>c.args.includes('resume'))).toEqual([false,false,true,true]);
 expect(calls[0].thread).not.toBe(calls[1].thread);expect(calls[2].thread).toBe(calls[0].thread);expect(calls[3].thread).toBe(calls[1].thread);
 for(const group of ['work','qa'])expect(JSON.parse(fs.readFileSync(f.threadFile(group),'utf8'))).toMatchObject({run_id:'run',session_group:group});
 expect(fs.existsSync(f.threadFile())).toBe(false);
});

test('缺省旧记录兼容共享；显式default、不同大小写组都独立',async()=>{
 const f=fixture();
 expect((await f.execute(f.activity('a'))).status).toBe('completed');
 const record=JSON.parse(fs.readFileSync(f.threadFile(),'utf8'));expect(record).not.toHaveProperty('session_group');
 expect((await f.execute(f.activity('b'))).status).toBe('completed');
 for(const group of ['default','Work','work'])expect((await f.execute(f.activity(group,group))).status).toBe('completed');
 const calls=f.calls();expect(calls[1].thread).toBe(calls[0].thread);expect(new Set(calls.map(c=>c.thread)).size).toBe(4);
});

test('同名组跨run启动新线程',async()=>{
 const f=fixture(),a=f.activity('one','work');expect((await f.execute(a)).status).toBe('completed');
 f.run.run_id='another-run';expect((await f.execute(a)).status).toBe('completed');
 expect(f.calls().map(c=>c.args.includes('resume'))).toEqual([false,false]);expect(f.calls()[0].thread).not.toBe(f.calls()[1].thread);
});

test.each(['',null,7,[],{},'../qa',' qa','qa ','a/b','a'.repeat(65)])('拒绝非法session_group %j，不启动模型',async group=>{
 const f=fixture();await expect(f.execute(f.activity('one',group))).rejects.toThrow('skill_session_group_invalid');expect(f.calls()).toEqual([]);
});

test('Code Activity不能静默接受会话组',async()=>{
 const f=fixture();await expect(f.execute(f.activity('one','work','code'))).rejects.toThrow('skill_session_group_requires_agent');expect(f.calls()).toEqual([]);
});

test.each(['run','auth','group','missing-group','missing-thread','empty-thread','number-thread','null-record'])('损坏组记录%s在模型spawn前拒绝，不降级fresh',async kind=>{
 const f=fixture(),a=f.activity('one','work');expect((await f.execute(a)).status).toBe('completed');
 const file=f.threadFile('work');let record=JSON.parse(fs.readFileSync(file,'utf8'));
 if(kind==='run')record.run_id='wrong';if(kind==='auth')record.auth_identity='wrong';if(kind==='group')record.session_group='qa';
 if(kind==='missing-group')delete record.session_group;if(kind==='missing-thread')delete record.thread_id;
 if(kind==='empty-thread')record.thread_id='';if(kind==='number-thread')record.thread_id=7;if(kind==='null-record')record=null;
 fs.writeFileSync(file,JSON.stringify(record));expect((await f.execute(a,'second')).status).toBe('needs_review');expect(f.calls()).toHaveLength(1);
});

test('缺省线程不能消费带组身份记录，也拒绝缺失thread_id',async()=>{
 const f=fixture(),a=f.activity('one');expect((await f.execute(a)).status).toBe('completed');
 const file=f.threadFile(),record=JSON.parse(fs.readFileSync(file,'utf8'));
 fs.writeFileSync(file,JSON.stringify({...record,session_group:'work'}));expect((await f.execute(a,'two')).status).toBe('needs_review');
 delete record.thread_id;fs.writeFileSync(file,JSON.stringify(record));expect((await f.execute(a,'three')).status).toBe('needs_review');expect(f.calls()).toHaveLength(1);
});

test('resume返回另一thread，即使CLI收到SIGTERM后退出0也不能报告成功',async()=>{
 const f=fixture(),a=f.activity('one');expect((await f.execute(a)).status).toBe('completed');const before=fs.readFileSync(f.threadFile(),'utf8');
 fs.writeFileSync(f.mode,JSON.stringify({changed:true}));expect((await f.execute(a,'second')).status).toBe('needs_review');expect(fs.readFileSync(f.threadFile(),'utf8')).toBe(before);
});

test('已提交动作恢复只读回，不依赖会话记录或API凭据，不新启动模型',async()=>{
 const f=fixture(),a=f.activity('one','work');expect((await f.execute(a)).status).toBe('completed');
 fs.writeFileSync(f.threadFile('work'),'broken');fs.unlinkSync(path.join(f.home,'auth.json'));
 const runtime=await createRuntime({profile:f.profile,run:f.run});
 const result=await runtime.inspectActivity(a,f.run.input,{identity:f.identity('one','one')});
 expect(result.state).toBe('completed');expect(result.result.status).toBe('completed');expect(f.calls()).toHaveLength(1);
});

test('会话组配置参与冻结运行定义，改组必须改变revision',()=>{
 const f=fixture(),a=f.activity('one','work');f.profile.adapter='work.js';f.profile.commander={provider:'codex',model:'fixture',codexBin:path.join(f.root,'codex')};f.run.contract.activities=[a];
 const manifest=path.join(f.root,'manifest.json'),save=()=>fs.writeFileSync(manifest,JSON.stringify({profile:f.profile,run:f.run}));save();
 const before=loadCommanderManifest(manifest).revision;f.profile.skill_runtime.activities.one.session_group='qa';save();expect(loadCommanderManifest(manifest).revision).not.toBe(before);
});
