import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {deviceLockFixture} from '../helpers/headed-device-pg-fixture.js';
import {takeOverHeadedTask} from '../../lib/headed-task-owner.js';
import {acquireDeviceLock,releaseDeviceLocksHeldBy,sweepStaleDeviceLocks} from '../../device-lock-helpers.js';
const PHONE='ANGYVB4311010223',PHONE_2='e6c7ef34';
let fixture,testPool;
async function seedTask(status) {
  const taskId = randomUUID();
  // title 带 taskId 唯一化：tasks 表 idx_tasks_dedup_active 对活跃任务按
  // (title, goal_id, project_id) 去重，同名 title 会撞唯一索引
  await testPool.query(
    'INSERT INTO tasks (id,title,status) VALUES ($1,$2,$3)',
    [taskId, `device lock test ${taskId}`, status],
  );
  return taskId;
}

beforeEach(async()=>{fixture=await deviceLockFixture();testPool=fixture.pool;});
afterEach(async()=>{if(fixture)await fixture.close();fixture=null;});

describe.sequential('device-lock-helpers on PostgreSQL', () => {
  it('并发 acquire 同一设备恰一个赢', async () => {
    const taskA = await seedTask('queued');
    const taskB = await seedTask('queued');
    const [a, b] = await Promise.all([
      acquireDeviceLock(taskA, PHONE, 30, testPool),
      acquireDeviceLock(taskB, PHONE, 30, testPool),
    ]);
    expect([a.result, b.result].sort()).toEqual(['acquired', 'locked']);
    const winner = a.result === 'acquired' ? taskA : taskB;
    const { rows } = await testPool.query(
      'SELECT locked_by, expires_at FROM device_locks WHERE device_name=$1',
      [PHONE],
    );
    expect(rows[0].locked_by).toBe(String(winner));
    expect(rows[0].expires_at).not.toBeNull();
  }, 15_000);

  it('同持有者 reacquire 续期成功', async () => {
    const taskId = await seedTask('in_progress');
    const first = await acquireDeviceLock(taskId, PHONE, 30, testPool);
    expect(first.result).toBe('acquired');
    const second = await acquireDeviceLock(taskId, PHONE, 60, testPool);
    expect(second.result).toBe('acquired');
    expect(second.lock.locked_by).toBe(String(taskId));
  }, 15_000);

  it('过期 + 持有任务仍 in_progress → 不可抢', async () => {
    const holder = await seedTask('in_progress');
    const rival = await seedTask('queued');
    expect((await acquireDeviceLock(holder, PHONE, 30, testPool)).result).toBe('acquired');
    await testPool.query(
      "UPDATE device_locks SET expires_at = NOW() - INTERVAL '1 minute' WHERE device_name=$1",
      [PHONE],
    );
    const attempt = await acquireDeviceLock(rival, PHONE, 30, testPool);
    expect(attempt.result).toBe('locked');
    expect(attempt.holder.locked_by).toBe(String(holder));
  }, 15_000);

  it('过期 + 持有任务已 failed → 可抢', async () => {
    const holder = await seedTask('failed');
    const rival = await seedTask('queued');
    await testPool.query(
      `UPDATE device_locks
          SET locked_by=$1, locked_at=NOW() - INTERVAL '2 hours',
              expires_at=NOW() - INTERVAL '1 minute'
        WHERE device_name=$2`,
      [String(holder), PHONE],
    );
    const attempt = await acquireDeviceLock(rival, PHONE, 30, testPool);
    expect(attempt.result).toBe('acquired');
    expect(attempt.lock.locked_by).toBe(String(rival));
  }, 15_000);

  it('未注册 serial → unknown_device', async () => {
    const taskId = await seedTask('queued');
    const attempt = await acquireDeviceLock(taskId, 'NO_SUCH_SERIAL_123', 30, testPool);
    expect(attempt.result).toBe('unknown_device');
  }, 15_000);

  it('永久锁（expires_at IS NULL 且 locked_by 非空）持有任务 in_progress 时不可抢', async () => {
    const holder = await seedTask('in_progress');
    const rival = await seedTask('queued');
    await testPool.query(
      'UPDATE device_locks SET locked_by=$1, locked_at=NOW(), expires_at=NULL WHERE device_name=$2',
      [String(holder), PHONE],
    );
    const attempt = await acquireDeviceLock(rival, PHONE, 30, testPool);
    expect(attempt.result).toBe('locked');
    expect(attempt.holder.locked_by).toBe(String(holder));
  }, 15_000);

  it('releaseDeviceLocksHeldBy 只放本任务的锁', async () => {
    const taskA = await seedTask('in_progress');
    const taskB = await seedTask('in_progress');
    expect((await acquireDeviceLock(taskA, PHONE, 30, testPool)).result).toBe('acquired');
    expect((await acquireDeviceLock(taskB, PHONE_2, 30, testPool)).result).toBe('acquired');
    const released = await releaseDeviceLocksHeldBy(taskA, testPool);
    expect(released).toBe(1);
    const { rows } = await testPool.query(
      'SELECT device_name, locked_by FROM device_locks WHERE device_name = ANY($1)',
      [[PHONE, PHONE_2]],
    );
    const byName = Object.fromEntries(rows.map((r) => [r.device_name, r.locked_by]));
    expect(byName[PHONE]).toBeNull();
    expect(byName[PHONE_2]).toBe(String(taskB));
  }, 15_000);

  it('sweepStaleDeviceLocks：持有任务 completed 的锁被放、in_progress 的保留', async () => {
    const doneTask = await seedTask('completed');
    const liveTask = await seedTask('in_progress');
    await testPool.query(
      'UPDATE device_locks SET locked_by=$1, locked_at=NOW(), expires_at=NOW() WHERE device_name=$2',
      [String(doneTask), PHONE],
    );
    expect((await acquireDeviceLock(liveTask, PHONE_2, 30, testPool)).result).toBe('acquired');
    const swept = await sweepStaleDeviceLocks(testPool);
    expect(swept).toBe(1);
    const { rows } = await testPool.query(
      'SELECT device_name, locked_by FROM device_locks WHERE device_name = ANY($1)',
      [[PHONE, PHONE_2]],
    );
    const byName = Object.fromEntries(rows.map((r) => [r.device_name, r.locked_by]));
    expect(byName[PHONE]).toBeNull();
    expect(byName[PHONE_2]).toBe(String(liveTask));
  }, 15_000);

  it('sweepStaleDeviceLocks：持有任务 status=queued → 不释放（queued 算活跃）', async () => {
    // 钉住反直觉语义：dispatch revert 回 queued 的任务保留锁，
    // 二次派发走同持有者 reacquire；sweep 不得误扫。
    const queuedHolder = await seedTask('queued');
    expect((await acquireDeviceLock(queuedHolder, PHONE, 30, testPool)).result).toBe('acquired');
    const swept = await sweepStaleDeviceLocks(testPool);
    expect(swept).toBe(0);
    const { rows } = await testPool.query(
      'SELECT locked_by FROM device_locks WHERE device_name=$1',
      [PHONE],
    );
    expect(rows[0].locked_by).toBe(String(queuedHolder));
  }, 15_000);

  it('sweepStaleDeviceLocks：非 uuid 持有者（手工 acquire）→ 不回收（uuid 守卫）', async () => {
    // 手工/脚本身份（如 'manual-alex'）在 tasks 表必然无对应行，没 uuid 守卫会被
    // 对账秒扫；它们靠 TTL 过期 + acquire 双重判据解开。
    await testPool.query(
      'UPDATE device_locks SET locked_by=$1, locked_at=NOW(), expires_at=NOW() + INTERVAL \'30 minutes\' WHERE device_name=$2',
      ['manual-alex', PHONE],
    );
    const swept = await sweepStaleDeviceLocks(testPool);
    expect(swept).toBe(0);
    const { rows } = await testPool.query(
      'SELECT locked_by FROM device_locks WHERE device_name=$1',
      [PHONE],
    );
    expect(rows[0].locked_by).toBe('manual-alex');
  }, 15_000);

  it('sweepStaleDeviceLocks：持有 task id 不存在于 tasks 表 → 释放', async () => {
    const ghostTaskId = await seedTask('queued');
    expect((await acquireDeviceLock(ghostTaskId,PHONE,30,testPool)).result).toBe('acquired');
    await testPool.query(
      'UPDATE device_locks SET locked_by=$1, locked_at=NOW(), expires_at=NULL WHERE device_name=$2',
      [String(ghostTaskId), PHONE],
    );
    expect((await testPool.query('DELETE FROM tasks WHERE id=$1 RETURNING id',[ghostTaskId])).rowCount).toBe(1);
    expect((await testPool.query('SELECT id FROM tasks WHERE id=$1',[ghostTaskId])).rowCount).toBe(0);
    const swept = await sweepStaleDeviceLocks(testPool);
    expect(swept).toBe(1);
    const { rows } = await testPool.query(
      'SELECT locked_by FROM device_locks WHERE device_name=$1',
      [PHONE],
    );
    expect(rows[0].locked_by).toBeNull();
    expect((await testPool.query('SELECT locked_at,expires_at FROM device_locks WHERE device_name=$1',[PHONE])).rows).toEqual([{locked_at:null,expires_at:null}]);
    expect(await sweepStaleDeviceLocks(testPool)).toBe(0);
  }, 15_000);
});

