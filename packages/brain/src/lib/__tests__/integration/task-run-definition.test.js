import { randomUUID } from 'node:crypto';
import { beforeEach,afterEach,it,expect } from 'vitest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import { createRelease,recordReleaseObservation } from '../../release-index.js';
import { startRun } from '../../task-run.js';
let f,input,task;
beforeEach(async()=>{
  f=await releaseEvidenceDatabase();task=randomUUID();await f.db.query("INSERT INTO tasks(id,title,status) VALUES($1,'固定定义起跑','in_progress')",[task]);
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
