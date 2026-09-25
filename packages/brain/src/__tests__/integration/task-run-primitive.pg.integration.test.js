// 真 Postgres 集成测试（禁 mock db.js 边）— run 原语落库 + 裸跑检测
//
// 禁 mock 边（本 sprint 改动的接缝，必须真 PG 验证，不得替身）：
//   1. 代码 ↔ task_runs 表：startRun INSERT / finishRun UPDATE 的写路径
//   2. dispatch_events ↔ task_runs：findBareRuns 跨表 LEFT JOIN 检测裸跑
// 走 brain-integration（真实 cecelia_test Postgres）；已登记进
// packages/brain/vitest.config.js 的 POSTGRES_INTEGRATION_TESTS（brain-unit 排除）。
//
// 现状：packages/brain/src/lib/task-run.js 尚未存在 → import 失败 → 全红（预期 Red）。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pool from '../../db.js';
import {
  startRun,
  finishRun,
  findBareRuns,
} from '../../lib/task-run.js';

const createdTaskIds = [];

async function seedTask(status = 'in_progress') {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO tasks (id, task_type, status, payload)
     VALUES ($1, 'harness_initiative', $2, '{}'::jsonb)`,
    [id, status],
  );
  createdTaskIds.push(id);
  return id;
}

afterAll(async () => {
  if (createdTaskIds.length) {
    // task_runs / dispatch_events 经 ON DELETE CASCADE 或 FK 关联，随 tasks 清理
    await pool.query(`DELETE FROM dispatch_events WHERE task_id = ANY($1::uuid[])`, [createdTaskIds]);
    await pool.query(`DELETE FROM task_runs WHERE task_id = ANY($1::uuid[])`, [createdTaskIds]);
    await pool.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [createdTaskIds]);
  }
});

describe('startRun — 唯一写口 + 幂等', () => {
  it('写入恰好一行 running，含执行路径 context.source', async () => {
    const taskId = await seedTask();
    const runId = `run-${randomUUID()}`;
    const r = await startRun({ taskId, runId, source: 'dispatcher', context: { agent: 'claude' } });
    expect(r).toBeTruthy();

    const { rows } = await pool.query(
      `SELECT status, context, ended_at FROM task_runs WHERE run_id = $1`,
      [runId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('running');
    expect(rows[0].ended_at).toBeNull();
    expect(rows[0].context.source).toBe('dispatcher');
  });

  it('同一 run_id 重复 startRun 幂等 — 不产生第二行', async () => {
    const taskId = await seedTask();
    const runId = `run-${randomUUID()}`;
    await startRun({ taskId, runId, source: 'executor' });
    await startRun({ taskId, runId, source: 'executor' });
    const { rows } = await pool.query(`SELECT count(*)::int AS c FROM task_runs WHERE run_id = $1`, [runId]);
    expect(rows[0].c).toBe(1);
  });
});

describe('finishRun — 同一行补齐终态 + 幂等', () => {
  it('补齐 ended_at / status=success / exit_code / 产物引用', async () => {
    const taskId = await seedTask();
    const runId = `run-${randomUUID()}`;
    await startRun({ taskId, runId, source: 'openclaw-agent' });
    await finishRun({ runId, status: 'completed', exitCode: 0, artifacts: ['pr:999'] });

    const { rows } = await pool.query(
      `SELECT status, ended_at, result FROM task_runs WHERE run_id = $1`,
      [runId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('success');
    expect(rows[0].ended_at).not.toBeNull();
    expect(rows[0].result.exit_code).toBe(0);
    expect(rows[0].result.artifacts).toEqual(['pr:999']);
  });

  it('已结束的 run 再次 finishRun 不覆盖（ended_at 守卫，防伪造终态）', async () => {
    const taskId = await seedTask();
    const runId = `run-${randomUUID()}`;
    await startRun({ taskId, runId, source: 'bridge' });
    await finishRun({ runId, status: 'failed', exitCode: 1, artifacts: [] });
    const first = await pool.query(`SELECT status, ended_at FROM task_runs WHERE run_id = $1`, [runId]);
    await finishRun({ runId, status: 'success', exitCode: 0, artifacts: ['x'] });
    const second = await pool.query(`SELECT status, ended_at FROM task_runs WHERE run_id = $1`, [runId]);

    expect(second.rows[0].status).toBe('failed');
    expect(second.rows[0].ended_at.getTime()).toBe(first.rows[0].ended_at.getTime());
  });
});

describe('findBareRuns — 有 dispatch_events 无 task_runs = 裸跑', () => {
  it('检出被派发但无 run 记录的 task（AMBER 数据源）', async () => {
    const bareTask = await seedTask();
    const okTask = await seedTask();
    await pool.query(
      `INSERT INTO dispatch_events (task_id, event_type, reason) VALUES ($1, 'dispatched', 'test-bare'), ($2, 'dispatched', 'test-ok')`,
      [bareTask, okTask],
    );
    // okTask 有 run，bareTask 没有
    await startRun({ taskId: okTask, runId: `run-${randomUUID()}`, source: 'dispatcher' });

    const bare = await findBareRuns(pool, { windowMinutes: 60 });
    const bareIds = bare.map((b) => b.task_id);
    expect(bareIds).toContain(bareTask);
    expect(bareIds).not.toContain(okTask);
  });
});
