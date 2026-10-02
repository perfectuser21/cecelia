import { directory } from './directory.js';
import { authorize,resolveCleanup } from './store.js';
export function createTransportAuthority({pool}) {
 return async(method,input,operation)=>{
  if(!pool)throw Error('execution_directory_database_required');
  const a=(await pool.query('SELECT * FROM harness_attempts WHERE id=$1',[input?.attempt?.id])).rows[0];
  if(!a)throw Error('execution_attempt_missing');
  const machine=a.requested_machine_id??a.machine_id;
  if(input?.target?.machine!==machine||(input.target.provider!=null&&input.target.provider!==a.provider)||(input.target.account!=null&&input.target.account!==a.account_id))throw Error('execution_attempt_target_mismatch');
  const identity=a.task_bundle?.inputs?._server_execution;
  const trusted={...input,attempt:{...a,callbackSecret:input.attempt.callbackSecret},bundle:a.task_bundle,
   target:{...input.target,machine,provider:a.provider,account:a.account_id}};
  if(['prepare','start'].includes(method)){
   if(!identity?.executionVersionId||!identity?.grantId)throw Error('execution_attempt_authority_missing');
   return authorize(pool,{snapshotVersion:directory.current()?.version,machineId:machine,surface:'harness',provider:a.provider,
    account:a.account_id,repo:a.task_bundle?.inputs?.workspace_spec?.repo,...identity},auth=>operation(trusted,auth.node));
  }
  let versionId=identity?.executionVersionId;
  if(!versionId)versionId=(await pool.query(`SELECT v.id FROM execution_node_versions v JOIN execution_nodes n USING(machine_registry_id)
   WHERE n.canonical_id=$1 AND v.identity_mode='legacy-v1' AND v.revision=1`,[machine])).rows[0]?.id;
  const node=await resolveCleanup(pool,{executionVersionId:versionId,persistedAttemptIdentity:a});
  return operation(trusted,node);
 };
}
