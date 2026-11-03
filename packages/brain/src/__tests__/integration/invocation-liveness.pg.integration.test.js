import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createIntakeTestDatabase} from '../fixtures/task-intake-db.js';
import {createSkillEnvelope} from '../../orchestrator/skill-activity-adapter.js';
import {definitionDigest} from '../../workflow-authoring/contracts.js';
import {startRun} from '../../lib/task-run.js';
import {reconcileInvocationLiveness} from '../../invocations/runtime.js';
it('真实隔离PG重启丢controller时只隔离匹配父run，保留旧运行账和claim供读回',async()=>{
 const f=await createIntakeTestDatabase();try{
  for(const table of ['task_runs','task_events'])await f.pool.query(`CREATE TABLE ${f.schema}.${table}(LIKE public.${table} INCLUDING ALL)`);
  const id=randomUUID(),runId=randomUUID(),input={text:'x'},schema={type:'object'},target={id:'fixed'};
  const envelope=await createSkillEnvelope({tenant_id:'t',target,input,input_sha256:definitionDigest(input),plan:{activities:[{key:'one',input_mapping:{text:'$input.text'},input_schema:schema,output_schema:schema,implementation:{kind:'skill',repo:'perfectuser21/cecelia',path:'skills/pure/SKILL.md',revision:'a'.repeat(40)}}],output_schema:schema,output_mapping:{text:'$activity.one.text'}}},{readFile:async()=> '---\nname: pure\nversion: 1.0.0\n---\n纯Skill'});
  const invocation={protocol:'invocation-request-v1',runner:'shared-activity-runner',tenant_id:'t',target,input_sha256:envelope.input_sha256,request_key:'key',envelope,dispatch:{run_id:runId}};
  await f.pool.query("INSERT INTO tasks(id,title,task_type,status,payload,claimed_by) VALUES($1,'fixed invocation','research','in_progress',$2,'original-controller')",[id,{current_run_id:runId,invocation}]);
  await startRun({taskId:id,runId,source:'skill-invocation',context:{tenant_id:'t',target,input_sha256:envelope.input_sha256,envelope_sha256:envelope.envelope_sha256}},{pool:f.pool});
  const task=(await f.pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];
  expect((await reconcileInvocationLiveness(f.pool,task)).verdict).toBe('unknown');
  const after=(await f.pool.query('SELECT status,claimed_by,blocked_detail FROM tasks WHERE id=$1',[id])).rows[0];
  expect(after).toMatchObject({status:'blocked',claimed_by:'original-controller',blocked_detail:{execution_unknown:true,recovery_mode:'readback_only'}});
  const run=(await f.pool.query('SELECT status,ended_at FROM task_runs WHERE run_id=$1',[runId])).rows[0];expect(run).toEqual({status:'running',ended_at:null});
  expect((await f.pool.query("SELECT count(*)::int n FROM task_events WHERE task_id=$1 AND event_type='invocation_runner_interrupted'",[id])).rows[0].n).toBe(1);
 }finally{await f.close();}
});
