import {randomUUID} from 'node:crypto';
import {transaction} from '../execution-directory/store.js';
import {MACHINE_CAPACITY_LOCK_SQL} from '../orchestrator/attempt-machine-capacity.js';
import {validateHome,digest,UUID} from './identity.js';
import {createGenerationTask} from './task-authority.js';
const NODE=`SELECT v.*,n.canonical_id,r.status AS registry_status,r.metadata FROM execution_nodes n
 JOIN execution_node_versions v ON v.id=n.current_version_id JOIN system_registry r ON r.id=n.machine_registry_id
 WHERE n.machine_registry_id=$1 AND r.type='machine'`;
export function createAuthorizationStore({pool,homes,client,createTask=createGenerationTask}){
 const homeLock=(db,key)=>db.query("SELECT pg_advisory_xact_lock(hashtextextended('app-server-home:'||$1,0))",[key]);
 async function node(db,machine,expected){
  const row=(await db.query(NODE,[machine])).rows[0];
  if(!row||row.id!==expected||row.state!=='active'||row.registry_status!=='active'||row.platform!=='darwin'||row.identity_mode!=='legacy-v1'
   ||['scheduler','scheduler_only'].includes(row.metadata?.role)||row.metadata?.scheduler_only===true)throw Error('appserver_authorization_node_unavailable');
  return row;
 }
 return Object.freeze({
  async prepare(input){
   if(!input||Object.keys(input).some(k=>!['home_id','machine_registry_id','expected_version_id'].includes(k))||!UUID.test(input.machine_registry_id)||!UUID.test(input.expected_version_id))throw Error('appserver_authorization_request_invalid');
   const home=validateHome(homes[input.home_id]);
   const before=await node(pool,input.machine_registry_id,input.expected_version_id);
   const caps=await client.probeCapabilities(input.machine_registry_id,input.expected_version_id);
   if(caps.machine_id!==before.canonical_id||caps.worker_id!==before.worker_id||!UUID.test(caps.worker_boot_id)||caps.profiles?.[home.profile]!==home.configDigest)throw Error('appserver_worker_configuration_mismatch');
   return transaction(pool,async db=>{
    await homeLock(db,home.homeKey);await db.query(MACHINE_CAPACITY_LOCK_SQL,[before.canonical_id]);
    const current=await node(db,input.machine_registry_id,input.expected_version_id);
    const previous=(await db.query("SELECT * FROM app_server_authorizations WHERE home->>'homeKey'=$1 AND state<>'revoked' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[home.homeKey])).rows[0];
    if(previous){
     if(digest(validateHome(previous.home))!==digest(home)||previous.node_version_id!==current.id||previous.worker_boot_id!==caps.worker_boot_id
      ||Number(new Date(previous.authorization_expires_at))<=Date.now()
      ||previous.state==='prepared'&&Number(new Date(previous.challenge_expires_at))<=Date.now())throw Error('appserver_authorization_stale');
     return previous;
    }
    const id=randomUUID(),grantId=randomUUID(),nonce=randomUUID();
    const created=await createTask({db,home,id,purpose:'authorization'});
    if(!created?.success||!created.task?.id)throw Error('appserver_authorization_task_failed');
    await db.query(`INSERT INTO app_server_authorizations(id,machine_registry_id,node_version_id,grant_id,evidence_task_id,home,worker_id,worker_boot_id,nonce,challenge_expires_at,authorization_expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,statement_timestamp()+interval '10 minutes',statement_timestamp()+interval '24 hours')`,
    [id,input.machine_registry_id,current.id,grantId,created.task.id,home,current.worker_id,caps.worker_boot_id,nonce]);
    await db.query(`INSERT INTO execution_grants(id,node_version_id,surface,provider,account_id,repo_scope,profile_id,provenance,evidence_task_id,state,expires_at)
     SELECT grant_id,node_version_id,'app_server',home->>'provider',home->>'account',ARRAY[home->>'repo'],home->>'profile','app_server_canary',evidence_task_id,'pending',authorization_expires_at FROM app_server_authorizations WHERE id=$1`,[id]);
    return (await db.query('SELECT * FROM app_server_authorizations WHERE id=$1',[id])).rows[0];
   });
  },
  async revoke(id){
   if(!UUID.test(id))throw Error('appserver_authorization_request_invalid');
   return transaction(pool,async db=>{
    const row=(await db.query('SELECT a.*,n.canonical_id FROM app_server_authorizations a JOIN execution_nodes n USING(machine_registry_id) WHERE a.id=$1',[id])).rows[0];
    if(!row)throw Error('appserver_authorization_missing');
    await homeLock(db,row.home.homeKey);await db.query(MACHINE_CAPACITY_LOCK_SQL,[row.canonical_id]);
    await db.query("UPDATE execution_grants SET state='revoked' WHERE id=$1",[row.grant_id]);
    await db.query("UPDATE app_server_authorizations SET state='revoked' WHERE id=$1",[id]);
    return {id,state:'revoked'};
   });
  },
 });
}
