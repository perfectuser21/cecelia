import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { finalizeKernelRun,loadActiveKernelRun,loadKernelRunById } from '../../orchestrator/kernel-run-store.js';
import { createKernelLeasePgFixture } from './kernel-controller-lease-renewal.pg-fixture.js';
const fixture=createKernelLeasePgFixture();
let pool;
beforeAll(async()=>{await fixture.createIsolatedDatabase();pool=fixture.pool();});
afterAll(()=>fixture.dropIsolatedDatabase());
describe('Kernel历史run读取与终结真实PG',()=>{
  it('精确读取历史run，终结时原子回收活跃attempt且不复活',async()=>{
    const {runId,taskId}=await fixture.seedOwnedRun({controllerSessionId:randomUUID()});
    expect((await loadActiveKernelRun(pool,taskId)).id).toBe(runId);
    expect((await loadKernelRunById(pool,runId)).current_task_id).toBe(taskId);
    const attemptId=randomUUID();
    await pool.query(`INSERT INTO harness_attempts(id,run_id,hop,phase,role,task_bundle,callback_secret_hash,status,lease_owner,lease_expires_at)
      VALUES($1,$2,1,'generate','generator','{}','history-fixture','running','brain:test',NOW()+INTERVAL '3 minutes')`,[attemptId,runId]);
    const receipt=await finalizeKernelRun(pool,{runId,expectedTaskId:taskId,outcome:'failed',reason:'integration_terminal_attempt'});
    expect(receipt.attemptsTerminalized).toBe(1);
    const {rows:[attempt]}=await pool.query('SELECT status,lease_owner,lease_expires_at,error_code,completed_at FROM harness_attempts WHERE id=$1',[attemptId]);
    expect(attempt).toMatchObject({status:'cancelled',lease_owner:null,lease_expires_at:null,error_code:'parent_run_terminal'});
    expect(attempt.completed_at).toBeInstanceOf(Date);
    expect(await loadActiveKernelRun(pool,taskId)).toBeNull();
    expect((await loadKernelRunById(pool,runId)).phase).toBe('failed');
    const {rows}=await pool.query('SELECT attempt_id,cleanup_cause FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1',[attemptId]);
    expect(rows).toEqual([{attempt_id:attemptId,cleanup_cause:'parent_run_terminal'}]);
  });
});
