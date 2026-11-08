import {randomUUID,createHash,createHmac} from 'node:crypto';
import {afterEach,beforeEach,expect,test} from 'vitest';
import {deviceLockFixture} from '../helpers/headed-device-pg-fixture.js';
import {acquireDeviceLock,releaseDeviceLocksHeldBy,sweepStaleDeviceLocks} from '../../device-lock-helpers.js';
import {startRun,finishRun,recordRunFromCallback} from '../../lib/task-run.js';
import {createCommonRunnerDispatcher} from '../../lib/common-runner-dispatch.js';
const PHONE='ANGYVB4311010223',token='synthetic-isolated-common-runner-token-123456';let fixture,pool;
beforeEach(async()=>{fixture=await deviceLockFixture();pool=fixture.pool;await pool.query(`
 ALTER TABLE tasks ADD COLUMN kind TEXT DEFAULT 'agent';
 ALTER TABLE task_runs ADD COLUMN context JSONB DEFAULT '{}',ADD COLUMN result JSONB,ADD COLUMN workflow_id UUID,ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now(),ADD COLUMN error_message TEXT;
 CREATE UNIQUE INDEX fixture_run_id ON task_runs(run_id);
 CREATE TABLE workflows(id UUID PRIMARY KEY);
 CREATE TABLE spans(run_id TEXT,occurrence_key TEXT,payload_sha256 TEXT,evidence JSONB);
 `);});
afterEach(async()=>{await fixture?.close();fixture=null;});
async function task(status='in_progress'){const id=randomUUID();await pool.query('INSERT INTO tasks(id,title,status) VALUES($1,$2,$3)',[id,id,status]);return id;}
async function holder(source='workflow-common-runner'){
 const id=await task(),runId=randomUUID();expect(await startRun({taskId:id,runId,source},{pool})).toMatchObject({created:true});
 expect((await acquireDeviceLock(id,PHONE,30,pool)).result).toBe('acquired');
 await pool.query("UPDATE tasks SET status='blocked',result=$2 WHERE id=$1",[id,{common_runner:{run_id:runId},common_runner_observation:{evidence:{authenticated_receipt:{execution_unknown:false,status:'completed'}}}}]);
 return {id,runId};
}
const row=async()=>(await pool.query('SELECT * FROM device_locks WHERE device_name=$1',[PHONE])).rows[0];
async function expire(){await pool.query("UPDATE device_locks SET locked_at=NOW()-INTERVAL '10 hours',expires_at=NOW()-INTERVAL '1 hour' WHERE device_name=$1",[PHONE]);}
test('真实TaskRun未结算，blocked且未过期不被sweeper释放',async()=>{const h=await holder();const before=await row();expect(await sweepStaleDeviceLocks(pool)).toBe(0);expect(await row()).toEqual(before);expect((await row()).locked_by).toBe(h.id);});
test('真实TaskRun未结算，blocked且TTL/旧租约均过期仍不能被另Task抢占',async()=>{const h=await holder('common-runner'),rival=await task('queued');await expire();const before=await row();expect((await acquireDeviceLock(rival,PHONE,30,pool)).result).toBe('locked');expect(await row()).toEqual(before);expect((await row()).locked_by).toBe(h.id);});
test('Task状态改failed或伪造result stopped也不能走自动release旁路',async()=>{const h=await holder();await pool.query("UPDATE tasks SET status='failed',result=$2 WHERE id=$1",[h.id,{common_runner:{run_id:'foreign',execution_stopped:true},execution_stopped:true}]);const before=await row();expect(await releaseDeviceLocksHeldBy(h.id,pool)).toBe(0);expect(await sweepStaleDeviceLocks(pool)).toBe(0);expect(await row()).toEqual(before);});
test('普通无CommonRunner绑定blocked仍回收；Task.result伪binding不升级成永久锁',async()=>{const id=await task('blocked');await pool.query('UPDATE tasks SET result=$2 WHERE id=$1',[id,{common_runner:{run_id:randomUUID()}}]);await acquireDeviceLock(id,PHONE,30,pool);expect(await sweepStaleDeviceLocks(pool)).toBe(1);expect((await row()).locked_by).toBeNull();});
test('普通callback伪actor/结算内容不能解除CommonRunner隔离',async()=>{const h=await holder();await recordRunFromCallback({taskId:h.id,runId:h.runId,status:'completed',result:{actor:'common-runner',common_runner:{business_status:'completed'},execution_stopped:true}},{pool,emit:async()=>{}});await expire();expect(await sweepStaleDeviceLocks(pool)).toBe(0);expect(await releaseDeviceLocksHeldBy(h.id,pool)).toBe(0);expect((await acquireDeviceLock(await task('queued'),PHONE,30,pool)).result).toBe('locked');expect((await row()).locked_by).toBe(h.id);});
async function settle(h){
 const profile='a'.repeat(64),binding={task_id:h.id,run_id:h.runId,machine_id:'synthetic-worker',profile:'synthetic',profile_sha256:profile,mode:'exploration',execution_version_id:randomUUID(),execution_grant_id:randomUUID(),launch_state:'reserved'};
 await pool.query('UPDATE tasks SET result=$2 WHERE id=$1',[h.id,{common_runner:binding}]);
 const manifest=[{occurrence_key:'verified-cleanup',payload_sha256:'b'.repeat(64)}],manifestHash=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
 await pool.query('INSERT INTO spans VALUES($1,$2,$3,$4)',[h.runId,manifest[0].occurrence_key,manifest[0].payload_sha256,{task_id:h.id,machine_id:binding.machine_id,mode:'exploration',profile_digest:profile,kind:'validation'}]);
 const dispatcher=createCommonRunnerDispatcher({pool,token,resolveBoundNode:async()=>({endpoints:{worker:'http://100.64.0.1:5231'}}),transport:async({body})=>{const receipt={run_id:h.runId,task_id:h.id,machine_id:binding.machine_id,request_nonce:body.request_nonce,profile_sha256:profile,mode:'exploration',status:'needs_review',cleanup_required:false,execution_state:'not_started',execution_unknown:false,writeback:{total:1,acked:1,pending:0,blocked:0,manifest_sha256:manifestHash},validation:{}};return {receipt,signature:createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex')};}});
 const observed=await dispatcher.dispatch('inspect',h.runId,{task_id:h.id});expect(observed.central_run).toEqual({status:'needs_review',recording_status:'confirmed'});
 return (await pool.query('SELECT * FROM task_runs WHERE run_id=$1',[h.runId])).rows[0];
}
test('正式dispatcher认证+中央manifest独立读回完成未启动结算后可回收',async()=>{const h=await holder();const settled=await settle(h);expect(settled.status).toBe('failed');expect(settled.ended_at).not.toBeNull();expect(settled.result.actor).toBe('common-runner');expect(await sweepStaleDeviceLocks(pool)).toBe(1);expect((await row()).locked_by).toBeNull();});
test('可信结算后过期可抢，另一次未结算CommonRunner run仍保持保护',async()=>{const h=await holder();await settle(h);await expire();expect((await acquireDeviceLock(await task('queued'),PHONE,30,pool)).result).toBe('acquired');
 await releaseDeviceLocksHeldBy((await row()).locked_by,pool);await acquireDeviceLock(h.id,PHONE,30,pool);expect(await startRun({taskId:h.id,runId:randomUUID(),source:'common-runner'},{pool})).toMatchObject({created:true});await expire();expect(await sweepStaleDeviceLocks(pool)).toBe(0);expect((await acquireDeviceLock(await task('queued'),PHONE,30,pool)).result).toBe('locked');});
