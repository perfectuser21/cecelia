import pg from 'pg';
import {databaseConfig,ownerKey,withWorkflowClient,assertStoredRun} from './runtime-support.mjs';
/** 取得原宿主同一把锁后才可取消；不能覆盖另一宿主或已有成功结果。 */
export async function closeoutCommander(run,reason,{url=process.env.COMMANDER_DATABASE_URL,dbosSchema=process.env.COMMANDER_DBOS_SCHEMA??'commander_workflow_dbos'}={}){
 const owner=new pg.Client(databaseConfig(url,{applicationName:`commander-closeout-${run.run_id}`}));let held=false,closing=false,lost=false;
 const revoke=()=>{lost=true;if(held&&!closing){console.error('commander_closeout_ownership_lost');process.exit(1);}};
 owner.on('error',revoke);owner.on('end',revoke);
 const verify=async()=>{if(!held||lost)throw Error('commander_closeout_ownership_lost');await owner.query('SELECT 1');if(lost)throw Error('commander_closeout_ownership_lost');};
 try{
  await owner.connect();held=(await owner.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired',[ownerKey(run.run_id)])).rows[0].acquired;
  if(!held)throw Error('commander_closeout_owner_busy');
  return await withWorkflowClient(url,dbosSchema,async client=>{
   await verify();let workflow=await assertStoredRun(client,run);
   if(workflow&&!['SUCCESS','ERROR','CANCELLED','MAX_RECOVERY_ATTEMPTS_EXCEEDED'].includes(workflow.status)){
    await verify();await client.cancelWorkflow(workflow.workflowID);workflow=await assertStoredRun(client,run);
    if(!workflow||!['SUCCESS','ERROR','CANCELLED','MAX_RECOVERY_ATTEMPTS_EXCEEDED'].includes(workflow.status))throw Error('commander_cancellation_unconfirmed');
   }
   await verify();
   const identity={task_id:run.task_id,run_id:run.run_id,definition_sha256:run.definition_sha256,runtime_revision:run.runtime_revision,workflow_id:`commander-foundation:${run.run_id}`};
   if(workflow?.status==='SUCCESS'){
    const output=workflow.output;
    if(!output||output.task_id!==run.task_id||output.run_id!==run.run_id||!['completed','needs_review','failed'].includes(output.status))throw Error('commander_terminal_result_invalid');
    return {...output,...identity};
   }
   return {...identity,status:workflow?.status==='ERROR'?'failed':'needs_review',business_pass:false,reason:workflow?.status==='ERROR'?'commander_workflow_error':reason,
    execution_unknown:true,cleanup_status:run.contract.activities.some(a=>a.runtime.phase==='finalize')?'blocked':'not_required',receipts:[],dbos_status:workflow?.status??'NOT_STARTED'};
  });
 }finally{closing=true;await owner.end().catch(()=>{});}
}
