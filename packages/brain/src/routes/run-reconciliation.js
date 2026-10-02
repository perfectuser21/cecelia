import { Router } from 'express';
import defaultPool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { getRunDefinitionBinding } from '../lib/run-definition-binding.js';
import { reconcileRunEvidence } from '../lib/run-reconciliation.js';
import { sendReleaseError } from './releases.js';
/** 同一读快照联合现有账本，不从外部run字符串猜内部任务身份。 */
export async function readRunReconciliation(pool,runId){
  const client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const context=await getRunDefinitionBinding(client,runId);
    const spans=(await client.query('SELECT * FROM spans WHERE run_id=$1 ORDER BY started_at,id',[runId])).rows;
    const task_run=context?.binding.task_run_id?(await client.query('SELECT * FROM task_runs WHERE id=$1 AND run_id=$2',[context.binding.task_run_id,runId])).rows[0]||null:null;
    let initiative=null,harness_attempts=[];
    if(task_run){
      initiative=(await client.query('SELECT id FROM initiative_runs WHERE id::text=$1 AND current_task_id=$2',[runId,task_run.task_id])).rows[0]||null;
      if(initiative)harness_attempts=(await client.query('SELECT id,run_id,status FROM harness_attempts WHERE run_id=$1 ORDER BY created_at,id',[initiative.id])).rows;
    }
    const result=reconcileRunEvidence({run_id:runId,context,spans,task_run,harness_attempts});
    result.links={task_run_id:task_run?.id||null,task_id:task_run?.task_id||null,initiative_run_id:initiative?.id||null,harness_attempt_ids:harness_attempts.map(a=>a.id)};
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export function createRunReconciliationRouter({pool=defaultPool}={}){
  const router=Router();
  router.get('/:run_id/reconciliation',internalAuthOrLoopback,async(req,res)=>{
    try{res.json(await readRunReconciliation(pool,req.params.run_id));}catch(error){sendReleaseError(res,error);}
  });return router;
}
