import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {authoringExecutionDatabase,startPureAuthoring,settleInvocation} from '../fixtures/authoring-execution-db.test.js';
import {runWorkflowAssemblyReconcile} from '../../lib/workflow-assembly-reconcile.js';
import {JOBS,runSchedulerJobsOnce} from '../../scheduler-jobs.js';
import {readAuthoringReadiness} from '../../workflow-authoring/execution-proof.js';
import {invocationTaskPrompt} from '../../invocations/runtime.js';
it('默认scheduler真实复验链：固定Git候选破坏后自动修复并生成新运行才关闭',async()=>{
 const f=await authoringExecutionDatabase(),dir=mkdtempSync(join(tmpdir(),'assembly-reconcile-fixed-'));
 const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  for(const table of ['working_memory','resource_health','release_versions','ops_schedule_entries'])await f.pool.query(`CREATE TABLE IF NOT EXISTS ${f.schema}.${table}(LIKE public.${table} INCLUDING ALL)`);
  mkdirSync(join(dir,'skills/pure'),{recursive:true});mkdirSync(join(dir,'contracts'));
  writeFileSync(join(dir,'skills/pure/SKILL.md'),f.content);
  writeFileSync(join(dir,'contracts/pure.json'),JSON.stringify(Object.fromEntries(Object.entries(f.definition).filter(([key])=>key!=='source'))));
  git(['init','-b','cp-reconcile-fixture']);git(['config','user.name','Reconcile fixture']);git(['config','user.email','fixture@example.invalid']);git(['add','.']);git(['commit','-m','test: fixed source for automatic revalidation']);
  f.definition.source.revision=git(['rev-parse','HEAD']);f.reader=source=>git(['show',`${source.revision}:${source.path}`]);
  const run=await startPureAuthoring(f),adapters={readFile:f.reader,probeRuntime:async()=>({ready:true})};
  const job=JOBS.find(j=>j.name==='workflow-assembly-reconcile');expect(job).toBeTruthy();
  // 仅固定Git/资源适配来自隔离fixture，真实driver/readiness/路由/证明函数均不注入。
  const tick=()=>runSchedulerJobsOnce(f.pool,[{...job,handler:pool=>runWorkflowAssemblyReconcile(pool,{budgetMs:20000,limit:5,authoringOptions:{...adapters,freezeOptions:{readFile:f.reader},invocationOptions:adapters}})}]);
  const executionIds=[];
  const {executeCodex}=createRequire(import.meta.url)('../../../scripts/codex-bridge/codex-bridge.cjs');
  const actual=process.env.AUTHORING_RECONCILE_REAL_CODEX==='1'?async(task,runId)=>{
    const result=await executeCodex(process.env.CODEX_HOME,invocationTaskPrompt(task,runId),{workDir:dir,sandbox:'read-only',timeoutMs:180000});
    return result.output;
  }:undefined;
  const finishPending=async()=>{
    const pending=(await f.pool.query("SELECT id FROM tasks WHERE payload?'invocation' AND status='queued' ORDER BY created_at,id")).rows;
    for(const item of pending)executionIds.push({task_id:item.id,run_id:await settleInvocation(f,item.id,actual)});
    return pending.length;
  };
  for(let n=0;n<4;n++){await finishPending();await tick();}
  let row=(await f.pool.query('SELECT * FROM tasks WHERE id=$1',[run.id])).rows[0];
  let readiness=await readAuthoringReadiness(f.pool,run.id,adapters);writeFileSync('/tmp/workflow-assembly-6-initial-state.json',JSON.stringify({readiness,result:row.result},null,2));expect(readiness.qualified,JSON.stringify(readiness.gaps)).toBe(true);
  const beforeProof=readiness.proof_sha256,beforeRuns=readiness.evidence.runs,owner=row.result.workflow_authoring_candidate;
  const fixed=(await f.pool.query('SELECT payload FROM workflow_definition_versions WHERE id=$1',[owner.workflow_definition_version_id])).rows[0].payload;
  const ref=fixed.activities[0].reference_id;
  await f.pool.query("UPDATE tasks SET status='completed' WHERE id=$1",[run.id]);
  await f.pool.query('DELETE FROM workflow_activity_refs WHERE id=$1',[ref]);
  await f.pool.query('DELETE FROM workflow_production_recipes WHERE workflow_id=$1',[owner.workflow_id]);
  const oldTasks=(await f.pool.query("SELECT count(*)::int n FROM tasks WHERE payload?'invocation'")).rows[0].n;
  await tick();
  row=(await f.pool.query('SELECT * FROM tasks WHERE id=$1',[run.id])).rows[0];
  const repaired=row.result.workflow_assembly_reconcile,attempt=repaired.revalidation_request;
  expect(attempt,JSON.stringify(repaired)).toBeTruthy();expect(repaired.status).not.toBe('verified');
  expect((await f.pool.query('SELECT id FROM workflow_activity_refs WHERE workflow_id=$1',[owner.workflow_id])).rows).toEqual([{id:ref}]);
  expect((await f.pool.query("SELECT count(*)::int n FROM tasks WHERE payload?'invocation'")).rows[0].n).toBe(oldTasks);
  expect((await readAuthoringReadiness(f.pool,run.id,adapters)).qualified).toBe(false);
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,repaired.next_check_at-Date.now())+10));
  await tick();const queued=(await f.pool.query("SELECT id FROM tasks WHERE payload?'invocation' AND status='queued'")).rows;
  expect(queued).toHaveLength(1);await tick();
  expect((await f.pool.query("SELECT id FROM tasks WHERE payload?'invocation' AND status='queued'")).rows).toEqual(queued);
  for(let n=0;n<4;n++){await finishPending();await tick();}
  row=(await f.pool.query('SELECT * FROM tasks WHERE id=$1',[run.id])).rows[0];readiness=await readAuthoringReadiness(f.pool,run.id,adapters);
  const state=row.result.workflow_assembly_reconcile;
  expect(readiness.qualified,JSON.stringify(readiness.gaps)).toBe(true);expect(state.status,JSON.stringify(state)).toBe('verified');
  expect(readiness.proof_sha256).not.toBe(beforeProof);expect(readiness.evidence.runs.some(id=>beforeRuns.includes(id))).toBe(false);
  expect(Object.values(state.issues).filter(i=>i.target_version===state.target_version).every(i=>i.status==='closed')).toBe(true);
  expect(row.status).toBe('completed');expect(state.repair_sequence).toBe(1);expect(state.revalidation_request.attempt_id).toBe(attempt.attempt_id);
  expect((await f.pool.query('SELECT status FROM workflows WHERE id=$1',[owner.workflow_id])).rows[0].status).toBe('paused');
  expect((await f.pool.query('SELECT count(*)::int n FROM activity_release_state')).rows[0].n).toBe(0);
  const evidence={actual_process:Boolean(actual),authoring_task_id:run.id,source_revision:f.definition.source.revision,owner,
    old_proof_sha256:beforeProof,old_runs:beforeRuns,repaired,attempt,readiness,state,executionIds,schema:f.schema,formal_release:false};
  writeFileSync(process.env.AUTHORING_RECONCILE_EVIDENCE??'/tmp/workflow-assembly-6-default-scheduler-evidence.json',JSON.stringify(evidence,null,2));
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
},600000);
