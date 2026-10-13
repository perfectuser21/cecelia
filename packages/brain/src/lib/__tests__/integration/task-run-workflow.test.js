import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { DB_DEFAULTS } from '../../../db-config.js';
import { startRun, backfillWorkflowRunIdentity } from '../../task-run.js';
let admin, db, schema, workflow, other;
beforeEach(async () => {
  if (DB_DEFAULTS.database === 'cecelia') throw new Error('禁止测试连接生产');
  admin = new pg.Client(DB_DEFAULTS); await admin.connect();
  schema = `run_identity_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  db = new pg.Client({ ...DB_DEFAULTS, options: `-c search_path=${schema}` }); await db.connect();
  await db.query(`CREATE TABLE workflows(id uuid PRIMARY KEY, version text, current_definition_version_id uuid);
    CREATE TABLE tasks(id uuid PRIMARY KEY, task_type text, payload jsonb DEFAULT '{}');
    CREATE TABLE task_runs(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, task_id uuid REFERENCES tasks(id),
      run_id text UNIQUE, status text, context jsonb DEFAULT '{}', workflow_id uuid REFERENCES workflows(id),
      result jsonb DEFAULT '{}', started_at timestamptz DEFAULT now(), ended_at timestamptz,
      updated_at timestamptz DEFAULT now(), notion_synced_at timestamptz)`);
  workflow = randomUUID(); other = randomUUID();
  await db.query('INSERT INTO workflows(id,version) VALUES($1,\'current-9\'),($2,\'other\')', [workflow, other]);
});
afterEach(async () => {
  await db?.end();
  if (schema) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin?.end();
});
async function task(payload = {}) {
  const id = randomUUID();
  await db.query("INSERT INTO tasks VALUES($1,'script',$2)", [id, payload]); return id;
}
async function run(id, runId = randomUUID(), context) {
  const started = await startRun({ taskId: id, runId, source: 'cron', context }, { pool: db });
  expect(started).not.toBeNull();
  return (await db.query('SELECT * FROM task_runs WHERE run_id=$1', [runId])).rows[0];
}
describe('普通 Run 原子冻结身份与版本（真 PG）', () => {
  it('payload 精确关联并保留执行入口、代码和定义版本', async () => {
    const payload = { workflow_id: workflow, workflow_version: '1', definition_version_id: randomUUID(),
      source_revision: 'source-old', control_source_revision: 'controller-old', phone_serial: 'phone-a',
      batch_task_id: randomUUID(), attempt: 2 };
    const row = await run(await task(payload));
    expect(row.workflow_id).toBe(workflow);
    expect(row.context).toMatchObject({ source: 'cron', task_type: 'script', workflow_snapshot: payload });
  });
  it('普通任务不带 Workflow 仍记录真实运行，不创建猜测版本', async () => {
    const row = await run(await task());
    expect(row.workflow_id).toBeNull(); expect(row.context.source).toBe('cron');
    expect(row.context.workflow_snapshot).toBeUndefined();
  });
  it.each(['bad-id', randomUUID(), [randomUUID()]])('非法/未知身份 %j 不阻断原语也不误绑', async workflowId => {
    const row = await run(await task({ workflow_id: workflowId })); expect(row.workflow_id).toBeNull();
  });
  it('payload 与历史快照身份冲突时不误绑', async () => {
    const row = await run(await task({ workflow_id: workflow }), undefined,
      { workflow_snapshot: { workflow_id: other, source_revision: 'old' } });
    expect(row.workflow_id).toBeNull();
    expect(row.context.workflow_snapshot).toEqual({ workflow_id: other, source_revision: 'old' });
  });
  it('明确历史快照优先于后来改过的任务版本；重复起跑不覆盖旧 Run', async () => {
    const id = await task({ workflow_id: workflow, workflow_version: '2', source_revision: 'task-new' });
    const first = await run(id, 'same-run', { workflow_snapshot: { workflow_id: workflow,
      workflow_version: '1', source_revision: 'run-old' } });
    expect(first.context.workflow_snapshot).toMatchObject({ workflow_version: '1', source_revision: 'run-old' });
    await db.query('UPDATE workflows SET version=\'10\'');
    await db.query('UPDATE tasks SET payload=$2 WHERE id=$1', [id, { workflow_id: other, workflow_version: '3' }]);
    expect(await run(id, 'same-run')).toEqual(first);
  });
  it('新起跑冻结当时版本，升级后的第二新 Run 获得新版；旧 Run 重放不改版', async () => {
    const definition1=randomUUID(),definition2=randomUUID(),batch=randomUUID();
    const id=await task({ workflow_id:workflow,original_scope:{origin_batch_task_id:batch} });
    await db.query('UPDATE workflows SET current_definition_version_id=$2 WHERE id=$1',[workflow,definition1]);
    const first=await run(id,'before-upgrade');
    expect(first.context.workflow_snapshot).toMatchObject({workflow_version:'current-9',definition_version_id:definition1,batch_task_id:batch});
    await db.query('UPDATE workflows SET version=\'current-10\',current_definition_version_id=$2 WHERE id=$1',[workflow,definition2]);
    const second=await run(id,'after-upgrade');
    expect(second.context.workflow_snapshot).toMatchObject({workflow_version:'current-10',definition_version_id:definition2});
    expect(await run(id,'before-upgrade')).toEqual(first);
  });
});
describe('历史 Run 只回填可证明身份（真 PG）', () => {
  it('只改空身份，保留历史 context、事实、版本或已有冲突归属，重复执行幂等', async () => {
    const id = await task({ workflow_id: workflow, workflow_version: 'new' });
    const unknown = await task({ workflow_id: randomUUID() });
    const invalid = await task({ workflow_id: 'bad' });
    const context = { source: 'old', workflow_snapshot: { workflow_version: 'old', source_revision: 'old' } };
    await db.query(`INSERT INTO task_runs(task_id,run_id,status,context,workflow_id,result,ended_at)
      VALUES($1,'history','success',$4,NULL,'{"sent":3}','2026-01-01'),
      ($1,'conflict','failed',$4,$5,'{}','2026-01-02'),($2,'unknown','running','{}',NULL,'{}',NULL),
      ($3,'invalid','running','{}',NULL,'{}',NULL)`, [id, unknown, invalid, context, other]);
    const before = (await db.query("SELECT * FROM task_runs WHERE run_id='history'")).rows[0];
    const changed = await backfillWorkflowRunIdentity({ pool: db });
    expect(changed.map(r => r.run_id)).toEqual(['history']);
    const after = (await db.query("SELECT * FROM task_runs WHERE run_id='history'")).rows[0];
    expect(after).toEqual({ ...before, workflow_id: workflow });
    expect((await db.query("SELECT workflow_id FROM task_runs WHERE run_id='conflict'")).rows[0].workflow_id).toBe(other);
    expect(await backfillWorkflowRunIdentity({ pool: db })).toEqual([]);
  });
});
