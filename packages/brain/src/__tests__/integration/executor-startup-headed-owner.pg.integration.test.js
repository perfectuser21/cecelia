import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {taskLeaseFixture,seedTask} from '../helpers/task-lease-pg-fixture.js';
import {claimTaskWithLease,reapExpiredLeases} from '../../lib/task-lease.js';

const database=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn()}));
vi.mock('../../db.js',()=>({default:database}));
// Only the Brain-local OS boundary is absent; all task/lease SQL is real.
vi.mock('child_process',async original=>({...await original(),execSync:vi.fn(()=>''),spawn:vi.fn()}));
vi.mock('../../platform-utils.js',async original=>({...await original(),listProcessesWithPpid:()=>[],listProcessesWithElapsed:()=>[]}));
import {syncOrphanTasksOnStartup} from '../../executor.js';

let fixture,pool;
beforeEach(async()=>{
 fixture=await taskLeaseFixture();pool=fixture.pool;
 database.query.mockReset().mockImplementation(pool.query.bind(pool));
 database.connect.mockReset().mockImplementation(pool.connect.bind(pool));
});
afterEach(async()=>{vi.unstubAllEnvs();if(fixture)await fixture.close();fixture=null;});
const taskRow=async id=>(await pool.query('SELECT to_jsonb(t) AS row FROM tasks t WHERE id=$1',[id])).rows[0].row;
const leaseRow=async id=>(await pool.query('SELECT to_jsonb(l) AS row FROM task_leases l WHERE task_id=$1',[id])).rows[0]?.row;
async function owned(type,owner){
 const id=await seedTask(pool,{status:'in_progress',task_type:type,executor_kind:'headed-session'});
 const claim=await claimTaskWithLease(pool,{taskId:id,claimer:owner,executorKind:'headed-session',leaseSeconds:14400,onExpire:'fail'});
 expect(claim.status).toBe(200);
 await pool.query('UPDATE tasks SET result=$2::jsonb WHERE id=$1',[id,JSON.stringify({workflow_authoring:{stage:'register',revision:5,receipts:[{stage:'verify',verdict:'PASS'}]}})]);
 return id;
}

describe.sequential('real startup SQL retains external headed authority',()=>{
 it.each([['research','ci:authoring-main-source'],['project','ci:authoring-main-source'],['data','codex:business-acceptance-executor']])(
  '%s owner without local run preserves every task and lease byte',async(type,owner)=>{
   const id=await owned(type,owner),before={task:await taskRow(id),lease:await leaseRow(id)};
   await syncOrphanTasksOnStartup();
   expect({task:await taskRow(id),lease:await leaseRow(id)}).toEqual(before);
   expect((await taskRow(id)).payload).not.toHaveProperty('watchdog_retry_count');
  });
 it('a real brain-local inline orphan still requeues even with a claimer',async()=>{
  const id=await seedTask(pool,{status:'in_progress',executor_kind:'brain-local',claimed_by:'local-marker'});
  const result=await syncOrphanTasksOnStartup();
  expect(result.requeued).toBe(1);expect((await taskRow(id)).status).toBe('queued');
 });
 it.each([null,'','  '])('headed kind without valid persisted owner (%s) keeps original recovery',async owner=>{
  const id=await seedTask(pool,{status:'in_progress',executor_kind:'headed-session',claimed_by:owner});
  await syncOrphanTasksOnStartup();expect((await taskRow(id)).status).toBe('queued');
 });
 it('payload cannot invent headed authority for a brain-local task',async()=>{
  const id=await seedTask(pool,{status:'in_progress',executor_kind:'brain-local',payload:{executor_kind:'headed-session',claimed_by:'ci:forged'}});
  await syncOrphanTasksOnStartup();expect((await taskRow(id)).status).toBe('queued');
 });
 it('startup protection does not extend expired leases or defeat the original fail reaper',async()=>{
  const id=await owned('research','ci:expired-authoring');
  await pool.query("UPDATE task_leases SET lease_until=NOW()-interval '1 minute' WHERE task_id=$1",[id]);
  const before={task:await taskRow(id),lease:await leaseRow(id)};
  await syncOrphanTasksOnStartup();expect({task:await taskRow(id),lease:await leaseRow(id)}).toEqual(before);
  const reaped=await reapExpiredLeases(pool);
  expect(reaped.failed).toBe(1);expect((await taskRow(id)).status).toBe('failed');
  expect((await taskRow(id)).error_message).toMatch(/^lease_expired:/);
  expect((await leaseRow(id)).release_reason).toBe('expired_lost');
 });
 it('deployment canary performs no orphan read/write against the shared task database',async()=>{
  const headed=await owned('research','ci:shared-database-authoring');
  const local=await seedTask(pool,{status:'in_progress',executor_kind:'brain-local'});
  const before={headed:await taskRow(headed),local:await taskRow(local),lease:await leaseRow(headed)};
  vi.stubEnv('BRAIN_DEPLOY_CANARY','1');
  const result=await syncOrphanTasksOnStartup();
  expect(database.query).not.toHaveBeenCalled();
  expect({headed:await taskRow(headed),local:await taskRow(local),lease:await leaseRow(headed)}).toEqual(before);
  expect(result).toEqual({orphans_found:0,orphans_fixed:0,requeued:0,rebuilt:0,external_skipped:0});
 });
 it('normal primary keeps recovering a real brain-local orphan',async()=>{
  const id=await seedTask(pool,{status:'in_progress',executor_kind:'brain-local'});
  vi.stubEnv('BRAIN_DEPLOY_CANARY','0');
  expect((await syncOrphanTasksOnStartup()).requeued).toBe(1);
  expect((await taskRow(id)).status).toBe('queued');
 });
});
