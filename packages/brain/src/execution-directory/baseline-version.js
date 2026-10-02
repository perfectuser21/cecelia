import {randomUUID} from 'node:crypto';
import {baselineTransaction} from './baseline-transaction.js';
import {GRANT_LINEAGE_PREFIX,grantRootId} from './store.js';
import {directory,hashConfig} from './directory.js';
import {LEGACY_BINDINGS} from './legacy-policy.js';
import {createBaselineEvidenceClient} from './baseline-evidence.js';
import {evaluateBaseAdmission} from '../orchestrator/fleet-node/node-admission.js';
import {MACHINE_CAPACITY_LOCK_SQL} from '../orchestrator/attempt-machine-capacity.js';
const TASK='4378fb7f-e2a6-4148-acd6-664366933125',HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function validate(input,compensating=false){
 const keys=['expected_current_version_id','expected_config_hash','expected_worker_boot_id','expected_worker_config_digest',compensating?'restore_version_id':'supported_os_floor'];
 if(!input||keys.some(k=>typeof input[k]!=='string')||Object.keys(input).sort().join(',')!==keys.sort().join(',')||!UUID.test(input.expected_current_version_id??'')||!UUID.test(input.expected_worker_boot_id??'')
  ||!HASH.test(input.expected_config_hash??'')||!HASH.test(input.expected_worker_config_digest??'')||(compensating?!UUID.test(input.restore_version_id??''):!/^\d+\.\d+\.\d+$/.test(input.supported_os_floor??'')))throw Error('execution_baseline_request_invalid');
}
export function baselineHealthValid(report,profile){const evaluated=evaluateBaseAdmission(report,{profile,nowMs:Date.now()});return evaluated.reasons.every(r=>['node_drained','os_version_drift'].includes(r.code));}
export function createBaselineVersionStore({pool,client=createBaselineEvidenceClient(),checkHealth=baselineHealthValid,actor='brain-existing-mac-baseline-v1'}={}){
 async function mutate(machineId,input,compensating=false){
  validate(input,compensating);input={...input};const binding=machineId==='xian-mac-m4'&&LEGACY_BINDINGS.find(b=>b[0]===machineId);if(!binding)throw Error('execution_baseline_existing_mac_required');
  const deadline=Date.now()+35000;
  const bounded=async fn=>{const left=deadline-Date.now();if(left<=0)throw Error('execution_baseline_deadline');let timer;try{return await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('execution_baseline_deadline')),left);})]);}finally{clearTimeout(timer);}};
  const result=await baselineTransaction(pool,deadline,async c=>{
   await c.query(MACHINE_CAPACITY_LOCK_SQL,[machineId]);
   const node=(await c.query(`SELECT v.*,n.canonical_id,r.status AS machine_status FROM execution_nodes n JOIN execution_node_versions v ON v.id=n.current_version_id JOIN system_registry r ON r.id=n.machine_registry_id WHERE n.canonical_id=$1 FOR UPDATE OF n,v`,[machineId])).rows[0];
   if(!node||node.machine_registry_id!==binding[1]||node.platform!=='darwin'||node.identity_mode!=='legacy-v1'||node.state!=='active'||node.machine_status!=='active')throw Error('execution_baseline_existing_mac_required');
   if(node.id!==input.expected_current_version_id||node.config_hash!==input.expected_config_hash)throw Error('execution_baseline_stale');
   if(compensating){const previous=(await c.query('SELECT * FROM execution_node_versions WHERE id=$1 AND machine_registry_id=$2',[input.restore_version_id,node.machine_registry_id])).rows[0];
    const normalize=p=>({...p,version_policy:{...p.version_policy,os:null}});
    if(!previous||Number(previous.revision)>=Number(node.revision)||previous.identity_mode!=='legacy-v1'||hashConfig(previous.endpoints)!==hashConfig(node.endpoints)||hashConfig(normalize(previous.profile))!==hashConfig(normalize(node.profile)))throw Error('execution_baseline_restore_denied');
    input.supported_os_floor=previous.profile.version_policy.os;
   }
   if(node.profile.version_policy.os===input.supported_os_floor)throw Error('execution_baseline_no_change');
   const busy=(await c.query(`SELECT 1 FROM capacity_reservations WHERE machine_id=$1 AND status<>'released' UNION ALL
    SELECT 1 FROM harness_attempts WHERE COALESCE(actual_machine_id,requested_machine_id,machine_id)=$1 AND status IN ('queued','starting','running') UNION ALL
    SELECT 1 FROM harness_attempt_cleanup_outbox WHERE target_machine_id=$1 AND status<>'confirmed' UNION ALL
    SELECT 1 FROM tasks WHERE id<>$2 AND status='in_progress' AND (payload->>'machine_id'=$1 OR payload->>'machine'=$1 OR payload->'execution_target'->>'machine'=$1) LIMIT 1`,[machineId,TASK])).rowCount;
   if(busy)throw Error('execution_baseline_busy');
   const profile=structuredClone(node.profile);profile.version_policy.os=input.supported_os_floor;
   const before=await bounded(()=>client.maintenance(node));
   if(before.boot_id!==input.expected_worker_boot_id||before.config_digest!==input.expected_worker_config_digest)throw Error('execution_baseline_worker_changed');
   const current=directory.current()?.nodes.find(n=>n.id===node.id);if(!current)throw Error('execution_baseline_snapshot_unavailable');
   const health=await bounded(()=>client.health(node));if(!checkHealth(health,current.profile)||(!compensating&&health?.os?.version!==input.supported_os_floor))throw Error('execution_baseline_health_denied');
   const ready=await bounded(()=>client.maintenance(node));if(ready.boot_id!==before.boot_id||ready.config_digest!==before.config_digest)throw Error('execution_baseline_worker_changed');
   const proof=compensating?{schema_version:'forward-compensation/v1',restore_version_id:input.restore_version_id}:await bounded(()=>client.proof(node,{bootId:before.boot_id,configDigest:before.config_digest,os:input.supported_os_floor,activityRevision:ready.activity_revision}));
   const after=await bounded(()=>client.maintenance(node));if(after.boot_id!==before.boot_id||after.config_digest!==before.config_digest||after.activity_revision!==(compensating?ready.activity_revision:proof.activity_revision_after))throw Error('execution_baseline_worker_changed');
   if(Date.now()>=deadline)throw Error('execution_baseline_deadline');
   const grants=(await c.query('SELECT * FROM execution_grants WHERE node_version_id=$1 ORDER BY id FOR UPDATE',[node.id])).rows;
   const newId=randomUUID(),revision=(await c.query('SELECT max(revision)+1 AS revision FROM execution_node_versions WHERE machine_registry_id=$1',[node.machine_registry_id])).rows[0].revision;
   await c.query(`INSERT INTO execution_node_versions(id,machine_registry_id,revision,identity_mode,worker_id,worker_boot_id,platform,endpoints,profile,config_hash,state)
    VALUES($1,$2,$3,'legacy-v1',$4,$5,'darwin',$6,$7,$8,'active')`,[newId,node.machine_registry_id,revision,node.worker_id,before.boot_id,node.endpoints,profile,hashConfig({endpoints:node.endpoints,profile})]);
   const lineage=[];
   for(const g of grants){const id=randomUUID(),root=grantRootId(g);if(!UUID.test(root))throw Error('execution_baseline_lineage_invalid');
    await c.query(`INSERT INTO execution_grants(id,node_version_id,surface,provider,account_id,repo_scope,profile_id,provenance,evidence_task_id,state,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[id,newId,g.surface,g.provider,g.account_id,g.repo_scope,g.profile_id,GRANT_LINEAGE_PREFIX+root,g.evidence_task_id,g.state,g.expires_at]);
    lineage.push({source_id:g.id,clone_id:id,root_id:root,source_provenance:g.provenance});
   }
   if((await c.query('UPDATE execution_nodes SET current_version_id=$2 WHERE machine_registry_id=$1 AND current_version_id=$3',[node.machine_registry_id,newId,node.id])).rowCount!==1)throw Error('execution_baseline_stale');
   const event={actor,mode:compensating?'forward_compensation':'baseline_publish',execution_ready:false,requires_normal_admission:true,machine_id:machineId,old_version_id:node.id,new_version_id:newId,profile_diff:{'version_policy.os':{from:node.profile.version_policy.os,to:profile.version_policy.os}},grant_lineage:lineage,proof,worker_config_digest:before.config_digest,worker_boot_id:before.boot_id,at:new Date().toISOString()};
   const audit=await c.query(`UPDATE tasks SET result=jsonb_set(COALESCE(result,'{}'),'{execution_baseline_operations}',COALESCE(result->'execution_baseline_operations','[]')||$2::jsonb,true) WHERE id=$1 RETURNING id`,[TASK,JSON.stringify([event])]);
   if(audit.rowCount!==1)throw Error('execution_baseline_audit_missing');return event;
  });
  if(result.requires_reconciliation)return {...result,directory_refresh_confirmed:false};
  try{await bounded(()=>directory.refresh({pool}));return {...result,directory_refresh_confirmed:true};}
  catch{return {...result,directory_refresh_confirmed:false,requires_reconciliation:true};}
 }
 return {publish:(machineId,input)=>mutate(machineId,input),compensate:(machineId,input)=>mutate(machineId,input,true)};
}
