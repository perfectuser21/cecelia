import {randomUUID} from 'node:crypto';
import {baselineTransaction} from './baseline-transaction.js';
import {directory,hashConfig} from './directory.js';
import {MACHINE_CAPACITY_LOCK_SQL} from '../orchestrator/attempt-machine-capacity.js';
import {readManagedScriptCandidates,readManagedScriptCandidateEvidence,createProfileCatalogClient,need,HASH,UUID,PROFILE,SCRIPT_MACHINE,SCRIPT_REGISTRY} from './managed-script-profile-evidence.js';
const INPUT=['expected_current_version_id','expected_config_hash','expected_worker_boot_id','expected_worker_config_digest'];
export function createManagedScriptProfileStore({pool,env=process.env,client=createProfileCatalogClient({token:env.KERNEL_FLEET_BRIDGE_TOKEN}),readCandidates=()=>readManagedScriptCandidates(env.EXECUTION_MANAGED_SCRIPT_CANDIDATES_FILE)}={}){
 async function activate(profileId,input){
  need(PROFILE.test(profileId)&&input&&Object.keys(input).sort().join(',')===[...INPUT].sort().join(',')
   &&UUID.test(input.expected_current_version_id)&&UUID.test(input.expected_worker_boot_id)
   &&HASH.test(input.expected_config_hash)&&HASH.test(input.expected_worker_config_digest),'request_invalid');
  const policy=readCandidates()[profileId];need(policy,'policy_unavailable');const policyDigest=hashConfig(policy),deadline=Date.now()+25000;
  const result=await baselineTransaction(pool,deadline,async db=>{
   // Same order as dispatch, including when its business Task is this Task.
   const task=(await db.query('SELECT id,status,result FROM tasks WHERE id=$1 FOR UPDATE',[policy.evidence_task_id])).rows[0];
   need(task,'candidate_evidence_required');
   await db.query(MACHINE_CAPACITY_LOCK_SQL,[SCRIPT_MACHINE]);
   need(hashConfig(readCandidates()[profileId])===policyDigest,'policy_changed');
   const node=(await db.query(`SELECT v.*,n.canonical_id,r.status AS machine_status FROM execution_nodes n
    JOIN execution_node_versions v ON v.id=n.current_version_id JOIN system_registry r ON r.id=n.machine_registry_id
    WHERE n.canonical_id=$1 AND r.type='machine' FOR UPDATE OF n,v FOR SHARE OF r`,[SCRIPT_MACHINE])).rows[0];
   need(node&&node.machine_registry_id===SCRIPT_REGISTRY&&node.machine_registry_id===policy.machine_registry_id
    &&node.platform==='darwin'&&node.identity_mode==='legacy-v1'&&node.worker_id===SCRIPT_MACHINE&&node.state==='active'&&node.machine_status==='active','existing_mac_required');
   need(node.id===input.expected_current_version_id&&node.config_hash===input.expected_config_hash,'version_stale');
   await readManagedScriptCandidateEvidence(db,policy,{task,lockRelease:true});
   const prior=(await db.query(`SELECT g.* FROM execution_grants g JOIN execution_node_versions v ON v.id=g.node_version_id
    WHERE v.machine_registry_id=$1 AND g.surface='managed_script' AND g.provider='script' AND g.profile_id=$2 ORDER BY g.id FOR UPDATE OF g`,[node.machine_registry_id,profileId])).rows;
   need(!prior.some(g=>g.state==='revoked'),'grant_revoked');
   const existing=prior.find(g=>g.node_version_id===node.id),provenance='mac_managed_profile/v1:'+policyDigest;
   if(existing)need(existing.state==='active'&&existing.account_id===''&&existing.repo_scope.length===0&&existing.provenance===provenance
    &&existing.evidence_task_id===policy.evidence_task_id&&new Date(existing.expires_at).toISOString()===policy.expires_at&&Date.parse(existing.expires_at)>Date.now(),'grant_conflict');
   const expected={profileId,profileSha256:policy.profile_sha256,bootId:input.expected_worker_boot_id,configDigest:input.expected_worker_config_digest};
   const first=await client.catalog(node,expected),second=await client.catalog(node,expected);
   need(first.boot_id===second.boot_id&&first.config_digest===second.config_digest&&first.profile_sha256===second.profile_sha256,'worker_changed');
   need([first,second].every(catalog=>HASH.test(catalog.signature??'')&&catalog.receipt
    &&catalog.signed_payload===JSON.stringify(catalog.receipt)),'worker_unconfirmed');
   need(hashConfig(readCandidates()[profileId])===policyDigest&&Date.parse(policy.expires_at)>Date.now(),'policy_changed');
   await readManagedScriptCandidateEvidence(db,policy,{task});
   if(existing)return {profile_id:profileId,grant_id:existing.id,execution_version_id:node.id,already_active:true};
   const grant=randomUUID();
   await db.query(`INSERT INTO execution_grants(id,node_version_id,surface,provider,account_id,repo_scope,profile_id,provenance,evidence_task_id,state,expires_at)
    VALUES($1,$2,'managed_script','script','','{}',$3,$4,$5,'active',$6)`,[grant,node.id,profileId,provenance,policy.evidence_task_id,policy.expires_at]);
   const event={actor:'brain-managed-script-profile-v1',profile_id:profileId,grant_id:grant,execution_version_id:node.id,policy_digest:policyDigest,
    source_commit:policy.source_commit,release_id:policy.release_id,observation_id:policy.observation_id,expires_at:policy.expires_at,
    worker_catalog:[first,second].map(catalog=>({receipt:catalog.receipt,signed_payload:catalog.signed_payload,signature:catalog.signature}))};
   const saved=await db.query(`UPDATE tasks SET result=jsonb_set(COALESCE(result,'{}'),'{execution_script_profile_operations}',
    COALESCE(result->'execution_script_profile_operations','[]')||$2::jsonb,true),updated_at=now() WHERE id=$1 RETURNING id`,[task.id,JSON.stringify([event])]);
   need(saved.rowCount===1,'audit_missing');
   return {profile_id:profileId,grant_id:grant,execution_version_id:node.id,already_active:false};
  });
  if(result.requires_reconciliation)return {...result,directory_refresh_confirmed:false};
  try{await directory.refresh({pool});return {...result,directory_refresh_confirmed:true};}
  catch{return {...result,directory_refresh_confirmed:false,requires_reconciliation:true};}
 }
 return {activate};
}
