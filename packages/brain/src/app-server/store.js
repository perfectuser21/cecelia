import {finalizeTask,afterTerminalTransition} from '../lib/task-terminal.js';
import {randomUUID} from 'node:crypto';
import {directory} from '../execution-directory/directory.js';
import {authorize,resolveCleanup} from '../execution-directory/store.js';
import {MACHINE_CAPACITY_LOCK_SQL} from '../orchestrator/attempt-machine-capacity.js';
import {getNodeProfile} from '../orchestrator/fleet-node/node-profile.js';
import {validateHome,digest,generationOwner,receiptMatches,HASH,UUID} from './identity.js';
import {createGenerationTask} from './task-authority.js';
import {authorizePreparedCanary,authorizeCanaryReservation,readCanaryAuthorization} from './canary-authority.js';
import {assertActiveAppServerAuthorization} from './active-authority.js';
const SELECT=`SELECT r.*,g.home_key,g.request_key,g.generation,g.cancel_requested,h.config FROM capacity_reservations r
 JOIN app_server_generations g ON g.reservation_id=r.id JOIN app_server_homes h ON h.home_key=g.home_key WHERE r.owner_kind='app_server'`;
const WAIT=Object.freeze({outcome:'wait',reason:'capacity'});
const requireRow=row=>{if(!row)throw Error('appserver_reservation_missing');return row;};
export function createAppServerStore({pool,createTask=createGenerationTask,afterTask=afterTerminalTransition}){
 const homeLock=(db,key)=>db.query("SELECT pg_advisory_xact_lock(hashtextextended('app-server-home:' || $1,0))",[key]);
 async function tx(fn){const db=await pool.connect();try{await db.query('BEGIN');const value=await fn(db);await db.query('COMMIT');return value;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
 const get=async(id,db=pool)=>requireRow((await db.query(`${SELECT} AND r.id=$1`,[id])).rows[0]);
 async function locked(id,fn){return tx(async db=>{const initial=await get(id,db);await homeLock(db,initial.home_key);await db.query(MACHINE_CAPACITY_LOCK_SQL,[initial.machine_id]);return fn(await get(id,db),db);});}
 function snapshotValid(s,m){try{return s?.verified===true&&s.machine===m&&s.expires_at>Date.now()&&s.capacity?.ok===true&&[s.capacity.physical_base_slots,s.capacity.effective_base_slots,getNodeProfile(m).capacity].every(n=>Number.isInteger(n)&&n>0);}catch{return false;}}
 const authInput=row=>({snapshotVersion:directory.current()?.version,machineId:row.machine_id,surface:'app_server',provider:row.config.provider,
  account:row.config.account,repo:row.config.repo,profileId:row.config.profile,executionVersionId:row.execution_version_id,grantId:row.execution_grant_id});
 async function reserve({home:raw,requestKey,machineId,capacitySnapshot,capabilities},canary){
   const home=validateHome(raw);if(!UUID.test(requestKey))throw Error('appserver_request_identity_invalid');
   return tx(async db=>{await homeLock(db,home.homeKey);
    const existingHome=(await db.query('SELECT * FROM app_server_homes WHERE home_key=$1 OR home_id=$2',[home.homeKey,home.homeId])).rows[0];
    if(existingHome&&(existingHome.home_key!==home.homeKey||digest(validateHome(existingHome.config))!==digest(home)))throw Error('appserver_home_configuration_conflict');
    if(existingHome&&existingHome.machine_id!==machineId)throw Error('appserver_home_affinity');
    const previous=(await db.query(`${SELECT} AND g.home_key=$1 ORDER BY g.generation DESC`,[home.homeKey])).rows;
    const retry=previous.find(r=>r.request_key===requestKey);if(retry&&Boolean(canary)!==(retry.policy_version==='app-server-canary-v1'))throw Error('appserver_canary_request_isolated');if(retry)return {outcome:retry.status==='released'?'released':'reserved',reservation:retry};
    if(previous.some(r=>r.status!=='released'))throw Error('appserver_home_busy');
    await db.query(MACHINE_CAPACITY_LOCK_SQL,[machineId]);
    const auth=canary?await authorizePreparedCanary(db,{id:canary.id,home,machineId,capabilities}):await authorize(db,{snapshotVersion:directory.current()?.version,machineId,surface:'app_server',provider:home.provider,account:home.account,repo:home.repo,profileId:home.profile});
    if(!canary)await assertActiveAppServerAuthorization(db,auth,home,capabilities?.worker_boot_id);
    if(!snapshotValid(capacitySnapshot,machineId))return WAIT;
    if(capabilities?.machine_id!==machineId||capabilities.worker_id!==auth.node.worker_id||!UUID.test(capabilities.worker_boot_id)
      ||capabilities.profiles?.[home.profile]!==home.configDigest)throw Error('appserver_worker_configuration_mismatch');
    const occupied=(await db.query(`SELECT EXISTS(SELECT 1 FROM harness_attempts a WHERE
     (a.status IN ('queued','starting','running') AND $1 IN(a.machine_id,a.requested_machine_id,a.actual_machine_id))
     OR EXISTS(SELECT 1 FROM harness_attempt_cleanup_outbox c WHERE c.attempt_id=a.id AND c.status<>'confirmed' AND c.target_machine_id=$1)
     UNION ALL SELECT 1 FROM capacity_reservations WHERE machine_id=$1 AND status<>'released') AS occupied`,[machineId])).rows[0].occupied;
    if(occupied)return WAIT;
    const id=randomUUID(),intent=randomUUID(),generation=Number(previous[0]?.generation??0)+1;
    const made=await createTask({db,home,id});if(!made?.success||!made.task?.id)throw Error('appserver_task_create_failed');
    if(!snapshotValid(capacitySnapshot,machineId))throw Error('appserver_snapshot_expired');
    await db.query('INSERT INTO app_server_homes(home_key,home_id,machine_id,config) VALUES($1,$2,$3,$4) ON CONFLICT(home_key) DO NOTHING',[home.homeKey,home.homeId,machineId,home]);
    await db.query(`INSERT INTO capacity_reservations(id,machine_id,owner_kind,owner_key,task_id,config_digest,allocation_mode,policy_version,snapshot_time,snapshot_digest,
     launch_generation,intent_id,worker_id,worker_boot_id,execution_version_id,execution_grant_id)
     VALUES($1,$2,'app_server',$3,$4,$5,'exclusive_unclassified',$14,to_timestamp($6/1000.0),$7,$8,$9,$10,$11,$12,$13)`,
     [id,machineId,generationOwner({home_key:home.homeKey,reservation_id:id,intent_id:intent,launch_generation:generation}),made.task.id,home.configDigest,
      capacitySnapshot.captured_at,digest(capacitySnapshot),generation,intent,capabilities.worker_id,capabilities.worker_boot_id,auth.executionVersionId,auth.grantId,canary?'app-server-canary-v1':'app-server-exclusive-v1']);
    await db.query('INSERT INTO app_server_generations(reservation_id,home_key,request_key,generation) VALUES($1,$2,$3,$4)',[id,home.homeKey,requestKey,generation]);
    if(canary)await db.query('INSERT INTO app_server_canary_attempts(authorization_id,sequence_no,reservation_id) VALUES($1,$2,$3)',[canary.id,canary.sequence,id]);
    return {outcome:'reserved',reservation:await get(id,db)};
   });
  }
 async function launchAuthority(db,row,operation=a=>a){
  if(row.policy_version==='app-server-canary-v1'){const auth=await authorizeCanaryReservation(db,row);return operation(auth);}
  return authorize(db,authInput(row),async auth=>{await assertActiveAppServerAuthorization(db,auth,row.config,row.worker_boot_id);return operation(auth);});
 }
 return Object.freeze({get,reserve:input=>reserve(input),
  async reserveCanary(input){
   if(!input||Object.keys(input).some(k=>!['authorizationId','sequence','capacitySnapshot','capabilities'].includes(k))||!UUID.test(input.authorizationId)||![1,2].includes(input.sequence))throw Error('appserver_canary_request_invalid');
   const a=await readCanaryAuthorization(pool,input.authorizationId);
   return reserve({home:a.home,requestKey:input.sequence===1?a.nonce:a.id,machineId:a.canonical_id,capacitySnapshot:input.capacitySnapshot,capabilities:input.capabilities},{id:a.id,sequence:input.sequence});
  },
  async home(homeId){return (await pool.query('SELECT * FROM app_server_homes WHERE home_id=$1',[homeId])).rows[0]??null;},
  async latest(homeId){return (await pool.query(`${SELECT} AND h.home_id=$1 AND r.status<>'released' ORDER BY g.generation DESC LIMIT 1`,[homeId])).rows[0]??null;},
  async listOutstanding(){return (await pool.query(`${SELECT} AND r.status<>'released' ORDER BY r.updated_at LIMIT 100`)).rows;},
  async reserveStream(id){return locked(id,async(row,db)=>{
   if(row.status==='released'||row.cancel_requested)throw Error('appserver_launch_tombstoned');
   await launchAuthority(db,row);
   await db.query("INSERT INTO app_server_streams(id,reservation_id,prepare_deadline) VALUES($1,$2,now()+interval '5 seconds') ON CONFLICT(reservation_id) DO NOTHING",[randomUUID(),id]);
   return (await db.query('SELECT * FROM app_server_streams WHERE reservation_id=$1',[id])).rows[0];
  });},
  async withOperation(id,action,operation){
   if(!['start','inspect','cancel','prepare-stream'].includes(action))throw Error('appserver_operation_invalid');
   return locked(id,async(row,db)=>{
    if(action==='start'||action==='prepare-stream'){
     if(row.status==='released'||row.cancel_requested)throw Error('appserver_launch_tombstoned');
     return launchAuthority(db,row,async auth=>{
      if(auth.canary)row={...row,canary_authorization:auth.canary};
      if(action==='prepare-stream'){
       const stream=(await db.query('SELECT * FROM app_server_streams WHERE reservation_id=$1',[id])).rows[0];
       if(!stream||Number(new Date(stream.prepare_deadline))<=Date.now())throw Error('appserver_stream_recovery_required');
       return operation({...row,stream},auth.node.endpoints.worker,()=>launchAuthority(db,row));
      }
      return operation(row,auth.node.endpoints.worker,()=>launchAuthority(db,row));
     });
    }
    if(action==='cancel'&&!row.cancel_requested)throw Error('appserver_cancel_intent_required');
    const version=await resolveCleanup(db,{executionVersionId:row.execution_version_id,persistedAttemptIdentity:row});
    return operation(row,version.endpoints.worker);
   });
  },
  async observe(id,verified){return locked(id,async(row,db)=>{
   const r=verified?.receipt;
   if(verified?.authenticated!==true||!receiptMatches(row,r)||(!HASH.test(r.container_id)&&r.container_id!==null)
    ||(row.container_id&&row.container_id!==r.container_id))throw Error('appserver_worker_receipt_mismatch');
   if(row.status==='released')return row;
   await db.query(`UPDATE capacity_reservations SET container_id=COALESCE(container_id,$2),
    status=CASE WHEN status='cleanup_pending' THEN status WHEN $3='running' THEN 'running' ELSE 'launching' END,updated_at=now() WHERE id=$1 AND owner_kind='app_server'`,[id,r.container_id,r.status]);
   return get(id,db);
  });},
  async requestCancel(id){return locked(id,async(row,db)=>{
   if(row.status==='released')return row;
   await db.query('UPDATE app_server_generations SET cancel_requested=true WHERE reservation_id=$1',[id]);
   if(!row.cleanup_challenge)await db.query(`UPDATE capacity_reservations SET status='cleanup_pending',cleanup_claim_owner='app-server-controller',
    cleanup_claim_generation=cleanup_claim_generation+1,cleanup_challenge=$2,updated_at=now() WHERE id=$1 AND owner_kind='app_server'`,[id,randomUUID()]);
   return get(id,db);
  });},
  async confirmCleanup(id,verified){let completedTask;const settled=await locked(id,async(row,db)=>{
   const r=verified?.receipt;
   if(!row.cancel_requested||!['cleanup_pending','released'].includes(row.status)||verified?.authenticated!==true||!receiptMatches(row,r)
    ||r.status!=='cleaned'||r.absent!==true||r.tombstoned!==true||r.container_id!==row.container_id||r.challenge!==row.cleanup_challenge)throw Error('appserver_cleanup_receipt_mismatch');
   if(row.status==='released')return row;
   await db.query(`UPDATE capacity_reservations SET status='released',released_at=now(),confirmed_receipt=$2,updated_at=now() WHERE id=$1 AND owner_kind='app_server'`,[id,r]);
   const evidence={fact:'app-server同代容器已由认证Worker回执确认不存在，HOME写占位与整机预算已释放',actor:`fleet-worker:${row.worker_id}`,app_server_receipt:r,
    handoff:{schema_version:1,summary:'受管实例精确清理完成；HOME保留原机器亲和',next_steps:[]}};
   await db.query("UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||$2::jsonb WHERE id=$1 AND task_type='app_server_run' AND executor_kind='app-server-controller'",[row.task_id,evidence]);
   const finished=await finalizeTask(db,row.task_id,'completed',{relay:false,onlyIfStatus:['queued','in_progress','blocked'],
    where:{sql:"task_type='app_server_run' AND executor_kind='app-server-controller'",params:[]}});
   if(finished.rowCount)completedTask=row.task_id;
   return get(id,db);
  });if(completedTask)await afterTask(pool,completedTask,'completed');return settled;},
  async recordUnknown(id,error){await pool.query("UPDATE capacity_reservations SET last_error=$2,updated_at=now() WHERE id=$1 AND owner_kind='app_server' AND status<>'released'",[id,String(error).slice(0,160)]);},
 });
}
