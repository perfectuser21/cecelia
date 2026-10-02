import {createHmac,timingSafeEqual} from 'node:crypto';
import {transaction} from '../execution-directory/store.js';
import {MACHINE_CAPACITY_LOCK_SQL} from '../orchestrator/attempt-machine-capacity.js';
import {finalizeTask,afterTerminalTransition} from '../lib/task-terminal.js';
import {authorizeCanaryReservation,authorizePreparedCanary,readCanaryAuthorization} from './canary-authority.js';
import {receiptMatches,HASH,UUID} from './identity.js';
const METHODS=['initialize','model/list','config/read','configRequirements/read'];
function verify(row,auth,stream,envelope,token){
 const raw=envelope?.receipt_json??JSON.stringify(envelope?.receipt??null);
 let r;try{r=JSON.parse(raw);}catch{throw Error('appserver_canary_evidence_invalid');}const e=r?.canary_evidence;
 if(typeof token!=='string'||token.length<32||!HASH.test(envelope?.signature??'')
  ||!timingSafeEqual(Buffer.from(envelope.signature),Buffer.from(createHmac('sha256',token).update(raw).digest('hex')))
  ||!receiptMatches(row,r)||!HASH.test(r.container_id)||r.container_id!==row.container_id||!UUID.test(r.request_nonce)
  ||r.rpc_started!==true||r.stream_status!=='closed'||r.stream_id!==stream?.id
  ||e?.authorization_id!==auth.id||e.nonce!==auth.nonce||e.stream_id!==stream.id||e.expires_at!==Number(new Date(auth.challenge_expires_at))
  ||e.complete!==true||e.sealed!==true||e.rejected!==0||e.failed!==0||!Array.isArray(e.methods)||e.methods.length!==4
  ||METHODS.some((method,i)=>e.methods[i]?.method!==method||!HASH.test(e.methods[i]?.result_digest??'')))throw Error('appserver_canary_evidence_invalid');
}
export function createCanaryEvidenceStore({pool,store,client,token,afterTask=afterTerminalTransition}){
 async function lock(db,a){await db.query("SELECT pg_advisory_xact_lock(hashtextextended('app-server-home:'||$1,0))",[a.home.homeKey]);await db.query(MACHINE_CAPACITY_LOCK_SQL,[a.canonical_id]);}
 const stream=(db,id)=>db.query('SELECT * FROM app_server_streams WHERE reservation_id=$1',[id]).then(r=>r.rows[0]);
 return Object.freeze({
  async record(id,envelope){
   return transaction(pool,async db=>{
    const initial=await store.get(id,db),link=(await db.query('SELECT authorization_id FROM app_server_canary_attempts WHERE reservation_id=$1',[id])).rows[0];
    if(!link)throw Error('appserver_canary_evidence_invalid');
    const a=await readCanaryAuthorization(db,link.authorization_id);await lock(db,a);
    const row=await store.get(initial.id,db);await authorizeCanaryReservation(db,row);
    verify(row,a,await stream(db,id),envelope,token);
    await db.query('INSERT INTO app_server_canary_evidence(reservation_id,envelope) VALUES($1,$2) ON CONFLICT(reservation_id) DO NOTHING',[id,{receipt_json:JSON.stringify(envelope.receipt),signature:envelope.signature}]);
    return {reservation_id:id,recorded:true};
   });
  },
  async activate(id){
   if(!UUID.test(id))throw Error('appserver_authorization_request_invalid');
   const initial=await readCanaryAuthorization(pool,id),caps=await client.probeCapabilities(initial.machine_registry_id,initial.node_version_id);let completed=false;
   const result=await transaction(pool,async db=>{
    await lock(db,initial);const a=await readCanaryAuthorization(db,id);
    if(a.state==='active'&&a.grant_state==='active'&&a.current_version_id===a.node_version_id&&a.version_state==='active'&&a.registry_status==='active'
     &&Number(new Date(a.authorization_expires_at))>Date.now()&&caps.worker_boot_id===a.worker_boot_id&&caps.worker_id===a.worker_id
     &&caps.machine_id===a.canonical_id&&caps.profiles?.[a.home.profile]===a.home.configDigest)return {id,state:'active'};
    await authorizePreparedCanary(db,{id,home:a.home,machineId:a.canonical_id,capabilities:caps});
    const attempts=(await db.query('SELECT m.*,e.envelope FROM app_server_canary_attempts m LEFT JOIN app_server_canary_evidence e USING(reservation_id) WHERE m.authorization_id=$1 ORDER BY m.sequence_no',[id])).rows;
    if(attempts.length!==2||attempts[0].sequence_no!==1||attempts[1].sequence_no!==2)throw Error('appserver_canary_evidence_incomplete');
    const generations=[];
    for(const attempt of attempts){
     const row=await store.get(attempt.reservation_id,db),cleanup=row.confirmed_receipt;
     if(row.status!=='released'||!attempt.envelope||!row.cancel_requested||!receiptMatches(row,cleanup)||cleanup?.status!=='cleaned'
      ||cleanup.absent!==true||cleanup.tombstoned!==true||cleanup.challenge!==row.cleanup_challenge||cleanup.container_id!==row.container_id)throw Error('appserver_canary_evidence_incomplete');
     verify(row,a,await stream(db,row.id),attempt.envelope,token);
     generations.push({reservation_id:row.id,container_id:row.container_id,envelope:attempt.envelope,cleanup_receipt:cleanup});
    }
    const evidence={nonce:a.nonce,worker_boot_id:a.worker_boot_id,config_digest:a.home.configDigest,cleanup_confirmed:true,generations};
    await db.query("UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||$2::jsonb WHERE id=$1",[a.evidence_task_id,{fact:'两代聊天实例完成受限协议验收，签名证据封存并精确清理；开放限期执行许可',evidence,actor:'brain:app-server-canary',handoff:{schema_version:1,summary:'受信HOME与同代Worker验收通过，许可24小时内有效',next_steps:[]}}]);
    const final=await finalizeTask(db,a.evidence_task_id,'completed',{relay:false,onlyIfStatus:['in_progress'],where:{sql:"task_type='app_server_run' AND executor_kind='app-server-controller'",params:[]}});
    if(!final.rowCount)throw Error('appserver_canary_task_transition_failed');
    await db.query("UPDATE app_server_authorizations SET state='accepted',evidence=$2,accepted_at=clock_timestamp() WHERE id=$1",[id,evidence]);
    await db.query("UPDATE execution_grants SET state='active' WHERE id=$1",[a.grant_id]);
    await db.query("UPDATE app_server_authorizations SET state='active',activated_at=clock_timestamp() WHERE id=$1",[id]);
    completed=true;return {id,state:'active'};
   });
   if(completed)await afterTask(pool,initial.evidence_task_id,'completed');return result;
  },
 });
}
