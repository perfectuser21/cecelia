import {createAppServerStore} from './store.js';
import {createAppServerClient} from './client.js';
import {loadAppServerHomes} from './config.js';
import {createProductionCapabilityProbes} from '../orchestrator/preflight/production-probes.js';
import {UUID,validateHome} from './identity.js';
import {listComputeWorkerIds,isPrimaryWorker} from '../machine-registry.js';
const view=row=>({reservation_id:row.id,home_id:row.config.homeId,machine_id:row.machine_id,status:row.status,generation:row.launch_generation,
 cancel_requested:row.cancel_requested,task_id:row.task_id});
export function createAppServerController({pool,env=process.env,homes=loadAppServerHomes(env.CECELIA_APP_SERVER_HOMES_FILE),
 store=createAppServerStore({pool}),client=createAppServerClient({pool,store,env}),collectSnapshot}={}){
 collectSnapshot??=async machine=>{const capacity=await createProductionCapabilityProbes({env,cacheTtlMs:0}).getMachineBaseCapacity({machine});const captured_at=Date.now();return {verified:true,machine,captured_at,expires_at:captured_at+1000,capacity};};
 async function observe(id){const verified=await client.inspect(id);return store.observe(id,verified);}
 async function recover(id){
  const verified=await client.inspect(id),row=await store.observe(id,verified),r=verified.receipt;
  if(row.status==='released')return row;
  // rpc_started 后 Worker 永远拒绝同代重attach；closed 此时是稳定条件。
  // HTTP EOF、未开始RPC的closed、重启后内存无连接均不足以授权自动取消。
  if(['exited','dead'].includes(r.status)||(r.rpc_started===true&&r.stream_status==='closed'&&UUID.test(r.stream_id)))return cancel(id);
  return row;
 }
 async function cancel(id){await store.requestCancel(id);
  // 先追回可能丢失的create回执；失败仍只能按持久身份取消，Worker独立校验。
  try{await observe(id);}catch{ /* 未知仍占位；cancel的精确回执是唯一释放条件。 */ }
  const verified=await client.cancel(id);return store.confirmCleanup(id,verified);
 }
 async function guarded(id,fn){try{return await fn();}catch(error){await store.recordUnknown(id,error.message);throw error;}}
 return Object.freeze({
  async ensure(input){
   if(!input||Object.keys(input).some(k=>!['home_id','request_key'].includes(k))||!UUID.test(input.request_key))throw Error('appserver_request_invalid');
   const home=homes[input.home_id];if(!home)throw Error('appserver_home_unconfigured');validateHome(home);
   const pinned=await store.home(home.homeId);
   if(pinned){const previous=await store.latest(home.homeId);if(previous?.policy_version==='app-server-canary-v1')throw Error('appserver_canary_request_isolated');if(previous)await guarded(previous.id,()=>previous.cancel_requested?cancel(previous.id):recover(previous.id));}
   const candidates=pinned?[pinned.machine_id]:listComputeWorkerIds()
    .sort((a,b)=>Number(isPrimaryWorker(a))-Number(isPrimaryWorker(b))||a.localeCompare(b));
   let denied;
   for(const machineId of candidates){
    let reservation;
    try{const capabilities=await client.capabilities(home,machineId),capacitySnapshot=await collectSnapshot(machineId);
     const result=await store.reserve({home,requestKey:input.request_key,machineId,capacitySnapshot,capabilities});
     if(result.outcome==='wait')continue;reservation=result.reservation;
     if(result.outcome==='released')return view(reservation);
    }catch(error){
     // 仅首次未绑定时探测其他受信候选；HOME忙/已绑定/未知启动绝不改派。
     if(pinned||!['execution_grant_denied','execution_node_unavailable','appserver_worker_configuration_mismatch','appserver_worker_http_503','appserver_worker_unavailable'].includes(error.message))throw error;
     denied=error;continue;
    }
    return guarded(reservation.id,async()=>view(await store.observe(reservation.id,await client.start(reservation.id))));
   }
   if(denied)throw denied;return {status:'waiting_resources'};
  },
  async prepareStream(id){if(!UUID.test(id))throw Error('appserver_request_invalid');if((await store.get(id)).policy_version==='app-server-canary-v1')throw Error('appserver_canary_stream_internal');return guarded(id,()=>client.prepareStream(id));},
  async inspect(id){if(!UUID.test(id))throw Error('appserver_request_invalid');const row=await store.get(id);if(row.status==='released')return view(row);return guarded(id,async()=>view(await observe(id)));},
  async cancel(id){if(!UUID.test(id))throw Error('appserver_request_invalid');const row=await store.get(id);if(row.status==='released')return view(row);return guarded(id,async()=>view(await cancel(id)));},
  async reconcile(){const rows=await store.listOutstanding();const outcomes=[];
   for(const row of rows.slice(0,5)){try{outcomes.push(view(await guarded(row.id,()=>row.cancel_requested?cancel(row.id):recover(row.id))));}
    catch{outcomes.push({...view(row),status:'unconfirmed'});}}
   return outcomes;
  },
 });
}

const reconciling=new WeakSet();
export async function reconcileAppServers(pool){
 if(reconciling.has(pool))return {status:'busy'};
 reconciling.add(pool);try{return await createAppServerController({pool,homes:{}}).reconcile();}finally{reconciling.delete(pool);}
}
