import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { runRoleHandover } from '../commander-role-handover.js';
import { runCommanderWatchdog, buildEscortRelaunchRemote } from '../commander-watchdog.js';
const OLD='11111111-1111-4111-8111-111111111111',NEW='22222222-2222-4222-8222-222222222222';
const context={tag:'cmdfixture',host:'xian-m4',serial:'S1',profile:'legacy',cap:'keyword_acquisition'};
const NAME='escort-xian-m4-cmdfixture';
function fixture({listed=[],prepareError=false,commitFailures=0,patchFailures=0,unknownAdd=false,brokenList=false,incomplete=false,receiptPatch={},recovery}={}) {
 const task={id:'fixture-run',task_type:'device_job',payload:{...context,source:'cron',escort_id:OLD,commander_adopt_count:2}};
 let state=recovery||{state:'none'},actualJobs=listed,adds=0;const calls=[],patches=[],phases=[];
 const pool={query:vi.fn(async(sql,args)=>{
  if(sql.includes('FROM tasks')&&sql.includes('commander_heartbeat_at'))return {rows:[structuredClone(task)]};
  if(sql.startsWith('UPDATE tasks')){if(patchFailures-->0)throw Error('patch interrupted');const patch=JSON.parse(args[1]);patches.push(patch);Object.assign(task.payload,patch);return {rowCount:1};}
  return {rows:[]};
 })};
 const roleHandover=vi.fn(async request=>{
  phases.push(request.phase);
  if(request.phase==='recover')return structuredClone(state);
  if(request.phase==='prepare'){if(prepareError)throw Error('role refusal/parallel old');state={state:'prepared',operationId:'op-fixture',mode:request.mode,previousEscortId:request.previousEscortId};}
  if(request.phase==='observe'){const id=request.candidateEscortId||request.addResponse?.id||(request.addResponse?.error&&actualJobs[0]?.id);state={...state,state:id?'candidate':'pending',candidateEscortId:id};}
  if(request.phase==='commit'){
   if(commitFailures-->0)throw Error('independent observation unavailable');
   state={...state,state:'committed',receipt:{operationId:state.operationId,taskId:request.taskId,previousEscortId:state.previousEscortId,escortId:state.candidateEscortId,generation:2,...request.context,committedAt:'2026-10-03T00:00:00Z',evidenceRef:'fixture-independent-observation'}};
   if(incomplete)delete state.receipt.generation;Object.assign(state.receipt,receiptPatch);
  }
  return structuredClone(state);
 });
 const execFileFn=vi.fn((file,args,opts,cb)=>{
  const command=args.at(-1);calls.push(command);
  if(command.startsWith('openclaw cron list '))return cb(null,brokenList?'unreadable':JSON.stringify({jobs:actualJobs}),'');
  if(command.includes('cron add')){adds++;actualJobs=[{id:NEW,name:NAME}];if(unknownAdd)return cb(Error('transport response lost'),'','');return cb(null,JSON.stringify({id:NEW}),'');}
  cb(null,'{}','');
 });
 const tick=(extra={})=>runCommanderWatchdog(pool,{execFileFn,roleHandover,bark:vi.fn(),gateMs:0,now:Date.parse('2026-10-03T00:00:00Z'),...extra});
 return {tick,task,pool,calls,patches,phases,roleHandover,failNextCommit:()=>{commitFailures=1;},get adds(){return adds;}};
}
describe('persistent optional role handover',()=>{
 it('recover precedes MAX_ADOPT; prepare refusal blocks transport, authoritative patch and run',async()=>{
  const f=fixture({prepareError:true});const out=await f.tick();expect(out.failed).toBe(1);expect(f.phases).toEqual(['recover','prepare']);expect(f.calls.some(s=>/cron (rm|add|run)/.test(s))).toBe(false);expect(f.patches).toEqual([]);
 });
 it.each([OLD,NEW])('same/different id adopt cannot bypass independent ownership commit (%s)',async id=>{
  const f=fixture({listed:[{id,name:NAME}],commitFailures:1});f.task.payload.commander_adopt_count=0;
  const out=await f.tick();expect(out.failed).toBe(1);expect(f.phases).toEqual(['recover','prepare','observe','commit']);expect(f.patches).toEqual([]);expect(f.calls.some(s=>/cron (rm|add|run)/.test(s))).toBe(false);
 });
 it('add once, failed independent commit resumes same operation/candidate next tick',async()=>{
  const f=fixture({commitFailures:1});expect((await f.tick()).failed).toBe(1);expect(f.adds).toBe(1);expect(f.patches).toEqual([]);
  expect((await f.tick()).relaunched).toBe(1);expect(f.adds).toBe(1);expect(f.patches[0]).toMatchObject({escort_id:NEW,commander_relaunch_count:1});expect(f.calls.find(s=>s.startsWith('openclaw cron add '))).toContain('--no-deliver');expect(f.calls.filter(s=>s.includes('cron run'))).toHaveLength(1);
  expect(f.roleHandover.mock.calls.filter(([r])=>r.phase==='commit').map(([r])=>r.operationId)).toEqual(['op-fixture','op-fixture']);
 });
 it.each([
  {taskId:'foreign-task'},{operationId:'foreign-op'},{previousEscortId:NEW},{escortId:OLD},
  {generation:0},{generation:2.5},{evidenceRef:''},{committedAt:'unknown'},
  {tag:'foreign-tag'},{host:'xian-m1'},{serial:'other'},{profile:'other'},
  {cap:'other'},{escortName:'foreign-name'},
 ])('independent receipt cannot authorize mismatched/partial ownership (%j)',async receiptPatch=>{
  const f=fixture({receiptPatch});expect((await f.tick()).failed).toBe(1);expect(f.patches).toEqual([]);expect(f.calls.some(s=>s.startsWith('openclaw cron run '))).toBe(false);
 });
 it('committed same-id adopt verifies hook and patches before one activation; repeated recovery never recounts',async()=>{
  const f=fixture({listed:[{id:OLD,name:NAME}]});f.task.payload.commander_adopt_count=0;
  expect((await f.tick()).adopted).toBe(1);expect(f.phases).toEqual(['recover','prepare','observe','commit']);expect(f.patches[0]).toMatchObject({escort_id:OLD,commander_adopt_count:1});
  expect(f.patches[0].commander_heartbeat_at).toBeUndefined();expect(f.adds).toBe(0);expect((await f.tick()).adopted).toBe(1);expect(f.patches).toHaveLength(1);expect(f.calls.filter(s=>s.startsWith('openclaw cron run '))).toHaveLength(1);
 });
 it('unknown add response keeps operation; independent recovery never issues a second add',async()=>{
  const f=fixture({unknownAdd:true});expect((await f.tick()).failed).toBe(1);expect(f.adds).toBe(1);expect(f.patches).toEqual([]);
  expect((await f.tick()).relaunched).toBe(1);expect(f.adds).toBe(1);expect(f.patches[0].escort_id).toBe(NEW);
 });
 it('ownership commit plus failed payload patch recovers same candidate before activation',async()=>{
  const f=fixture({patchFailures:1});expect((await f.tick()).failed).toBe(1);expect(f.calls.some(s=>s.includes('cron run'))).toBe(false);
  expect((await f.tick()).relaunched).toBe(1);expect(f.adds).toBe(1);expect(f.patches[0].escort_id).toBe(NEW);
 });
 it('payload interruption requires fresh independent commit before recovery activation',async()=>{
  const f=fixture({patchFailures:1});expect((await f.tick()).failed).toBe(1);f.failNextCommit();
  expect((await f.tick()).failed).toBe(1);expect(f.adds).toBe(1);expect(f.patches).toEqual([]);expect(f.calls.some(s=>s.startsWith('openclaw cron run '))).toBe(false);
  expect((await f.tick()).relaunched).toBe(1);expect(f.adds).toBe(1);
 });
 it.each([{brokenList:true},{incomplete:true},{recovery:{state:'prepared',operationId:'persisted-unknown'}}])('unreadable/partial/prepared evidence keeps ownership unresolved (%j)',async options=>{
  const f=fixture(options);expect((await f.tick()).failed).toBe(1);expect(f.patches).toEqual([]);expect(f.calls.some(s=>s.includes('cron run'))).toBe(false);
  if(options.brokenList||options.recovery)expect(f.adds).toBe(0);
 });
});
function heartbeat(ctx){
 const remote=buildEscortRelaunchRemote({...ctx,taskId:'fixture-run',relaunchCount:1});
 const args=JSON.parse(execFileSync('/bin/sh',['-c',`openclaw(){ python3 -c 'import sys,json;print(json.dumps(sys.argv[1:]))' "$@"; }; ${remote}`],{encoding:'utf8'}));
 return args[args.indexOf('--message')+1].match(/每轮末尾必须发心跳: (.*)$/)[1];
}
async function withHeartbeatFixture(check) {
 const root=mkdtempSync(join(tmpdir(),'commander-heartbeat-')),cli=join(root,"openclaw'fixture.cjs"),data=join(root,'jobs.json'),log=join(root,'cli-argv.json');
 writeFileSync(cli,`#!/usr/bin/env node\nconst fs=require('node:fs');fs.writeFileSync(process.env.WATCHDOG_TEST_ARGV,JSON.stringify(process.argv.slice(2)));process.stdout.write(fs.readFileSync(process.env.WATCHDOG_TEST_JOBS,'utf8'));`);execFileSync('/bin/chmod',['+x',cli]);
 let response={status:200,body:{success:true,matched:true,task_id:'fixture-run',via:'tag'}};
 const bodies=[];const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;bodies.push(JSON.parse(text));res.statusCode=response.status;res.end(typeof response.body==='string'?response.body:JSON.stringify(response.body));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const previous={url:process.env.COMMANDER_BRAIN_URL,cli:process.env.COMMANDER_OPENCLAW_CLI,node:process.env.COMMANDER_NODE_BIN};
 try {
  process.env.COMMANDER_BRAIN_URL=`http://127.0.0.1:${server.address().port}`;process.env.COMMANDER_OPENCLAW_CLI=cli;process.env.COMMANDER_NODE_BIN=process.execPath;
  const env={...process.env,WATCHDOG_TEST_ARGV:log,WATCHDOG_TEST_JOBS:data};
  const execute=(ctx=context)=>promisify(execFile)('/bin/sh',['-c',`ssh(){ while [ "$1" = "-o" ]; do shift 2; done; shift; eval "$1"; }; ${heartbeat(ctx)}`],{env});
  const job={id:NEW,name:NAME,agentId:'work-commander',sessionTarget:'session:'+NAME,enabled:true,schedule:{kind:'every',everyMs:600000},state:{runningAtMs:Date.now()}};
  const setJobs=jobs=>writeFileSync(data,JSON.stringify({jobs}));setJobs([job]);
  await check({execute,job,setJobs,bodies,log,setResponse:value=>{response=value;}});
 } finally {
  for(const [name,key] of [['COMMANDER_BRAIN_URL','url'],['COMMANDER_OPENCLAW_CLI','cli'],['COMMANDER_NODE_BIN','node']]){if(previous[key]===undefined)delete process.env[name];else process.env[name]=previous[key];}
  await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true});
 }
}
it('default static heartbeat runs actual CLI at tick time, reads unique running actual UUID and POSTs full identity',async()=>{
 await withHeartbeatFixture(async({execute,job,setJobs,bodies,log})=>{
  await execute();expect(JSON.parse(readFileSync(log,'utf8'))).toEqual(['cron','list','--all','--json']);expect(bodies).toEqual([{...context,escort_name:NAME,escort_id:NEW}]);
  setJobs([{...job,id:OLD}]);await execute();expect(bodies[1].escort_id).toBe(OLD);
  for(const jobs of [[job,job],[{...job,agentId:'wrong'}],[{...job,sessionTarget:'wrong'}],[{...job,state:{}}],[{...job,schedule:{kind:'every',everyMs:100}}],[{...job,enabled:false}],[{...job,id:'not-uuid'}]]){setJobs(jobs);await expect(execute()).rejects.toThrow();}
  expect(bodies).toHaveLength(2);
 });
});
it('actual default command missing profile refuses before CLI or HTTP; no SSH refusal masks it',async()=>{
 await withHeartbeatFixture(async({execute,bodies,log})=>{
  await expect(execute({...context,profile:null})).rejects.toThrow();expect(existsSync(log)).toBe(false);expect(bodies).toEqual([]);
 });
});
it.each([
 {status:202,body:{success:true,matched:false,stored:'none'}},
 {status:200,body:{success:true,matched:true,task_id:'wrong-task'}},
 {status:200,body:{}},
 {status:200,body:{success:false,matched:true,task_id:'fixture-run'}},
 {status:200,body:{success:true,matched:true}},
 {status:200,body:'not-json'},
 {status:503,body:{success:true,matched:true,task_id:'fixture-run'}},
])('actual default heartbeat rejects unmatched/foreign/malformed/HTTP receipt (%j)',async response=>{
 await withHeartbeatFixture(async({execute,bodies,setResponse})=>{
  setResponse(response);await expect(execute()).rejects.toThrow();expect(bodies).toHaveLength(1);
 });
});
it('injected heartbeat only accepts a single absolute Python argv without compound shell transport',()=>{
 const ctx={...context,taskId:'fixture-run',relaunchCount:1};
 expect(buildEscortRelaunchRemote(ctx,{buildHeartbeatCommand:()=>"/usr/bin/python3 '/fixture/heartbeat.py' 'tick'"})).toContain('/fixture/heartbeat.py');
 for(const command of ['/usr/bin/python3 /fixture/heartbeat.py; curl bad','/usr/bin/python3 /fixture/heartbeat.py && rm x','echo x','/usr/bin/python3 /fixture/heartbeat.py $(id)',"/usr/bin/python3 -c 'print(1)'",'/usr/bin/python3 -m module'])expect(()=>buildEscortRelaunchRemote(ctx,{buildHeartbeatCommand:()=>command})).toThrow();
});


