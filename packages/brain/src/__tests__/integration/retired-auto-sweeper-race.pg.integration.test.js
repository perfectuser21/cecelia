import { randomUUID } from 'node:crypto';
import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { deviceLockFixture } from '../helpers/headed-device-pg-fixture.js';
import { sweepStaleDeviceLocks } from '../../device-lock-helpers.js';
const PHONE='ANGYVB4311010223';let fixture,testPool;
async function seedTask(status){const id=randomUUID();await testPool.query('INSERT INTO tasks(id,title,status) VALUES($1,$2,$3)',[id,`sweep test ${id}`,status]);return id;}
describe.sequential('清理器运行状态并发',()=>{
beforeEach(async()=>{fixture=await deviceLockFixture();testPool=fixture.pool;});
afterEach(async()=>{if(fixture)await fixture.close();fixture=null;});
  it('sweeper 不得清除并发恢复运行并重新持有的同任务设备锁', async () => {
    const id=await seedTask('blocked');
    await testPool.query('UPDATE device_locks SET locked_by=$1,locked_at=NOW(),expires_at=NOW()+interval \'1 hour\' WHERE device_name=$2',[id,PHONE]);
    const locker=await testPool.connect(); const sweeper=await testPool.connect();
    let pending;
    try {
      await locker.query('BEGIN');
      await locker.query('UPDATE device_locks SET locked_at=clock_timestamp() WHERE device_name=$1',[PHONE]);
      let finished=false;
      pending=sweepStaleDeviceLocks(sweeper);
      pending.then(()=>{finished=true;},()=>{finished=true;});
      // 候选可 SKIP LOCKED 直接返回；旧 SQL 必须观察到行锁等待才触发交错。
      let observed=false;
      for(let i=0;i<100;i++) {
        const blocked=(await testPool.query('SELECT cardinality(pg_blocking_pids($1)) AS n',[sweeper.processID])).rows[0].n;
        if(finished || Number(blocked)>0){observed=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(observed).toBe(true);
      await locker.query("UPDATE tasks SET status='in_progress' WHERE id=$1",[id]);
      await locker.query('COMMIT');
      await pending;
      const row=(await testPool.query('SELECT locked_by FROM device_locks WHERE device_name=$1',[PHONE])).rows[0];
      expect(row.locked_by).toBe(id);
    } finally {
      await locker.query('ROLLBACK').catch(()=>{});
      if(pending) await pending.catch(()=>{});
      locker.release(); sweeper.release();
    }
  },15000);
});