async function orphan(){
 const id=await seedTask('queued');expect((await acquireDeviceLock(id,PHONE,30,testPool)).result).toBe('acquired');
 expect((await testPool.query('DELETE FROM tasks WHERE id=$1',[id])).rowCount).toBe(1);return id;
}
async function lockRow(){return (await testPool.query('SELECT * FROM device_locks WHERE device_name=$1',[PHONE])).rows[0];}
async function routedTask(){
 const id=await seedTask('queued'),receipt=randomUUID();
 await testPool.query("UPDATE tasks SET payload=$2 WHERE id=$1",[id,{routing_receipt_id:receipt,work_kind:'coding_review'}]);
 await testPool.query("INSERT INTO work_routing_receipts VALUES($1,$2,'data','coding_review')",[receipt,id]);return id;
}
const request=id=>({taskId:id,requestId:randomUUID(),sessionId:'device-guard-fixture',expectedRowVersion:0,expectedExecutorKind:'bridge',expectedCurrentRunId:null});
async function nativeOwner(pool,id){
 // native-owned-state-fixture: only合法历史DB结构，不声称由takeOver授权或生产回执生成。
 const generation=randomUUID(),session='native-owned-state-fixture';
 await pool.query("UPDATE tasks SET status='failed',executor_kind='headed-session',payload=$2 WHERE id=$1",[id,{headed_takeover:{generation,session_id:session}}]);
 await pool.query('INSERT INTO headed_task_takeovers(task_id,generation,request_id,session_id,previous_owner) VALUES($1,$2,$3,$4,$5)',[id,generation,randomUUID(),session,{fixture:'native-owned-state-fixture'}]);
}
describe.sequential('509孤儿释放最窄边界/真实PG',()=>{
 it('never-existing UUID新acquire拒绝，设备整行不变',async()=>{
  const before=await lockRow();await expect(acquireDeviceLock(randomUUID(),PHONE,30,testPool)).rejects.toThrow('headed_task_identity_missing');expect(await lockRow()).toEqual(before);
 });
 it('其它execution relation缺task仍拒；真实task_runs FK阻DELETE',async()=>{
  await expect(testPool.query('INSERT INTO task_runs(task_id) VALUES($1)',[randomUUID()])).rejects.toThrow('headed_task_identity_missing');
  const id=await seedTask('queued');await testPool.query('INSERT INTO task_runs(task_id) VALUES($1)',[id]);
  await expect(testPool.query('DELETE FROM tasks WHERE id=$1',[id])).rejects.toMatchObject({code:'23503'});
  expect((await testPool.query('SELECT id FROM tasks WHERE id=$1',[id])).rowCount).toBe(1);
 });
 it('孤儿完整三NULL允许，partial clear/改device_name/重绑UUID或manual拒且整行保留',async()=>{
  await orphan();const before=await lockRow();
  for(const [sql,params] of [
   ['UPDATE device_locks SET locked_by=NULL WHERE device_name=$1',[PHONE]],
   ['UPDATE device_locks SET device_name=$2,locked_by=NULL,locked_at=NULL,expires_at=NULL WHERE device_name=$1',[PHONE,'renamed-device']],
   ['UPDATE device_locks SET locked_by=$2 WHERE device_name=$1',[PHONE,randomUUID()]],
   ['UPDATE device_locks SET locked_by=$2 WHERE device_name=$1',[PHONE,'manual-rebind']]]){
   await expect(testPool.query(sql,params)).rejects.toThrow('headed_task_identity_missing');expect(await lockRow()).toEqual(before);
  }
  expect(await sweepStaleDeviceLocks(testPool)).toBe(1);expect(await lockRow()).toMatchObject({locked_by:null,locked_at:null,expires_at:null});expect(await sweepStaleDeviceLocks(testPool)).toBe(0);
 });
 it('旧UUID闸忙55P03；释放后才扫，不绕共享闸',async()=>{
  const id=await orphan(),before=await lockRow(),db=await testPool.connect();
  try{await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtextextended('headed_task_owner:'||$1::text,0))",[id]);
   await expect(sweepStaleDeviceLocks(testPool)).rejects.toMatchObject({code:'55P03'});expect(await lockRow()).toEqual(before);
  }finally{await db.query('ROLLBACK');db.release();}
  expect(await sweepStaleDeviceLocks(testPool)).toBe(1);
 });
 it('非RC不允许孤儿释放，queued重建仍活跃不扫',async()=>{
  const id=await orphan(),before=await lockRow(),db=await testPool.connect();
  try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await expect(sweepStaleDeviceLocks(db)).rejects.toThrow('headed_guard_isolation_unsupported');}finally{await db.query('ROLLBACK');db.release();}
  expect(await lockRow()).toEqual(before);await testPool.query("INSERT INTO tasks(id,status) VALUES($1,'queued')",[id]);expect(await sweepStaleDeviceLocks(testPool)).toBe(0);
  expect(await releaseDeviceLocksHeldBy(id,testPool)).toBe(1);
 });
 it('真takeOver已有设备锁409；真takeOver后新占设备拒绝',async()=>{
  const id=await routedTask();await acquireDeviceLock(id,PHONE,30,testPool);
  await expect(takeOverHeadedTask(testPool,request(id))).rejects.toMatchObject({statusCode:409,message:'headed_takeover_active_execution'});
  await releaseDeviceLocksHeldBy(id,testPool);await takeOverHeadedTask(testPool,request(id));
  const before=await lockRow();await expect(acquireDeviceLock(id,PHONE,30,testPool)).rejects.toThrow('headed_task_owned');expect(await lockRow()).toEqual(before);
 });
 for(const recreated of [false,true])it(`native-owned-state-fixture ${recreated?'重建owned':'历史owned'}锁不释放/重绑，task+owner+整行保留`,async()=>{
  const id=randomUUID();let historical;
  try{
   historical=await deviceLockFixture({seedBeforeGuard:async pool=>{
    await pool.query("INSERT INTO tasks(id,status) VALUES($1,'queued')",[id]);await acquireDeviceLock(id,PHONE,30,pool);
   }});
   const pool=historical.pool;
   if(recreated){await pool.query('DELETE FROM tasks WHERE id=$1',[id]);await pool.query("INSERT INTO tasks(id,status) VALUES($1,'queued')",[id]);}
   await nativeOwner(pool,id);
   const state=async()=>({task:(await pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0],owner:(await pool.query('SELECT * FROM headed_task_takeovers WHERE task_id=$1',[id])).rows[0],lock:(await pool.query('SELECT * FROM device_locks WHERE device_name=$1',[PHONE])).rows[0]});
   const before=await state();expect(before.owner.task_id).toBe(id);
   await expect(sweepStaleDeviceLocks(pool)).rejects.toThrow('headed_task_owned');
   await expect(releaseDeviceLocksHeldBy(id,pool)).rejects.toThrow('headed_task_owned');
   await expect(pool.query('UPDATE device_locks SET locked_by=$2 WHERE device_name=$1',[PHONE,'manual-rebind'])).rejects.toThrow('headed_task_owned');
   await expect(pool.query('UPDATE device_locks SET locked_by=$2 WHERE device_name=$1',[PHONE,randomUUID()])).rejects.toThrow();
   expect(await state()).toEqual(before);
  }finally{if(historical)await historical.close();}
 });
});
