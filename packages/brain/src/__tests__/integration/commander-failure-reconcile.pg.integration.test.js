import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { privateFixtureDatabase } from '../fixtures/private-fixture-db.js';
import { failureFixture } from '../../lib/__tests__/fixtures/commander-failure-fixture.js';
import { receiveCommanderEvent } from '../../lib/commander-v2-feedback.js';
import { dispatchCommanderV2 } from '../../lib/commander-v2-dispatch.js';
import { reconcileCommanderTask } from '../../lib/commander-v2-control.js';
import { reconcileFailedCommander } from '../../lib/commander-failure-reconcile.js';
import { digest } from '../../lib/commander-v2-contract.js';
import { updateTaskStatus } from '../../task-updater.js';
import { executeDecision } from '../../decision.js';
vi.mock('../../db.js',()=>({default:{query:(...args)=>f.db.query(...args)}}));
import { buildTerminalUpdate } from '../../lib/task-terminal.js';
let f,x,input,sessions;
beforeEach(async()=>{
 x=failureFixture();x.task.claimed_by='workflow-commander-v2';
 const a=x.verifier.result.commander_failure_verification;
 x.verifier.result.commander_failure_verification_authorization={...x.verifier.payload.commander_failure_verification_of,purpose:x.verifier.payload.purpose,review_actor:a.review_actor};
 x.task.result.commander_failure_reconciliation={...x.verifier.payload.commander_failure_verification_of,verification_task_id:x.verifier.id,operator_actor:'codex:operator'};
 f=await privateFixtureDatabase('failureclose',async db=>{
 await db.query(`CREATE TABLE tasks(id uuid PRIMARY KEY,parent_task_id uuid,title text,status text,task_type text,payload jsonb,result jsonb,claimed_by text,claimed_at timestamptz,updated_at timestamptz,completed_at timestamptz,error_message text,retry_count integer DEFAULT 0,max_retries integer DEFAULT 3);
 CREATE TABLE task_runs(id uuid PRIMARY KEY,task_id uuid,run_id text,status text,ended_at timestamptz,result jsonb DEFAULT '{}',error_message text,updated_at timestamptz,context jsonb);
 CREATE TABLE device_locks(device_name text PRIMARY KEY,locked_by text,locked_at timestamptz,expires_at timestamptz);
 CREATE TABLE decisions(id uuid PRIMARY KEY,actions jsonb,status text,executed_at timestamptz,updated_at timestamptz);
 CREATE TABLE task_events(id bigserial,task_id uuid,event_type text,payload jsonb,created_at timestamptz);
 CREATE TABLE task_leases(task_id uuid PRIMARY KEY,claimer text,lease_until timestamptz,heartbeat_at timestamptz,phase text,claimed_at timestamptz,source text,updated_at timestamptz,released_at timestamptz,release_reason text);`);
 });
 for(const row of [x.task,x.verifier])await f.db.query('INSERT INTO tasks(id,parent_task_id,title,status,task_type,payload,result,claimed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[row.id,row.parent_task_id??null,'fixture',row.status,row.task_type??'research',row.payload,row.result,row.claimed_by]);
 await f.db.query("INSERT INTO task_runs(id,task_id,run_id,status,context) VALUES($1,$1,$2,'running',$3)",[x.task.id,x.task.result.workflow_control.envelope.run_id,{commander_envelope:x.task.result.workflow_control.envelope}]);
 await f.db.query("INSERT INTO task_leases(task_id,claimer,source,claimed_at) VALUES($1,$2,'claim','2026-01-01T00:09:00Z')",[x.verifier.id,a.review_actor]);
 await f.db.query("INSERT INTO device_locks(device_name,locked_by) VALUES('SERIAL1',NULL)");
 input={...x.verifier.payload.commander_failure_verification_of,verification_task_id:x.verifier.id,expected_control_sha256:digest(x.task.result.workflow_control),expected_attestation_sha256:digest(a),reason:'真实原child失败，原预算内清理独审',actor:'codex:operator'};
 sessions={observation:x.observation,recheck:vi.fn(async()=>x.observation),assertAlive:vi.fn(),release:vi.fn()};
});
afterEach(async()=>f?.close());
const deps=()=>({now:()=>x.now,probe:async()=>sessions});
async function task(){return (await f.db.query('SELECT * FROM tasks WHERE id=$1',[x.task.id])).rows[0];}
it('旧症状：官方status=false无delivery正常reconcile不能关闭；新受控入口只记FAIL/unknown',async()=>{
 await reconcileCommanderTask(f.db,x.task.id,{status:async()=>({protocol:'commander-v2',run_id:input.run_id,execution_stopped:false,events:[]})});
 expect((await task()).status).toBe('in_progress');expect((await task()).result.workflow_control).not.toHaveProperty('delivery');
 const r=await reconcileFailedCommander(f.db,x.task.id,input,deps());expect(r.status).toBe('failed');
 const t=await task();expect(t.status).toBe('failed');expect(t.result.workflow_control).toMatchObject({phase:'final',verdict:'FAIL',retry_safe:false,effects:'unknown'});expect(t.result.workflow_control).not.toHaveProperty('delivery');
 expect(t.result.workflow_control.envelope).toEqual(x.task.result.workflow_control.envelope);
 expect((await f.db.query('SELECT status,ended_at FROM task_runs')).rows[0]).toMatchObject({status:'failed',ended_at:expect.any(Date)});
 expect((await f.db.query('SELECT COUNT(*)::int AS n FROM task_runs')).rows[0].n).toBe(1);expect(sessions.release).toHaveBeenCalledWith(true);
});
it('相同请求幂等，变更摘要拒绝，无第二run或新额度',async()=>{
 await reconcileFailedCommander(f.db,x.task.id,input,deps());expect((await reconcileFailedCommander(f.db,x.task.id,input,deps())).duplicate).toBe(true);
 await expect(reconcileFailedCommander(f.db,x.task.id,{...input,expected_attestation_sha256:'f'.repeat(64)},deps())).rejects.toThrow();
 expect((await f.db.query('SELECT COUNT(*)::int AS n FROM task_runs')).rows[0].n).toBe(1);expect((await task()).retry_count).toBe(0);
});
it.each(['control','attestation','brainlock','last-read'])('CAS/资源/最后原件变化拒绝并回滚：%s',async mode=>{
 if(mode==='control')input.expected_control_sha256='f'.repeat(64);
 if(mode==='attestation')await f.db.query("UPDATE tasks SET result=result||'{\"commander_failure_verification\":{}}' WHERE id=$1",[x.verifier.id]);
 if(mode==='brainlock')await f.db.query("UPDATE device_locks SET locked_by='other'");
 if(mode==='last-read')sessions.recheck.mockImplementation(async()=>({...x.observation,worker_exclusive:false}));
 await expect(reconcileFailedCommander(f.db,x.task.id,input,deps())).rejects.toThrow();expect((await task()).status).toBe('in_progress');expect((await f.db.query('SELECT ended_at FROM task_runs')).rows[0].ended_at).toBeNull();
});
it('普通终态入口仍拒绝，只有相同proof摘要的内部失败出口允许',async()=>{
 const q=buildTerminalUpdate(x.task.id,'failed');expect((await f.db.query(q.sql,q.params)).rowCount).toBe(0);
 await reconcileFailedCommander(f.db,x.task.id,input,deps());
 const wrong=buildTerminalUpdate(x.task.id,'completed');expect((await f.db.query(wrong.sql,wrong.params)).rowCount).toBe(0);
});

it('真实通用retry决策不能把默认max_retries=3的已封旧尝试重排',async()=>{
 await reconcileFailedCommander(f.db,x.task.id,input,deps());
 await f.db.query("INSERT INTO decisions(id,actions,status) VALUES($1,$2,'pending')",[x.task.id,JSON.stringify([{type:'retry',target_id:x.task.id}])]);
 const decision=await executeDecision(x.task.id);
 expect(decision.results[0].result).toMatchObject({success:false,action:'not_requeued'});
 expect((await updateTaskStatus(x.task.id,'queued')).success).toBe(false);
 expect((await task()).status).toBe('failed');expect((await task()).max_retries).toBe(3);expect((await task()).retry_count).toBe(0);
 await reconcileCommanderTask(f.db,x.task.id,{status:vi.fn(()=>{throw Error('不得起监督/业务');})});
 expect((await f.db.query('SELECT COUNT(*)::int AS n FROM task_runs')).rows[0].n).toBe(1);
});

it('两个真PG连接并发CAS只收口一次；不同请求不覆写终态',async()=>{
 const pool=f.createPool(3);
 const [a,b]=await Promise.all([reconcileFailedCommander(pool,x.task.id,input,deps()),reconcileFailedCommander(pool,x.task.id,input,deps())]);
 expect([a,b].filter(v=>v.duplicate)).toHaveLength(1);
 expect((await f.db.query("SELECT COUNT(*)::int AS n FROM task_events WHERE event_type='commander_failed_reconciliation'")).rows[0].n).toBe(1);
 await expect(reconcileFailedCommander(pool,x.task.id,{...input,reason:'不同请求不覆盖原事实'},deps())).rejects.toThrow();
});
it('独审lease换人或原授权operator不符均拒绝',async()=>{
 await f.db.query("UPDATE task_leases SET claimer='codex:other'");
 await expect(reconcileFailedCommander(f.db,x.task.id,input,deps())).rejects.toThrow();
 expect((await task()).status).toBe('in_progress');
});

it('晚到旧epoch/seq反馈及status轮询不能把失败final退回blocked或重发',async()=>{
 const old={protocol:'commander-v2',run_id:input.run_id,attempt:input.attempt,owner_epoch:input.owner_epoch,seq:1,type:'blocked',data:{reason:'旧失读'}};
 await receiveCommanderEvent(f.db,x.task.id,old);
 input.expected_control_sha256=digest((await task()).result.workflow_control);
 await reconcileFailedCommander(f.db,x.task.id,input,deps());
 const final=(await task()).result.workflow_control;
 await expect(receiveCommanderEvent(f.db,x.task.id,old)).rejects.toMatchObject({status:409});
 await expect(receiveCommanderEvent(f.db,x.task.id,{...old,seq:2})).rejects.toMatchObject({status:409});
 const status=vi.fn(()=>{throw Error('禁止旧status续起');});
 await reconcileCommanderTask(f.db,x.task.id,{status});expect(status).not.toHaveBeenCalled();
 const start=vi.fn(()=>{throw Error('禁止新业务尝试');});
 await dispatchCommanderV2(f.db,x.task.id,{startRun:start,sshDispatch:start});expect(start).not.toHaveBeenCalled();
 expect((await task()).result.workflow_control).toEqual(final);expect((await task()).status).toBe('failed');
 expect((await f.db.query('SELECT COUNT(*)::int AS n FROM task_runs')).rows[0].n).toBe(1);
});
