/** 独立 Skill 的登记入口：复用既有固定起跑事务，不派发模型或业务。 */
import {UUID,evidenceHash,evidenceObject,evidenceText,getRelease,requireEvidence} from './release-index.js';
import {startRun} from './task-run.js';
const SHA=/^[a-f0-9]{40}$/,HASH=/^[a-f0-9]{64}$/;
const definitionFields=['release_id','observation_id','workflow_id','workflow_definition_version_id','snapshot_sha256','runtime_snapshot_sha256','expected_path','attempt_key','actor'];
const conflict=(ok,message)=>requireEvidence(ok,message,'SKILL_START_AUTHORITY',409);
function skillValid(skill){
 return skill&&typeof skill==='object'&&!Array.isArray(skill)&&Object.keys(skill).every(k=>['name','version','source_commit','path','sha256'].includes(k))&&typeof skill.name==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name||'')
  &&typeof skill.version==='string'&&skill.version.trim()&&typeof skill.source_commit==='string'&&SHA.test(skill.source_commit)&&typeof skill.sha256==='string'&&HASH.test(skill.sha256)
  &&typeof skill.path==='string'&&skill.path.split('/').every(v=>/^[A-Za-z0-9_.-]+$/.test(v)&&v!=='.'&&v!=='..');
}
export async function startStandaloneSkillRun(pool,runId,input){
 evidenceText(runId,'run_id');evidenceObject(input,['task_id','claimer','claimed_at','definition']);
 evidenceText(input.task_id,'task_id',UUID);evidenceText(input.claimer,'claimer');evidenceText(input.claimed_at,'claimed_at');
 evidenceObject(input.definition,definitionFields);const definition=input.definition;
 evidenceText(definition.runtime_snapshot_sha256,'runtime_snapshot_sha256',HASH);
 conflict(input.claimer!=='common-runner'&&definition.actor===input.claimer,'独立Skill必须使用真实执行者');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const task=(await client.query('SELECT id,status,payload,claimed_by,claimed_at FROM tasks WHERE id=$1 FOR UPDATE',[input.task_id])).rows[0];
  conflict(task?.status==='in_progress'&&task.claimed_at&&task.claimed_by===input.claimer&&Number.isFinite(Date.parse(input.claimed_at))
   &&new Date(task.claimed_at).toISOString()===new Date(input.claimed_at).toISOString(),'任务持有者或claim已变化');
  const scope=task.payload?.scope;
  conflict(task.payload?.execution_mode==='standalone-skill'&&skillValid(task.payload.skill)&&scope&&typeof scope==='object'&&!Array.isArray(scope)
   &&(scope.task_id===undefined||scope.task_id===task.id),'任务不是完整的独立Skill授权');
  const release=await getRelease(client,definition.release_id);
  const workflow=release.payload.workflows.find(w=>w.id===definition.workflow_definition_version_id&&w.workflow_id===definition.workflow_id);
  conflict(workflow&&scope.workflow_key===workflow.payload.key&&scope.source_commit===workflow.source_commit,'任务范围与固定Workflow来源不符');
  const other=(await client.query('SELECT run_id FROM task_runs WHERE task_id=$1 AND run_id<>$2 AND ended_at IS NULL FOR UPDATE',[task.id,runId])).rows;
  conflict(other.length===0,'任务已有未结束执行，不能另起一轮');
  const current=(await client.query('SELECT task_id,status,ended_at,context FROM task_runs WHERE run_id=$1 FOR UPDATE',[runId])).rows[0];
  conflict(!current||current.task_id===task.id&&current.status==='running'&&current.ended_at===null,'已结束执行不能重新起跑');
  const context={executor_kind:'codex-exec-v1',executor:input.claimer,claimed_at:new Date(task.claimed_at).toISOString(),skill:task.payload.skill,scope};
  conflict(!current||current.context?.source==='standalone-skill'&&Object.entries(context).every(([key,value])=>current.context[key]!==undefined&&evidenceHash(current.context[key])===evidenceHash(value)),'已有run的执行者、Skill或范围不同');
  const run=await startRun({taskId:task.id,runId,source:'standalone-skill',context,definition},{pool,transactionClient:client});
  await client.query('COMMIT');
  return {created:run.created,task_run_id:run.id,run_id:run.run_id,binding:run.binding};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
