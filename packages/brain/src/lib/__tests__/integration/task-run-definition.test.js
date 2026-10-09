import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach,afterEach,it,expect } from 'vitest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import { withLegacyNames } from '../../../__tests__/fixtures/minimum-definition-schema.js';
import { createRelease,recordReleaseObservation } from '../../release-index.js';
import { startRun } from '../../task-run.js';
import { bindRunDefinition } from '../../run-definition-binding.js';
let f,input,task;
beforeEach(async()=>{
  f=await releaseEvidenceDatabase();task=randomUUID();await f.db.query("INSERT INTO tasks(id,title,status) VALUES($1,'固定定义起跑','in_progress')",[task]);
  await f.db.query('DROP TABLE spans CASCADE');
  for(const file of ['495_vs_model_spans.sql','514_span_occurrences.sql','516_span_definition_provenance.sql'])await withLegacyNames(f.db,()=>f.db.query(readFileSync(new URL(`../../../../migrations/${file}`,import.meta.url),'utf8')));
  const release=(await createRelease(f.db,f.releaseInput)).release;
  const observation=(await recordReleaseObservation(f.db,release.id,f.observationInput,{trustedCollector:'fixture-collector'})).observation;
  input=f.runInput(release,observation);delete input.source_kind;delete input.external_origin;
});
afterEach(async()=>{await f?.close();f=null;});
it('显式固定定义起跑在单一事务写task_run与binding，幂等回读真实行',async()=>{
  const first=await startRun({taskId:task,runId:'internal-fixed',source:'workflow',definition:input},{pool:f.db});
  expect(first.binding).toMatchObject({run_id:'internal-fixed',source_kind:'internal',task_run_id:first.id});
  const run=(await f.db.query('SELECT * FROM task_runs WHERE id=$1',[first.id])).rows[0];expect(run.workflow_id).toBe(input.workflow_id);expect(run.task_id).toBe(task);
  const second=await startRun({taskId:task,runId:'internal-fixed',source:'workflow',definition:input},{pool:f.db});expect(second.id).toBe(first.id);expect(second.binding.id).toBe(first.binding.id);
});
it('绑定校验失败整笔回滚，不留下running假账也不fail-open继续执行',async()=>{
  await expect(startRun({taskId:task,runId:'bad-fixed',source:'workflow',definition:{...input,snapshot_sha256:'0'.repeat(64)}},{pool:f.db})).rejects.toThrow();
  expect((await f.db.query("SELECT * FROM task_runs WHERE run_id='bad-fixed'")).rows).toHaveLength(0);
  expect((await f.db.query("SELECT * FROM run_definition_bindings WHERE run_id='bad-fixed'")).rows).toHaveLength(0);
});
it('同run ID不能被另一个任务冒领，也不改变原Workflow',async()=>{
  await startRun({taskId:task,runId:'owned',source:'workflow',definition:input},{pool:f.db});
  const other=randomUUID();await f.db.query("INSERT INTO tasks(id,title,status) VALUES($1,'另一个任务','in_progress')",[other]);
  await expect(startRun({taskId:other,runId:'owned',source:'workflow',definition:input},{pool:f.db})).rejects.toThrow();
  expect((await f.db.query("SELECT task_id FROM task_runs WHERE run_id='owned'")).rows[0].task_id).toBe(task);
});
it('已登记外部运行不能再由旧起跑入口写成同名内部任务',async()=>{
  await bindRunDefinition(f.db,'external-fixed',{...input,source_kind:'external',external_origin:'fixture'});
  expect(await startRun({taskId:task,runId:'external-fixed',source:'legacy-dispatch'},{pool:f.db})).toBeNull();
  expect((await f.db.query("SELECT * FROM task_runs WHERE run_id='external-fixed'")).rows).toHaveLength(0);
});
it.each(['running','success'])('历史%s运行不能在发生后补挂当前定义',async status=>{
  await f.db.query(`INSERT INTO task_runs(task_id,run_id,status,workflow_id,ended_at)
    VALUES($1,'old-run',$2,$3,CASE WHEN $2='success' THEN '2026-01-02'::timestamptz ELSE NULL END)`,[task,status,input.workflow_id]);
  await expect(startRun({taskId:task,runId:'old-run',source:'workflow',definition:input},{pool:f.db})).rejects.toThrow();
  expect((await f.db.query("SELECT * FROM run_definition_bindings WHERE run_id='old-run'")).rows).toHaveLength(0);
});
