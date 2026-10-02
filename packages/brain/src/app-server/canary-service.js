import {createAppServerStore} from './store.js';
import {createAppServerClient} from './client.js';
import {createAuthorizationStore} from './authorization-store.js';
import {createCanaryEvidenceStore} from './canary-evidence.js';
import {readCanaryAuthorization} from './canary-authority.js';
import {runCanaryProtocol} from './canary-protocol.js';
import {loadAppServerHomes} from './config.js';
import {UUID} from './identity.js';
import {createProductionCapabilityProbes} from '../orchestrator/preflight/production-probes.js';
// 流票仅驻留内部调用栈。恢复只读持久预约/Worker签名，不重放已经开始的RPC。
export function createAppServerCanaryService({pool,env=process.env,homes=loadAppServerHomes(env.CECELIA_APP_SERVER_HOMES_FILE),
 store=createAppServerStore({pool}),client=createAppServerClient({pool,store,env}),
 authorizationStore=createAuthorizationStore({pool,homes,client}),
 evidence=createCanaryEvidenceStore({pool,store,client,token:env.KERNEL_FLEET_BRIDGE_TOKEN}),
 collectSnapshot,protocol=runCanaryProtocol,pollMs=100,pollTimeoutMs=25000}={}){
 collectSnapshot??=async machine=>{const capacity=await createProductionCapabilityProbes({env,cacheTtlMs:0}).getMachineBaseCapacity({machine});const captured_at=Date.now();return {verified:true,machine,captured_at,expires_at:captured_at+1000,capacity};};
 async function observed(id){const verified=await client.inspect(id);await store.observe(id,verified);return verified;}
 async function cleanup(id){
  const row=await store.requestCancel(id);if(row.status==='released')return row;
  try{await observed(id);}catch{/* 只有精确cancel墓碑可释放；inspect失败不能证明容器消失。 */}
  return store.confirmCleanup(id,await client.cancel(id));
 }
 async function sealed(id){
  const deadline=Date.now()+Math.min(25000,pollTimeoutMs);
  for(;;){const verified=await observed(id),r=verified.receipt;
   if(r.canary_evidence?.sealed===true&&r.stream_status==='closed')return verified;
   if(Date.now()>=deadline)throw Error('appserver_canary_evidence_unconfirmed');
   await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
 }
 async function advanceLocked(id){
  const a=await readCanaryAuthorization(pool,id);
  if(a.state==='active')return evidence.activate(id);
  if(a.state==='revoked'||Number(new Date(a.challenge_expires_at))<=Date.now()){
   const rows=(await pool.query('SELECT reservation_id FROM app_server_canary_attempts WHERE authorization_id=$1 ORDER BY sequence_no',[id])).rows;
   for(const row of rows)await cleanup(row.reservation_id);
   return {id,state:a.state==='revoked'?'revoked':'expired'};
  }
  for(const sequence of [1,2]){
   let current;
   try{
    const linked=(await pool.query('SELECT m.reservation_id,e.reservation_id AS evidence_id FROM app_server_canary_attempts m LEFT JOIN app_server_canary_evidence e USING(reservation_id) WHERE m.authorization_id=$1 AND m.sequence_no=$2',[id,sequence])).rows[0];
    if(linked)current=await store.get(linked.reservation_id);
    else{
     const capabilities=await client.probeCapabilities(a.machine_registry_id,a.node_version_id),capacitySnapshot=await collectSnapshot(a.canonical_id);
     const reserved=await store.reserveCanary({authorizationId:id,sequence,capabilities,capacitySnapshot});
     if(reserved.outcome==='wait')return {id,state:'waiting_resources'};current=reserved.reservation;
    }
    if(current.status==='released'){if(linked?.evidence_id)continue;return {id,state:'failed'};}
    if(linked?.evidence_id){await cleanup(current.id);continue;}
    if(current.cancel_requested){await cleanup(current.id);return {id,state:'failed'};}
    // start同一持久身份幂等；失回执后的重试不得分配新意图或新容器。
    let verified=await client.start(current.id);await store.observe(current.id,verified);
    if(verified.receipt.status==='waiting_resources')return {id,state:'waiting_resources'};
    if(verified.receipt.rpc_started!==true){
     if(verified.receipt.status!=='running')throw Error('appserver_canary_launch_unconfirmed');
     const ticket=await client.prepareStream(current.id);
     try{await protocol(ticket);}catch{/* HTTP终结不足以决定验收；继续读取Worker封存签名。 */}
    }
    verified=await sealed(current.id);
    if(verified.receipt.canary_evidence.complete!==true){await cleanup(current.id);return {id,state:'failed'};}
    await evidence.record(current.id,verified);
    await cleanup(current.id);
   }catch(error){if(current)await store.recordUnknown(current.id,/^appserver_[a-z_0-9]+$/.test(error.message)?error.message:'appserver_canary_unconfirmed');throw error;}
  }
  return evidence.activate(id);
 }
 return Object.freeze({
  prepare:input=>authorizationStore.prepare(input),
  async advance(id){
   if(!UUID.test(id))throw Error('appserver_authorization_request_invalid');
   const db=await pool.connect(),key='app-server-canary:'+id;let locked=false;
   try{
    locked=(await db.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[key])).rows[0].locked;
    if(!locked)return {id,state:'busy'};
    return await advanceLocked(id);
   }finally{if(locked)await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);db.release();}
  },
 });
}
