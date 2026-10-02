import {digest,validateHome} from './identity.js';
import {endpointValid} from '../execution-directory/directory.js';
const QUERY=`SELECT a.*,n.canonical_id,v.worker_id AS current_worker_id,v.state AS version_state,v.platform,v.identity_mode,v.endpoints,
 n.current_version_id,r.status AS registry_status,r.metadata,g.state AS grant_state,g.expires_at AS grant_expires_at,t.status AS task_status
 FROM app_server_authorizations a JOIN execution_nodes n USING(machine_registry_id)
 JOIN execution_node_versions v ON v.id=a.node_version_id JOIN system_registry r ON r.id=a.machine_registry_id
 JOIN execution_grants g ON g.id=a.grant_id JOIN tasks t ON t.id=a.evidence_task_id WHERE a.id=$1`;
export async function readCanaryAuthorization(db,id){
 const row=(await db.query(QUERY,[id])).rows[0];if(!row)throw Error('appserver_canary_authorization_denied');return row;
}
// 仅持久prepared授权与精确验收预约调用，不为普通调度增加pending通行参数。
export async function authorizePreparedCanary(db,{id,home,machineId,capabilities}){
 const a=await readCanaryAuthorization(db,id),now=Date.now();
 if(a.state!=='prepared'||a.grant_state!=='pending'||a.task_status!=='in_progress'
  ||a.current_version_id!==a.node_version_id||a.version_state!=='active'||a.registry_status!=='active'
  ||a.platform!=='darwin'||a.identity_mode!=='legacy-v1'||a.current_worker_id!==a.worker_id
  ||['scheduler','scheduler_only'].includes(a.metadata?.role)||a.metadata?.scheduler_only===true
  ||!endpointValid(a.endpoints?.worker)||a.canonical_id!==machineId||digest(validateHome(a.home))!==digest(validateHome(home))
  ||Number(new Date(a.challenge_expires_at))<=now||Number(new Date(a.authorization_expires_at))<=now||Number(new Date(a.grant_expires_at))<=now
  ||capabilities?.machine_id!==machineId||capabilities.worker_id!==a.worker_id||capabilities.worker_boot_id!==a.worker_boot_id
  ||capabilities.profiles?.[home.profile]!==home.configDigest)throw Error('appserver_canary_authorization_denied');
 return {executionVersionId:a.node_version_id,grantId:a.grant_id,node:{worker_id:a.worker_id,endpoints:a.endpoints},canary:a};
}
export async function authorizeCanaryReservation(db,row){
 const link=(await db.query('SELECT authorization_id FROM app_server_canary_attempts WHERE reservation_id=$1',[row.id])).rows[0];
 if(!link)throw Error('appserver_canary_authorization_denied');
 const auth=await authorizePreparedCanary(db,{id:link.authorization_id,home:row.config,machineId:row.machine_id,
  capabilities:{machine_id:row.machine_id,worker_id:row.worker_id,worker_boot_id:row.worker_boot_id,profiles:{[row.config.profile]:row.config_digest}}});
 if(auth.executionVersionId!==row.execution_version_id||auth.grantId!==row.execution_grant_id)throw Error('appserver_canary_authorization_denied');
 return auth;
}
