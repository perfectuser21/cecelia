import {test,expect,afterEach} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import pg from 'pg';
import {observeHeartbeat,stopOwnedHost} from '../../../scripts/commander-workflow/host-heartbeat.mjs';
import {databaseConfig,isMainModule} from '../../../scripts/commander-workflow/runtime-support.mjs';
import state from '../activity-supervisor-state.cjs';
import {buildCommanderRunReport} from '../commander-run-report.js';
const dirs=[];afterEach(()=>{for(const dir of dirs.splice(0))fs.rmSync(dir,{recursive:true,force:true});});
const identity={task_id:'task',run_id:'run',definition_sha256:'hash'};
const child={pid:123,birth:'birth',nonce:'nonce'};
function heartbeat(change={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'commander-heartbeat-'));dirs.push(dir);const file=path.join(dir,'heartbeat.json');fs.writeFileSync(file,JSON.stringify({protocol:'commander-host-heartbeat/v1',identity,...child,sequence:1,...change}));return file;}
test.each([{nonce:'old'},{pid:12},{birth:'other'},{identity:{...identity,task_id:'other'}}])('身份错误的心跳%j不能维持宿主存活',change=>{
 const file=heartbeat(change),first=observeHeartbeat(file,child,identity,null,0);expect(first.seen).toBe(false);expect(observeHeartbeat(file,child,identity,first,10001).stale).toBe(true);
});
test('心跳必须序号持续增长；远期时间戳不能续命，监督器重启有独立宽限',()=>{
 const file=heartbeat({time:9e15}),first=observeHeartbeat(file,child,identity,null,0);expect(first.seen).toBe(true);expect(observeHeartbeat(file,child,identity,first,5000).stale).toBe(true);
 const value=JSON.parse(fs.readFileSync(file));value.sequence=2;fs.writeFileSync(file,JSON.stringify(value));const advanced=observeHeartbeat(file,child,identity,first,4999);expect(advanced.stale).toBe(false);expect(observeHeartbeat(file,child,identity,advanced,8000).stale).toBe(false);
 expect(observeHeartbeat(file,child,identity,null,9000).stale).toBe(false);
});
test('birth不符不误杀；只终止同birth宿主',async()=>{
 const proc=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});try{await new Promise(r=>setTimeout(r,50));const birth=state.processBirth(proc.pid);expect(birth).toBeTruthy();await stopOwnedHost({pid:proc.pid,birth:'wrong'});expect(state.sameProcess(proc.pid,birth)).toBe(true);await stopOwnedHost({pid:proc.pid,birth});expect(state.sameProcess(proc.pid,birth)).toBe(false);}finally{try{proc.kill('SIGKILL');}catch{}}
});
test('URL中的其他options保留而声明schema最后生效',()=>{
 const config=databaseConfig('postgresql://user@localhost/cecelia_scratch?options=-c%20statement_timeout%3D1234%20-c%20search_path%3Dpublic',{schema:'actions'});
 expect(new pg.Client(config).connectionParameters.options).toBe('-c statement_timeout=1234 -c search_path=public -c search_path=actions');expect(config.query_timeout).toBe(6000);expect(()=>databaseConfig('postgresql://localhost/db',{schema:'bad;DROP'})).toThrow('commander_schema_invalid');
});
test('import的模块不被当作CLI执行',()=>{expect(isMainModule(import.meta.url,'/absent-entry')).toBe(false);expect(isMainModule(import.meta.url,undefined)).toBe(false);});
test.each(['CANCELLED','MAX_RECOVERY_ATTEMPTS_EXCEEDED'])('取消或恢复预算终态%s不得显示运行中',status=>{
 const run={task_id:'task',run_id:'run',contract:{workflow:'workflow',activities:[]}},workflow={workflowID:'commander-foundation:run',status};
 const report=buildCommanderRunReport({run,workflow,supervision:{reason:'commander_supervisor_deadline_exceeded'}});expect(report.status).toBe('needs_review');expect(report.business_pass).toBe(false);expect(report.reason_code).toBe('commander_supervisor_deadline_exceeded');expect(report.next_action).not.toContain('继续观察');
});
