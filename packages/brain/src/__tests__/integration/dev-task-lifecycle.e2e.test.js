import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { cleanupRoutedTasks } from '../helpers/routed-task-cleanup.js';
import {
  cleanupActiveCapability,
  seedActiveCapability,
} from './helpers/take-map-authority-fixture.js';
import './helpers/dev-task-lifecycle-mocks.js';

const MOCK_PR_URL = 'https://github.com/mock/cecelia/pull/42';

// ─── 真实 PostgreSQL 连接（验证 DB 写入）─────────────────────────────────────

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
const insertedTaskIds = [];
const runKey = `${process.pid}-${Date.now()}`;
const mapFixtureRepo = `dev-lifecycle-${runKey}`;
const codingRoute = {
  change_kind: 'bugfix',
  mutation_intent: 'write',
  repo_hint: mapFixtureRepo,
  // Coding routes must anchor to an active business capability node. The repo
  // scope key (`cecelia`) is routing metadata, not a mutation authority.
  map_scope_hint: ['F1'],
  branch: `cp-e2e-${runKey}`,
  base_sha: 'a'.repeat(40),
  // 夹具仓库的 dev 账本行以有头授权登记，测试现役回执入口收账。
  payload: { headed_manual: 'true' },
};

// ─── Express App 工厂 ────────────────────────────────────────────────────────

async function makeApp() {
  const app = express();
  app.use(express.json());

  const taskTasksRouter = await import('../../routes/task-tasks.js').then(m => m.default);
  app.use('/api/brain/tasks', taskTasksRouter);
  const executionRouter = await import('../../routes/execution.js').then(m => m.default);
  app.use('/api/brain', executionRouter);
  return app;
}

/** 真实 PG：现役 HTTP 回执持久化、任务终态幂等门禁和普通任务终态。 */
describe('Dev Task 生命周期 — 现役 HTTP callback 与真实数据库', () => {
  let app;
  let mapFixture;

  beforeAll(async () => {
    mapFixture = await seedActiveCapability(testPool, {
      scopeKey: mapFixtureRepo, repo: mapFixtureRepo, nodeKey: 'F1', ensureRepository: true,
    });
    app = await makeApp();
  }, 20000);

  afterAll(async () => {
    if (insertedTaskIds.length) {
      await testPool.query('DELETE FROM callback_queue WHERE task_id = ANY($1::uuid[])', [insertedTaskIds]);
      await cleanupRoutedTasks(testPool, insertedTaskIds);
    }
    await cleanupActiveCapability(testPool, mapFixture);
    await testPool.end();
  });

  async function createTask(taskType, suffix) {
    const res = await request(app).post('/api/brain/tasks').send({
      title: `[e2e-lifecycle] ${suffix} ${runKey}`,
      description: '真实数据库回执生命周期回归，结束自动清理',
      task_type: taskType, priority: 'P2', trigger_source: 'api',
      source_id: `dev-lifecycle-${suffix}-${runKey}`,
      ...(taskType === 'dev' ? codingRoute : {}),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    insertedTaskIds.push(res.body.id);
    const row = (await testPool.query('SELECT status, task_type FROM tasks WHERE id=$1', [res.body.id])).rows[0];
    expect(row.status).toBe('queued');
    expect(row.task_type).toBe(taskType);
    return res.body.id;
  }

  async function sendCallback(taskId, status, extra = {}) {
    const runId = `lifecycle-${taskId}`;
    await testPool.query(
      `UPDATE tasks SET status='in_progress', payload=COALESCE(payload,'{}'::jsonb) || jsonb_build_object('current_run_id',$2::text) WHERE id=$1`,
      [taskId, runId],
    );
    const receipt = { task_id: taskId, run_id: runId, status,
      result: { result: '生命周期回归的真实回执', findings: '回执链正常', ...extra },
      duration_ms: 100, exit_code: status === 'failed' ? 1 : 0,
      ...(extra.pr_url ? { pr_url: extra.pr_url } : {}),
    };
    const response = await request(app).post('/api/brain/execution-callback').send(receipt);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const queued = (await testPool.query(
      'SELECT * FROM callback_queue WHERE task_id=$1 AND run_id=$2 ORDER BY created_at DESC LIMIT 1',
      [taskId, runId],
    )).rows[0];
    expect(queued).toBeDefined();
    expect(queued.status).toBe(status);
    expect(queued.exit_code).toBe(receipt.exit_code);
    expect(queued.result_json).toEqual(receipt.result);
    expect(queued.processed_at).not.toBeNull();
    return receipt;
  }

  it('dev 成功回执入队、回填 PR 并持久化 completed 终态', async () => {
    const taskId = await createTask('dev', 'coding-success');
    const receipt = await sendCallback(taskId, 'success', { pr_url: MOCK_PR_URL });
    const task = (await testPool.query('SELECT status, pr_url FROM tasks WHERE id=$1', [taskId])).rows[0];
    expect(task).toEqual({ status: 'completed', pr_url: MOCK_PR_URL });
    // 队列消费者重放同一回执不能重新应用终态写入。
    const { processExecutionCallback } = await import('../../callback-processor.js');
    const replay = await processExecutionCallback(receipt, testPool);
    expect(replay).toMatchObject({ success: true, applied: false, duplicate: true });
    expect((await testPool.query('SELECT status FROM tasks WHERE id=$1', [taskId])).rows[0].status).toBe('completed');
  });

  it('编码失败回执持久化并落 failed 终态', async () => {
    const taskId = await createTask('dev', 'coding-failure');
    const receipt = await sendCallback(taskId, 'failed');
    // HTTP 和队列消费者均不能用迟到成功覆盖失败终态。
    const late = { ...receipt, status: 'success', exit_code: 0, pr_url: MOCK_PR_URL };
    const response = await request(app).post('/api/brain/execution-callback').send(late);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ skipped: true, reason: 'late_callback_terminal', current_status: 'failed' });
    const { processExecutionCallback } = await import('../../callback-processor.js');
    expect(await processExecutionCallback(late, testPool)).toMatchObject({ applied: false, duplicate: true });
    expect((await testPool.query('SELECT status FROM tasks WHERE id=$1', [taskId])).rows[0].status).toBe('failed');
  });

  it.each([['success', 'completed'], ['failed', 'failed']])(
    '普通任务 %s 回执入队并落 %s 真实终态', async (status, terminal) => {
      const taskId = await createTask('research', `research-${status}`);
      await sendCallback(taskId, status);
      expect((await testPool.query('SELECT status FROM tasks WHERE id=$1', [taskId])).rows[0].status).toBe(terminal);
    },
  );
});
