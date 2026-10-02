import {derivePhoneCapacity} from './capacity.js';
import {readPhoneCapacityObservation} from './http-client.js';
import {randomUUID} from 'node:crypto';
import {directory} from '../execution-directory/directory.js';
import {authorize} from '../execution-directory/store.js';
import {MACHINE_CAPACITY_LOCK_SQL} from '../orchestrator/attempt-machine-capacity.js';
import {finalizeTask,afterTerminalTransition} from '../lib/task-terminal.js';
import {digest,validSnapshot,receiptMatches} from './identity.js';
import {exactKeys,resolvePhoneHubBinding} from './http-binding.js';
const ACTION='adb_get_state',WAIT=Object.freeze({outcome:'wait',reason:'capacity'});
const AUTH=r=>({snapshotVersion:directory.current()?.version,machineId:r.machine_id,surface:'phone_ssh',provider:'adb',account:r.account_id,profileId:ACTION,executionVersionId:r.execution_version_id,grantId:r.execution_grant_id});
const required=r=>{if(!r)throw Error('phone_dispatch_missing');return r;};
/** 仅持久身份与一次性启动许可；不负责建立 SSH、执行 ADB 或认证远端消息。 */
export function createPhoneDispatchStore({pool,afterTask=afterTerminalTransition}){
 async function tx(fn){const db=await pool.connect();try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
 const get=async(id,db=pool)=>required((await db.query('SELECT * FROM phone_dispatches WHERE id=$1',[id])).rows[0]);
 async function locked(id,fn){return tx(async db=>{
  const initial=await get(id,db);await db.query(MACHINE_CAPACITY_LOCK_SQL,[initial.machine_id]);
  await db.query('SELECT id FROM tasks WHERE id=$1 FOR NO KEY UPDATE',[initial.task_id]);
  return fn(required((await db.query('SELECT * FROM phone_dispatches WHERE id=$1 FOR UPDATE',[id])).rows[0]),db);
 });}
 async function transition(db,row,state,error=null){
  await db.query('UPDATE phone_dispatches SET state=$2,last_error=$3,updated_at=now() WHERE id=$1',[row.id,state,error]);
  await db.query("UPDATE capacity_reservations SET status=$2,last_error=$3,updated_at=now() WHERE id=$1 AND owner_kind='phone'",[row.reservation_id,state==='unknown'?'cleanup_pending':state,error]);
  return get(row.id,db);
 }
 function matchesInput(r,i){return r.machine_id===i.machineId&&r.serial===i.serial&&r.host===i.host&&r.profile===i.profileId&&r.account_id===i.account&&(i.action??ACTION)===r.action;}
 async function registry(db,i,endpoint){
  const p=(await db.query('SELECT * FROM phone_registry WHERE serial=$1 FOR SHARE',[i.serial])).rows[0];
  const accounts=p?.douyin_accounts?.filter(a=>a.current===true);
  if(!p?.enabled||p.host!==i.host||p.profile!==i.profileId||endpoint.host!==p.host||accounts?.length!==1||accounts[0].id!==i.account)throw Error('phone_registry_mismatch');
 }
 const executionConnected=row=>{if(row.transport_mode==='http')throw Error('phone_http_execution_not_connected');};
 async function reserve(i,httpMode=false){
   if(httpMode&&!exactKeys(i,['taskId','machineId','serial','host','profileId','account','capacitySnapshot'],['action','remoteIdentity']))throw Error('phone_request_invalid');
   if((i.action??ACTION)!==ACTION||![i.taskId,i.machineId,i.serial,i.host,i.profileId,i.account].every(v=>typeof v==='string'&&v.length))throw Error('phone_request_invalid');
   return tx(async db=>{
    await db.query(MACHINE_CAPACITY_LOCK_SQL,[i.machineId]);
    const task=(await db.query('SELECT * FROM tasks WHERE id=$1 FOR NO KEY UPDATE',[i.taskId])).rows[0];
    const previous=(await db.query('SELECT * FROM phone_dispatches WHERE task_id=$1',[i.taskId])).rows[0];
    if(previous&&previous.transport_mode!==(httpMode?'http':'ssh'))throw Error('phone_transport_conflict');
    if(previous&&httpMode){const original=await resolvePhoneHubBinding(db,{executionVersionId:previous.execution_version_id,machineId:previous.machine_id});readPhoneCapacityObservation(i.capacitySnapshot,original);const saved=(await db.query('SELECT snapshot_digest FROM capacity_reservations WHERE id=$1',[previous.reservation_id])).rows[0];if(saved?.snapshot_digest!==digest(i.capacitySnapshot))throw Error('phone_capacity_identity_mismatch');}
    if(previous){if(!matchesInput(previous,i))throw Error('phone_configuration_conflict');return {outcome:previous.state,dispatch:previous};}
    if(task?.task_type!=='device_job'||task?.executor_kind!=='phone-ssh-controller')throw Error('phone_task_identity_invalid');
    if(!['queued','in_progress'].includes(task?.status))throw Error('phone_task_not_dispatchable');
    let auth=await authorize(db,{snapshotVersion:directory.current()?.version,machineId:i.machineId,surface:'phone_ssh',provider:'adb',account:i.account,profileId:ACTION});
    await registry(db,i,auth.node.endpoints.phone_ssh);
    if(!httpMode&&!validSnapshot(i.capacitySnapshot,i.machineId))return WAIT;
    const binding=httpMode?await resolvePhoneHubBinding(db,{executionVersionId:auth.executionVersionId,machineId:i.machineId}):null;
    const remote=binding?{worker_id:binding.physical.worker_id,worker_boot_id:binding.physical.physical_boot_id}:i.remoteIdentity;
    if(binding&&i.remoteIdentity&&(!exactKeys(i.remoteIdentity,['worker_id','worker_boot_id'])||digest(i.remoteIdentity)!==digest(remote)))throw Error('phone_remote_identity_mismatch');
    if(![remote?.worker_id,remote?.worker_boot_id].every(v=>typeof v==='string'&&v.length))throw Error('phone_remote_identity_required');
    const occupied=(await db.query(`SELECT EXISTS(SELECT 1 FROM harness_attempts a WHERE
     (a.status IN ('queued','starting','running') AND $1 IN(a.machine_id,a.requested_machine_id,a.actual_machine_id))
     OR EXISTS(SELECT 1 FROM harness_attempt_cleanup_outbox c WHERE c.attempt_id=a.id AND c.status<>'confirmed' AND c.target_machine_id=$1)
     UNION ALL SELECT 1 FROM capacity_reservations WHERE machine_id=$1 AND status<>'released') AS occupied`,[i.machineId])).rows[0].occupied;
    // registry/occupied queries may wait: final authority and physical freshness follow them.
    let snapshot=i.capacitySnapshot;
    if(httpMode){
     auth=await authorize(db,{snapshotVersion:directory.current()?.version,machineId:i.machineId,surface:'phone_ssh',provider:'adb',account:i.account,profileId:ACTION,executionVersionId:auth.executionVersionId,grantId:auth.grantId});
     snapshot=derivePhoneCapacity(i.capacitySnapshot,binding,auth.node.profile);
     if(snapshot)snapshot.expires_at=Math.min(snapshot.expires_at,directory.current().expiresAt,auth.grant.expires_at?new Date(auth.grant.expires_at).getTime():Infinity);
    }
    if(occupied||!snapshot||!validSnapshot(snapshot,i.machineId))return WAIT;
    const id=randomUUID(),reservationId=randomUUID(),executionId=randomUUID(),lease=randomUUID();
    const config=digest({action:ACTION,task:i.taskId,serial:i.serial,phoneProfile:i.profileId,account:i.account,machine:i.machineId,executionVersion:auth.executionVersionId,grant:auth.grantId,endpoint:auth.node.endpoints.phone_ssh,...(binding?{httpBinding:binding}:{})});
    const made=(await db.query(`INSERT INTO capacity_reservations(id,machine_id,owner_kind,owner_key,task_id,config_digest,allocation_mode,policy_version,snapshot_time,snapshot_digest,
     intent_id,worker_id,worker_boot_id,execution_version_id,execution_grant_id)
     SELECT $1,$2,'phone',$3,$4,$5,'exclusive_unclassified','phone-exclusive-v1',to_timestamp($6/1000.0),$7,$8,$9,$10,$11,$12
     WHERE $13::double precision>EXTRACT(EPOCH FROM clock_timestamp())*1000 RETURNING id`,
     [reservationId,i.machineId,`phone-${id}`,i.taskId,config,snapshot.captured_at,digest(i.capacitySnapshot),executionId,remote.worker_id,remote.worker_boot_id,auth.executionVersionId,auth.grantId,snapshot.expires_at])).rows[0];
    if(!made)return WAIT;
    await db.query(`INSERT INTO phone_dispatches(id,task_id,reservation_id,serial,machine_id,host,profile,account_id,execution_version_id,execution_grant_id,lease_token,execution_id,worker_id,worker_boot_id,action,config_digest,transport_mode,http_binding)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)`,
     [id,i.taskId,reservationId,i.serial,i.machineId,i.host,i.profileId,i.account,auth.executionVersionId,auth.grantId,lease,executionId,remote.worker_id,remote.worker_boot_id,ACTION,config,httpMode?'http':'ssh',binding?JSON.stringify(binding):null]);
    await db.query("UPDATE tasks SET status='in_progress',claimed_by=$3,claimed_at=now(),payload=COALESCE(payload,'{}'::jsonb)||jsonb_build_object('phone_dispatch_id',$2::text),updated_at=now() WHERE id=$1",[i.taskId,id,`phone-dispatch:${id}`]);
    return {outcome:'reserved',dispatch:await get(id,db)};
   });
 }
 return Object.freeze({get,reserve:i=>reserve(i),
  reserveHttp(i,...extra){if(extra.length)throw Error('phone_request_invalid');return reserve(i,true);},
  async withLaunch(id,operation){
   // 先提交一次性 launch 意图；远端调用失败也不能恢复为可重启的 reserved。
   const launchEndpoint=await locked(id,async(row,db)=>{
    executionConnected(row);
    if(row.state!=='reserved')throw Error('phone_launch_forbidden');
    const auth=await authorize(db,AUTH(row));await transition(db,row,'launching');return auth.node.endpoints.phone_ssh;
   });
   try{return await locked(id,async(row,db)=>{
    if(row.state!=='launching')throw Error('phone_launch_forbidden');
    // registry SHARE 可能等待；持有后才最终核grant/快照，避免等待期间过期。
    await registry(db,{serial:row.serial,host:row.host,profileId:row.profile,account:row.account_id},launchEndpoint);
    return authorize(db,AUTH(row),auth=>operation(row,auth.node.endpoints.phone_ssh));
   });}catch(e){await locked(id,async(row,db)=>row.state==='terminal'?row:transition(db,row,'unknown',String(e.message).slice(0,500)));throw e;}
  },
  async recordUnknown(id,error){return locked(id,async(row,db)=>{
   if(row.state==='terminal')return row;return transition(db,row,'unknown',String(error).slice(0,500));
  });},
  async observe(id,verified){return locked(id,async(row,db)=>{
   executionConnected(row);
   if(!receiptMatches(row,verified)||verified.receipt.status!=='running')throw Error('phone_receipt_mismatch');
   if(row.state==='terminal'||row.state==='reserved')throw Error('phone_transition_forbidden');return transition(db,row,'running');
  });},
  async finish(id,verified){let completed;const out=await locked(id,async(row,db)=>{
   executionConnected(row);
   if(!receiptMatches(row,verified,true))throw Error('phone_receipt_mismatch');const r=verified.receipt,hash=digest(r);
   if(row.state==='reserved'&&r.status==='completed')throw Error('phone_completion_before_launch');
   if(row.state==='terminal'){if(row.terminal_digest!==hash)throw Error('phone_terminal_conflict');return row;}
   await db.query("UPDATE phone_dispatches SET state='terminal',terminal_receipt=$2::jsonb,terminal_digest=$3,terminal_status=$4,updated_at=now() WHERE id=$1",[id,JSON.stringify(r),hash,r.status]);
   await db.query("UPDATE capacity_reservations SET status='released',released_at=now(),confirmed_receipt=$2::jsonb,updated_at=now() WHERE id=$1 AND owner_kind='phone'",[row.reservation_id,JSON.stringify(r)]);
   // locked 已持有任务行锁；保留主理人或上棒写好的交接，仅缺失时补合成回执。
   const task=(await db.query('SELECT result FROM tasks WHERE id=$1',[row.task_id])).rows[0];
   const evidence={fact:'认证远端回执确认同一手机执行已退出，自己的锁已解除，共享容量已释放',actor:`phone-worker:${row.worker_id}`,phone_dispatch_receipt:r,
    ...(task?.result?.handoff==null?{handoff:{schema_version:1,summary:'手机派发持久身份结算完成',next_steps:[],synthesized:true}}:{})};
   const result=await finalizeTask(db,row.task_id,r.status,{relay:false,onlyIfStatus:'in_progress',mergeResult:evidence});
   if(result.rowCount!==1)throw Error('phone_task_settlement_conflict');completed={task:row.task_id,status:r.status};return get(id,db);
  });if(completed)await afterTask(pool,completed.task,completed.status);return out;},
 });
}
