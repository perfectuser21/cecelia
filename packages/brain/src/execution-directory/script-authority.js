import { directory,currentNode } from './directory.js';
import { authorize,resolveCleanup } from './store.js';
export function createScriptAuthority({pool}) {
 return async(machine,action,body,operation)=>{
  if(action==='capabilities'){
   const node=currentNode(machine);if(!node)throw Error('execution_node_unavailable');return operation(node.endpoints.worker,{node});
  }
  if(!pool)throw Error('execution_directory_database_required');
  const row=(await pool.query('SELECT * FROM capacity_reservations WHERE id=$1',[body.reservation_id])).rows[0];
  if(!row||row.machine_id!==machine||['owner_key','intent_id','launch_generation','config_digest'].some(k=>row[k]!==body[k]))throw Error('execution_reservation_identity_mismatch');
  if(action==='start'){
   if(!row.execution_version_id||!row.execution_grant_id)throw Error('execution_reservation_authority_missing');
   return authorize(pool,{snapshotVersion:directory.current()?.version,machineId:machine,surface:'managed_script',provider:'script',profileId:body.job?.profile,
    executionVersionId:row.execution_version_id,grantId:row.execution_grant_id},auth=>operation(auth.node.endpoints.worker,{...auth,reservation:row}));
  }
  let versionId=row.execution_version_id;
  if(!versionId)versionId=(await pool.query(`SELECT v.id FROM execution_node_versions v JOIN execution_nodes n USING(machine_registry_id) WHERE n.canonical_id=$1 AND v.identity_mode='legacy-v1' AND revision=1`,[machine])).rows[0]?.id;
  const node=await resolveCleanup(pool,{executionVersionId:versionId,persistedAttemptIdentity:row});
  const grant=node.platform==='linux'?(await pool.query('SELECT * FROM execution_grants WHERE id=$1 AND node_version_id=$2',[row.execution_grant_id,node.id])).rows[0]:undefined;
  return operation(node.endpoints.worker,{node,grant,reservation:row});
 };
}