describe('explicit durable stale-existing role policy',()=>{
 it('opt-in replaces existing role without fabricating adoption count',async()=>{
  const f=fixture({listed:[{id:OLD,name:NAME,enabled:false}]});f.task.payload.commander_adopt_count=0;expect((await f.tick({existingRolePolicy:'replace-stale-existing'})).relaunched).toBe(1);expect(f.adds).toBe(1);expect(f.calls.some(s=>s.includes('cron rm'))).toBe(true);expect(f.task.payload.escort_id).toBe(NEW);expect(f.task.payload.commander_adopt_count).toBe(0);expect(f.roleHandover.mock.calls.every(([request])=>request.existingRolePolicy==='replace-stale-existing')).toBe(true);
 });
 it.each([null,'unknown',{},1])('watchdog rejects invalid policy %j before IO',async policy=>{
  const f=fixture();await expect(f.tick({existingRolePolicy:policy})).rejects.toThrow('invalid_existing_role_policy');expect(f.pool.query).not.toHaveBeenCalled();expect(f.roleHandover).not.toHaveBeenCalled();expect(f.calls).toEqual([]);
 });
 it('watchdog rejects missing durable hook before gate and SQL',async()=>{
  const f=fixture();await expect(f.tick({existingRolePolicy:'replace-stale-existing',roleHandover:undefined})).rejects.toThrow('existing_role_policy_requires_handover');expect(f.pool.query).not.toHaveBeenCalled();expect(f.calls).toEqual([]);
 });
 it.each([null,'unknown',{},1])('direct handover rejects invalid policy %j before recovery',async policy=>{
  const hook=vi.fn(),list=vi.fn();await expect(runRoleHandover({id:'fixture-run'},context,{existingRolePolicy:policy,roleHandover:hook,list})).rejects.toThrow('invalid_existing_role_policy');expect(hook).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();
 });
 it('direct opt-in without durable hook rejects before list',async()=>{
  const list=vi.fn();await expect(runRoleHandover({id:'fixture-run'},context,{existingRolePolicy:'replace-stale-existing',list})).rejects.toThrow('existing_role_policy_requires_handover');expect(list).not.toHaveBeenCalled();
 });
 it('opt-in never discards pending recovered operation',async()=>{
  const f=fixture({recovery:{state:'prepared',operationId:'old-op',mode:'adopt',previousEscortId:OLD}});expect((await f.tick({existingRolePolicy:'replace-stale-existing'})).failed).toBe(1);expect(f.phases).toEqual(['recover']);expect(f.adds).toBe(0);expect(f.calls).toEqual([]);
 });
});


it('invalid opt-in validation does not advance the watchdog memory gate',async()=>{
 const f=fixture(),now=Date.now()+3600000;await expect(f.tick({existingRolePolicy:'invalid',now,gateMs:300000})).rejects.toThrow('invalid_existing_role_policy');expect(f.pool.query).not.toHaveBeenCalled();expect((await f.tick({now,gateMs:300000})).scanned).toBe(1);
});
