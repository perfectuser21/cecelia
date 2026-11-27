import {expect} from 'vitest';
import {recoverPausedFoundationTasks} from '../../workflow-foundation/claim.js';
import {buildPauseLowPriorityQuery} from '../../alertness/escalation.js';
import {TICK_DISPATCH_EXCLUDED,ESCALATION_EXEMPT_TASK_TYPES} from '../../lib/task-type-registry.js';

export async function verifyFoundationPausedRecovery(fixture){
 const {registration,release}=await fixture.publish();
 const submit=async(key)=>(await fixture.request('/workflow-foundation/tasks',{
  workflow_id:registration.workflow_id,release_id:release.id,input:{label:key},idempotency_key:key
 })).body.task.id;
 const taskId=await submit('recover-original'),manual=await submit('operator-paused'),running=await submit('already-claimed');
 const originalJob=(await fixture.request('/workflow-foundation/claim',{machine_id:'fixture-host',task_id:running})).body.job;
 expect(originalJob.run_id).toBeTruthy();
 await fixture.pool.query("UPDATE tasks SET status='paused',error_message='operator_pause' WHERE id=$1",[manual]);
 const original=(await fixture.pool.query('SELECT payload FROM tasks WHERE id=$1',[taskId])).rows[0].payload;
 expect((await fixture.pool.query(buildPauseLowPriorityQuery(),[['P0','P1','P2','P3'],['api'],'escalation_graceful_degrade',[...ESCALATION_EXEMPT_TASK_TYPES],[...TICK_DISPATCH_EXCLUDED]])).rows).toEqual([]);
 // 历史版本曾暂停这类非tick工单；继续验相同历史记录的精准恢复，不伪造新selector的归属表。
 await fixture.pool.query(`UPDATE tasks SET status='paused',error_message='escalation_graceful_degrade',
  status_history=status_history||jsonb_build_array(jsonb_build_object(
   'from','queued','to','paused','changed_at',NOW(),'source','escalation_graceful_degrade')) WHERE id=$1`,[taskId]);
 const claim=()=>fixture.request('/workflow-foundation/claim',{machine_id:'fixture-host',task_id:taskId});
 expect((await claim()).body).toEqual({job:null});
 expect(await recoverPausedFoundationTasks(fixture.pool,'graceful_degrade')).toBe(0);
 const repeats=await Promise.all([
  recoverPausedFoundationTasks(fixture.pool,'auto_recovery'),
  recoverPausedFoundationTasks(fixture.pool,'auto_recovery')
 ]);
 expect(repeats.sort()).toEqual([0,1]);
 const rows=(await fixture.pool.query('SELECT id,status,payload,result,status_history FROM tasks WHERE id=ANY($1::uuid[])',[[taskId,manual,running]])).rows;
 const byId=Object.fromEntries(rows.map(row=>[row.id,row]));
 expect(byId[taskId]).toMatchObject({status:'queued',payload:original});
 expect(byId[taskId].status_history.at(-1)).toMatchObject({from:'paused',to:'queued',source:'foundation_preclaim_recovery'});
 expect(byId[manual].status).toBe('paused');
 expect(byId[running]).toMatchObject({status:'in_progress',result:{foundation_runner:{run_id:originalJob.run_id}}});
 const [a,b]=await Promise.all([claim(),claim()]);
 expect(a.body.job.definition.release_id).toBe(release.id);
 expect(a.body.job.task_id).toBe(taskId);
 expect(b.body.job.run_id).toBe(a.body.job.run_id);
 expect((await fixture.pool.query('SELECT run_id FROM task_runs WHERE task_id=$1',[taskId])).rows).toEqual([{run_id:a.body.job.run_id}]);
}
