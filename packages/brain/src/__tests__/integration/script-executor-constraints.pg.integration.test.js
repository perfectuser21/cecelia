/**
 * executor=script 的库层约束 —— 真 PostgreSQL 验证（链 bf5088a3 棒3 PR A，任务 5cdbd52a）。
 *
 * 结构断言（migration-471-script-executor.test.js）证明不了：约束真的放行新值、拦旧非法值，
 * 且 472 之后两条约束都已 validated。全量迁移后在临时库里直插验证。
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTempMigratedDb } from '../helpers/temp-migrated-db.js';

let db;

beforeAll(async () => {
  db = await createTempMigratedDb('scriptc');
}, 180_000);

afterAll(async () => {
  if (db) await db.drop();
}, 30_000);

const insert = (taskType, executorKind) => db.pool.query(
  `INSERT INTO tasks (id, title, task_type, status, executor_kind, payload)
   VALUES ($1, $2, $3, 'queued', $4, '{}'::jsonb) RETURNING id, task_type, executor_kind`,
  [randomUUID(), `constraint probe ${taskType}/${executorKind} ${randomUUID()}`, taskType, executorKind],
);

describe.sequential('tasks 约束（471/472）against real PostgreSQL', () => {
  it("script_run + executor_kind='script' 可写", async () => {
    const { rows } = await insert('script_run', 'script');
    expect(rows[0]).toMatchObject({ task_type: 'script_run', executor_kind: 'script' });
  });

  it('既有类型/执行体不受影响（qiumi_task + openclaw-agent、dev + NULL）', async () => {
    expect((await insert('qiumi_task', 'openclaw-agent')).rows).toHaveLength(1);
    expect((await insert('dev', null)).rows).toHaveLength(1);
  });

  it('非法 executor_kind / task_type 仍被 23514 拦住', async () => {
    await expect(insert('script_run', 'ssh-exec')).rejects.toMatchObject({ code: '23514' });
    await expect(insert('script_runner', 'script')).rejects.toMatchObject({ code: '23514' });
  });

  it('472 之后两条约束都已 validated', async () => {
    const { rows } = await db.pool.query(
      `SELECT conname, convalidated FROM pg_constraint
        WHERE conname IN ('tasks_executor_kind_check', 'tasks_task_type_check') ORDER BY conname`,
    );
    expect(rows).toEqual([
      { conname: 'tasks_executor_kind_check', convalidated: true },
      { conname: 'tasks_task_type_check', convalidated: true },
    ]);
  });

  it('迁移幂等：重放 471/472 不报错、不改变约束语义', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'migrations');
    for (const f of ['471_script_executor_kind_and_task_type.sql', '472_validate_script_executor_constraints.sql']) {
      await db.pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
    expect((await insert('script_run', 'script')).rows).toHaveLength(1);
  });
});
