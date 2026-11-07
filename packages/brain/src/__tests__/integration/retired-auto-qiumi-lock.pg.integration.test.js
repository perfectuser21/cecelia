import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deviceLockFixture } from '../helpers/headed-device-pg-fixture.js';
import { acquireDeviceLock } from '../../device-lock-helpers.js';
import { dispatchManualQiumi } from '../../lib/manual-qiumi-dispatch.js';
let fixture,pool,afterAcquire;
async function deviceGate(task){
  const r=await acquireDeviceLock(task.id,task.payload.device_serial,30,pool);
  if(afterAcquire) await afterAcquire(task);
  return {pass:r.result==='acquired',acquired:r.result==='acquired',acquisitionVersion:r.lock?.acquisition_version};
}
describe.sequential('旧拆解未启动的手机锁版本',()=>{
  beforeEach(async()=>{fixture=await deviceLockFixture();pool=fixture.pool;afterAcquire=null;
    await pool.query('ALTER TABLE tasks ADD COLUMN blocked_at timestamptz, ADD COLUMN blocked_reason text, ADD COLUMN metadata jsonb');});
  afterEach(async()=>{if(fixture)await fixture.close();fixture=null;});
  it('数据库已提交但响应丢失时明确报告未知，不重放释放',async()=>{
    const id=randomUUID(),serial='ANGYVB4311010223';
    await pool.query("INSERT INTO tasks(id,title,status,task_type,payload) VALUES($1,$2,'queued','qiumi_task','{}')",[id,`ack lost ${id}`]);
    const faultPool={query:async(...args)=>{const r=await pool.query(...args);if(String(args[0]).includes('WITH owned_task AS'))throw Error('response lost after commit');return r;}};
    const result=await dispatchManualQiumi({id,task_type:'qiumi_task'},faultPool,{
      deviceGate,
      route:async()=>{await pool.query("UPDATE tasks SET task_type='architecture_scan',payload=$2 WHERE id=$1",[id,{run_id:'test-run',qiumi_department:'test',device_serial:serial}]);return {outcome:'proceed'};},
      trigger:async()=>({success:false,reason:'retired_decomposition',retiredBeforeStart:true}),
    });
    expect(result).toMatchObject({status:409,body:{execution_state:'not_started',parked:null,state_unknown:true}});
    expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[id])).rows[0].status).toBe('blocked');
    expect((await pool.query('SELECT locked_by FROM device_locks WHERE device_name=$1',[serial])).rows[0].locked_by).toBeNull();
  },15000);
  it('拿设备锁后参数变为另一设备，不停放且不释放新旧锁',async()=>{
    const id=randomUUID(),a='ANGYVB4311010223',b='e6c7ef34';
    await pool.query("INSERT INTO tasks(id,title,status,task_type,payload) VALUES($1,$2,'queued','qiumi_task','{}')",[id,`drift ${id}`]);
    afterAcquire=async()=>{
      await pool.query("UPDATE tasks SET payload=jsonb_set(payload,'{device_serial}',to_jsonb($2::text)) WHERE id=$1",[id,b]);
      expect((await acquireDeviceLock(id,b,30,pool)).result).toBe('acquired');
    };
    const result=await dispatchManualQiumi({id,task_type:'qiumi_task'},pool,{
      deviceGate,
      route:async()=>{await pool.query("UPDATE tasks SET task_type='architecture_scan',payload=$2 WHERE id=$1",[id,{run_id:'test-run',qiumi_department:'test',device_serial:a}]);return {outcome:'proceed'};},
      trigger:async()=>({success:false,reason:'retired_decomposition',retiredBeforeStart:true}),
    });
    expect(result).toMatchObject({status:409,body:{execution_state:'not_started',parked:false}});
    expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[id])).rows[0].status).toBe('in_progress');
    expect((await pool.query('SELECT locked_by FROM device_locks WHERE device_name=ANY($1)',[[a,b]])).rows.map(r=>r.locked_by)).toEqual([id,id]);
  },15000);
  it.each([false,true])('只处理本次设备锁版本，重入=%s',async reenter=>{
    const id=randomUUID(),serial='ANGYVB4311010223';
    await pool.query("INSERT INTO tasks(id,title,status,task_type,payload) VALUES($1,$2,'queued','qiumi_task','{}')",[id,`retired ${id}`]);
    let newerVersion;
    const result=await dispatchManualQiumi({id,task_type:'qiumi_task'},pool,{
      deviceGate,
      route:async()=>{await pool.query("UPDATE tasks SET task_type='architecture_scan',payload=$2 WHERE id=$1",[id,{run_id:'test-run',qiumi_department:'test',device_serial:serial}]);return {outcome:'proceed'};},
      trigger:async()=>{if(reenter){const r=await acquireDeviceLock(id,serial,30,pool);expect(r.result).toBe('acquired');newerVersion=r.lock.acquisition_version;}return {success:false,reason:'retired_decomposition',retiredBeforeStart:true};},
    });
    const task=(await pool.query('SELECT status,claimed_by,blocked_reason,result FROM tasks WHERE id=$1',[id])).rows[0];
    const device=(await pool.query('SELECT locked_by,xmin::text AS version FROM device_locks WHERE device_name=$1',[serial])).rows[0];
    expect(result).toMatchObject({status:409,body:{execution_state:'not_started',parked:!reenter}});
    if(reenter){expect(task.status).toBe('in_progress');expect(task.claimed_by).toMatch(/^manual-qiumi:/);expect(device.locked_by).toBe(id);expect(device.version).toBe(newerVersion);}
    else{expect(task.status).toBe('blocked');expect(task.claimed_by).toBeNull();expect(task.blocked_reason).toBe('retired_decomposition');expect(task.result.retired_dispatch).toMatchObject({execution_state:'not_started'});expect(device.locked_by).toBeNull();}
  },15000);
});
