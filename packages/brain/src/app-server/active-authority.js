import {digest,validateHome} from './identity.js';
import {readCanaryAuthorization} from './canary-authority.js';
export async function assertActiveAppServerAuthorization(db,auth,home,workerBootId){
 const linked=(await db.query('SELECT id FROM app_server_authorizations WHERE grant_id=$1',[auth.grantId])).rows[0];
 if(!linked)throw Error('appserver_active_authorization_mismatch');
 const a=await readCanaryAuthorization(db,linked.id),now=Date.now();
 if(a.state!=='active'||a.grant_state!=='active'||a.task_status!=='completed'||a.version_state!=='active'||a.registry_status!=='active'
  ||a.current_version_id!==a.node_version_id||a.node_version_id!==auth.executionVersionId||a.worker_id!==auth.node.worker_id
  ||a.current_worker_id!==a.worker_id||a.worker_boot_id!==workerBootId||a.platform!=='darwin'||a.identity_mode!=='legacy-v1'
  ||['scheduler','scheduler_only'].includes(a.metadata?.role)||a.metadata?.scheduler_only===true
  ||Number(new Date(a.authorization_expires_at))<=now||Number(new Date(a.grant_expires_at))<=now
  ||digest(validateHome(a.home))!==digest(validateHome(home)))throw Error('appserver_active_authorization_mismatch');
 return a;
}
