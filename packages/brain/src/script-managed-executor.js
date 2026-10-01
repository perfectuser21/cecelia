import {createHash,randomUUID} from 'node:crypto';
import {createScriptReservationStore} from './orchestrator/script-reservation-store.js';
import {createProductionCapabilityProbes} from './orchestrator/preflight/production-probes.js';
import {createScriptWorkerClient} from './script-worker-client.js';
import {startRun,finishRun} from './lib/task-run.js';
import {recordTaskEventSafe} from './lib/task-event-log.js';
const digest=(value)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const machines=(deps)=>String((deps.env??process.env).SCRIPT_MANAGED_MACHINES??'').split(',').map(x=>x.trim());
export const usesManagedScript=(task,spec,deps={})=>Boolean(task.payload?.managed_script)||machines(deps).includes(spec.host);
function dependencies(pool,deps) {
  const env=deps.env??process.env;
  const client=deps.managed?.client??createScriptWorkerClient({env});
  const collectSnapshot=deps.managed?.collectSnapshot??(async(machine)=>{
    const probes=createProductionCapabilityProbes({env,cacheTtlMs:0});
    const capacity=await probes.getMachineBaseCapacity({machine});
    const captured_at=Date.now();
    return {verified:true,machine,captured_at,expires_at:captured_at+1000,capacity};
  });
  return {client,collectSnapshot,store:createScriptReservationStore(pool)};
}
function body(row) {
  return {reservation_id:row.id,machine_id:row.machine_id,owner_key:row.owner_key,intent_id:row.intent_id,
    launch_generation:row.launch_generation,config_digest:row.config_digest,worker_id:row.worker_id,worker_boot_id:row.worker_boot_id};
}
export async function prepareManagedScript(task,spec,pool,deps={}) {
  if(!machines(deps).includes(spec.host))return {outcome:'blocked',reason:'script_managed_not_enabled'};
  const managed=task.payload?.managed_script;
  if(!managed || typeof managed.profile!=='string' || Object.keys(managed).some(k=>k!=='profile') || spec.cwd || spec.artifact_paths.length) {
    return {outcome:'blocked',reason:'script_managed_spec_required'};
  }
  const {client,collectSnapshot,store}=dependencies(pool,deps);
  const capabilities=await client.capabilities(spec.host);
  if(!capabilities.profiles?.[managed.profile])return {outcome:'blocked',reason:'script_profile_unavailable'};
  const job={profile:managed.profile,cmd:spec.cmd,timeout_sec:spec.timeout_sec,env:spec.env};
  const attempt=(task.payload?.script_attempts?.length??0)+1;
  const ownerKey=`script-${task.id}-a${attempt}`;
  const configDigest=digest({job,profile_digest:capabilities.profiles[managed.profile]});
  const result=await store.reserve({taskId:task.id,machineId:spec.host,ownerKey,configDigest,capacitySnapshot:await collectSnapshot(spec.host)});
  if(result.outcome==='wait')return result;
  if(result.outcome==='released')return {outcome:'blocked',reason:'script_attempt_already_released'};
  await pool.query(`UPDATE tasks SET payload=payload||$2::jsonb,updated_at=NOW() WHERE id=$1 AND status IN ('queued','in_progress')`,
    [task.id,JSON.stringify({script_reservation_id:result.reservation.id,host_id:spec.host})]);
  return {...result,job,capabilities,store,client};
}
export async function triggerManagedScript(task,spec,pool,deps={}) {
  const prepared=await prepareManagedScript(task,spec,pool,deps);
  if(prepared.outcome!=='reserved')return {success:false,reason:prepared.reason??'script_capacity_wait',wait:true,configError:true};
  let row=prepared.reservation;
  const current=await pool.query(`UPDATE tasks SET status='in_progress',executor_kind='script',started_at=COALESCE(started_at,NOW()),
    payload=payload||$2::jsonb,updated_at=NOW() WHERE id=$1 AND status IN ('queued','in_progress') RETURNING id`,
  [task.id,JSON.stringify({script_run_id:row.owner_key,script_reservation_id:row.id,script_managed:true})]);
  if(!current.rowCount)return {success:false,reason:'script_task_not_dispatchable',configError:true};
  const fresh=row.status==='reserved';
  if(fresh)row=await prepared.store.markLaunching(row.id,prepared.capabilities);
  try {
    let verified=await prepared.client[fresh?'start':'inspect'](spec.host,{...body(row),...(fresh?{job:prepared.job}:{})});
    if(!fresh&&verified.receipt.status==='waiting_resources')verified=await prepared.client.start(spec.host,{...body(row),job:prepared.job});
    const result=verified.receipt;
    if(result.status==='waiting_resources'){
      await pool.query(`UPDATE tasks SET status='queued',claimed_by=NULL,claimed_at=NULL,updated_at=NOW() WHERE id=$1 AND status='in_progress'`,[task.id]);
      return {success:false,reason:'script_local_resources_wait',wait:true,configError:true};
    }
    if(result.container_id && ['launching','running'].includes(row.status))row=await prepared.store.markRunning(row.id,result);
    await startRun({taskId:task.id,runId:row.owner_key,source:'script',context:{transport:'managed-container',reservation_id:row.id}},{pool});
    await recordTaskEventSafe(pool,task.id,'script_spawned',{run_id:row.owner_key,reservation_id:row.id,transport:'managed-container'});
    return {success:true,taskId:task.id,runId:row.owner_key,executor:'script',alreadyRunning:!fresh};
  } catch(error) {
    await prepared.store.recordUnknown(row.id,error.message);
    // 远端可能已启动。留在 in_progress，由预约扫描 inspect；不返回派发失败触发重试。
    return {success:true,taskId:task.id,runId:row.owner_key,executor:'script',pending:true};
  }
}
export async function reapManagedScripts(pool,deps,settle) {
  const {client,store}=dependencies(pool,deps);
  const out={reaped:0,completed:0,failed:0,retried:0};
  for(let row of await store.listOutstanding(10)) {
    try {
      let terminal=row.confirmed_receipt?.terminal;
      if(row.status!=='released') {
        let observed;
        try {observed=(await client.inspect(row.machine_id,body(row))).receipt;}
        catch(error) {
          // 404 或 unknown 不是清理证明。只有已终态任务可主动发送 cancel 形成持久墓碑。
          if(['queued','in_progress'].includes(row.task_status))throw error;
        }
        if(observed?.container_id && !row.container_id)row=await store.markRunning(row.id,observed);
        terminal=observed?.terminal ?? (observed?.status==='exited'?observed:null);
        const task=(await pool.query('SELECT * FROM tasks WHERE id=$1',[row.task_id])).rows[0];
        if(!terminal && ['queued','in_progress'].includes(task?.status) && !observed?.timed_out)continue;
        if(!row.worker_id) {
          const identity=await client.capabilities(row.machine_id);
          row=await store.markLaunching(row.id,identity);
        }
        const claim=await store.claimCleanup(row.id,`script-reaper-${randomUUID()}`,60_000);
        if(!claim)continue;
        const verified=await client.cancel(row.machine_id,{...body(claim),container_id:claim.container_id,challenge:claim.cleanup_challenge});
        terminal=verified.receipt.terminal??terminal;
        row=await store.confirmCleanup(claim,{...verified,receipt:{...verified.receipt,terminal}});
      }
      const task=(await pool.query('SELECT * FROM tasks WHERE id=$1',[row.task_id])).rows[0];
      if(task?.status==='in_progress' && terminal) {
        await startRun({taskId:task.id,runId:row.owner_key,source:'script',context:{transport:'managed-container',reservation_id:row.id}},{pool});
        const verdict=await settle(pool,task,{exit:terminal.exit_code,timedOut:terminal.timed_out===true,
          stdout:terminal.stdout??'',stderr:terminal.stderr??'',artifacts:[`managed://${row.machine_id}/${row.container_id}`]},
        {hostId:row.machine_id,runId:row.owner_key});
        out.reaped++;if(verdict==='completed')out.completed++;else if(verdict==='retried')out.retried++;else out.failed++;
      } else if(task && !['queued','in_progress'].includes(task.status)) {
        await finishRun({runId:row.owner_key,status:'cancelled',error:'task_terminal_cleanup'},{pool});
      }
    } catch(error) {if(row.status!=='released')await store.recordUnknown(row.id,error.message);}
  }
  return out;
}
