import {transaction} from '../execution-directory/store.js';
import {MACHINE_CAPACITY_LOCK_SQL} from '../orchestrator/attempt-machine-capacity.js';
import {UUID} from './identity.js';
import {finalizeTask,afterTerminalTransition} from '../lib/task-terminal.js';
export async function authorizationJob(db,id){
 const row=(await db.query(`SELECT j.*,root.explicitly_revoked AS root_revoked FROM app_server_authorization_jobs j
  JOIN app_server_authorization_jobs root ON root.authorization_id=j.root_authorization_id WHERE j.authorization_id=$1`,[id])).rows[0];
 if(!row)throw Error('appserver_authorization_job_missing');return row;
}
export function createAuthorizationLifecycle(pool,afterTask=afterTerminalTransition){
 async function update(id,explicit){
  if(!UUID.test(id))throw Error('appserver_authorization_request_invalid');
  return transaction(pool,async db=>{
   const a=(await db.query('SELECT a.*,n.canonical_id FROM app_server_authorizations a JOIN execution_nodes n USING(machine_registry_id) WHERE a.id=$1',[id])).rows[0];
   if(!a)throw Error('appserver_authorization_missing');
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('app-server-home:'||$1,0))",[a.home.homeKey]);
   await db.query(MACHINE_CAPACITY_LOCK_SQL,[a.canonical_id]);
   const job=await authorizationJob(db,id);
   if(explicit){
    await db.query('UPDATE app_server_authorization_jobs SET explicitly_revoked=true WHERE authorization_id=$1',[job.root_authorization_id]);
    await db.query('UPDATE app_server_authorization_jobs SET next_run_at=clock_timestamp() WHERE root_authorization_id=$1',[job.root_authorization_id]);
    await db.query("UPDATE execution_grants SET state='revoked' WHERE id IN(SELECT a.grant_id FROM app_server_authorizations a JOIN app_server_authorization_jobs j ON j.authorization_id=a.id WHERE j.root_authorization_id=$1)",[job.root_authorization_id]);
    await db.query("UPDATE app_server_authorizations SET state='revoked' WHERE id IN(SELECT authorization_id FROM app_server_authorization_jobs WHERE root_authorization_id=$1)",[job.root_authorization_id]);
   }else{
    if(job.root_revoked)throw Error('appserver_authorization_explicitly_revoked');
    if(job.retired_for_renewal)return {id,state:'revoked'};
    const current=(await db.query('SELECT a.state,g.state AS grant_state FROM app_server_authorizations a JOIN execution_grants g ON g.id=a.grant_id WHERE a.id=$1',[id])).rows[0];
    if(!['prepared','active'].includes(current.state)||!['pending','active'].includes(current.grant_state))throw Error('appserver_authorization_renewal_denied');
    await db.query('UPDATE app_server_authorization_jobs SET retired_for_renewal=true WHERE authorization_id=$1',[id]);
    await db.query("UPDATE execution_grants SET state='revoked' WHERE id=$1",[a.grant_id]);
    await db.query("UPDATE app_server_authorizations SET state='revoked' WHERE id=$1",[id]);
   }
   return {id,state:'revoked'};
  });
 }
 async function settle(id){
  let completedTask;
  await transaction(pool,async db=>{
   const a=(await db.query('SELECT a.*,n.canonical_id FROM app_server_authorizations a JOIN execution_nodes n USING(machine_registry_id) WHERE a.id=$1',[id])).rows[0];
   if(!a)throw Error('appserver_authorization_missing');
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('app-server-home:'||$1,0))",[a.home.homeKey]);await db.query(MACHINE_CAPACITY_LOCK_SQL,[a.canonical_id]);
   if((await db.query('SELECT state FROM app_server_authorizations WHERE id=$1',[id])).rows[0].state!=='revoked')throw Error('appserver_authorization_cleanup_required');
   const reservations=(await db.query("SELECT id,status,confirmed_receipt FROM capacity_reservations WHERE execution_grant_id=$1 AND owner_kind='app_server'",[a.grant_id])).rows;
   if(reservations.some(r=>r.status!=='released'||!r.confirmed_receipt))throw Error('appserver_authorization_cleanup_required');
   const result={fact:'旧验收授权已退役；所有已预约实例经精确清理确认，不计为执行验收成功',actor:'brain:app-server-canary',evidence:{authorization_id:id,cleanup_confirmed:true,reservations},handoff:{schema_version:1,summary:'验收停止；内部续验另建证据，显式撤销保持停止',next_steps:[]}};
   await db.query("UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||$2::jsonb WHERE id=$1 AND status='in_progress'",[a.evidence_task_id,result]);
   const finished=await finalizeTask(db,a.evidence_task_id,'failed',{relay:false,onlyIfStatus:['in_progress'],where:{sql:"task_type='app_server_run' AND executor_kind='app-server-controller'",params:[]}});
   if(finished.rowCount)completedTask=a.evidence_task_id;
  });
  if(completedTask)await afterTask(pool,completedTask,'failed');
 }
 return {revoke:id=>update(id,true),retire:id=>update(id,false),settle};
}
