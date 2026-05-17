/**
 * pipeline-detail LangGraph 字段集成测试（真实 PostgreSQL）
 *
 * 覆盖 GET /api/brain/harness/pipeline-detail 的 langgraph 字段：
 *   1. 非 LangGraph task（无 langgraph_step 事件）→ enabled=false，rounds 为空
 *   2. LangGraph task：2 轮 GAN（proposer/reviewer）+ 2 轮 Fix（generator/evaluator）+ 3 个 checkpoints
 *      → gan_rounds.length===2, fix_rounds.length===2, checkpoints.count===3, enabled=true
 *
 * 与 packages/brain/src/executor.js 的 onStep 回调 + PostgresSaver checkpointer 配套 —
 * 确保 cecelia_events 和 checkpoints 两个来源的数据能被 API 正确聚合。
 *
 * 运行环境：CI brain-integration job（含真实 PostgreSQL 服务）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

// 使用固定 UUID 便于清理（DELETE WHERE id IN (...)）
const TEST_TASK_ID_LG = '00000000-1111-2222-3333-444400000001';
const TEST_TASK_ID_OLD = '00000000-1111-2222-3333-444400000002';

// 先建表（checkpoints 可能未初始化，PostgresSaver.setup() 在真实 runtime 才跑）
async function ensureCheckpointsTable() {
  await testPool.query(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      thread_id text NOT NULL,
      checkpoint_ns text NOT NULL DEFAULT '',
      checkpoint_id text NOT NULL,
      parent_checkpoint_id text,
      type text,
      checkpoint jsonb NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}',
      PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
    )
  `);
}

async function insertTask(id, title = '测试 LangGraph Pipeline') {
  await testPool.query(
    `INSERT INTO tasks (id, title, status, priority, task_type, trigger_source, domain)
     VALUES ($1::uuid, $2, 'completed', 'P2', 'harness_planner', 'api', 'agent_ops')
     ON CONFLICT (id) DO NOTHING`,
    [id, title]
  );
}

async function insertStep(taskId, stepIndex, node, extra = {}) {
  const payload = { node, step_index: stepIndex, ...extra };
  await testPool.query(
    `INSERT INTO cecelia_events (event_type, task_id, payload)
     VALUES ('langgraph_step', $1::uuid, $2::jsonb)`,
    [taskId, JSON.stringify(payload)]
  );
  // 稍微 sleep 确保 created_at 单调递增（PG 时间戳粒度到微秒，大多数情况足够）
  await new Promise(r => setTimeout(r, 2));
}

async function insertCheckpoint(threadId, checkpointId) {
  await testPool.query(
    `INSERT INTO checkpoints (thread_id, checkpoint_id, checkpoint)
     VALUES ($1, $2, '{}'::jsonb)
     ON CONFLICT DO NOTHING`,
    [threadId, checkpointId]
  );
}

async function makeApp() {
  const app = express();
  app.use(express.json());
  const harnessRouter = (await import('../../routes/harness.js')).default;
  app.use('/api/brain/harness', harnessRouter);
  return app;
}

// ─── Test Suite ───────────────────────────────────────────────────────────

describe('pipeline-detail LangGraph 字段 — 集成测试', () => {
  let app;

  beforeAll(async () => {
    await ensureCheckpointsTable();

    // 清理上次残留
    await testPool.query(
      `DELETE FROM cecelia_events WHERE task_id = ANY($1::uuid[])`,
      [[TEST_TASK_ID_LG, TEST_TASK_ID_OLD]]
    );
    await testPool.query(
      `DELETE FROM checkpoints WHERE thread_id = ANY($1::text[])`,
      [[TEST_TASK_ID_LG, TEST_TASK_ID_OLD]]
    );
    await testPool.query(
      `DELETE FROM tasks WHERE id = ANY($1::uuid[])`,
      [[TEST_TASK_ID_LG, TEST_TASK_ID_OLD]]
    );

    // 造老路径 task（无事件）
    await insertTask(TEST_TASK_ID_OLD, '老路径（非 LangGraph）Pipeline');

    // 造 LangGraph task + 完整事件序列
    await insertTask(TEST_TASK_ID_LG, 'LangGraph Pipeline');

    // 按时序插入节点事件：
    // planner → proposer(R1) → reviewer(R1:REVISION) → proposer(R2) → reviewer(R2:APPROVED)
    //         → generator(F1) → evaluator(F1:FAIL) → generator(F2) → evaluator(F2:PASS) → report
    await insertStep(TEST_TASK_ID_LG, 1, 'planner');
    await insertStep(TEST_TASK_ID_LG, 2, 'proposer', { review_round: 1 });
    await insertStep(TEST_TASK_ID_LG, 3, 'reviewer', { review_round: 1, review_verdict: 'REVISION' });
    await insertStep(TEST_TASK_ID_LG, 4, 'proposer', { review_round: 2 });
    await insertStep(TEST_TASK_ID_LG, 5, 'reviewer', { review_round: 2, review_verdict: 'APPROVED' });
    await insertStep(TEST_TASK_ID_LG, 6, 'generator', { pr_url: 'https://github.com/test/pr/1', eval_round: 0 });
    await insertStep(TEST_TASK_ID_LG, 7, 'evaluator', { eval_round: 1, evaluator_verdict: 'FAIL' });
    await insertStep(TEST_TASK_ID_LG, 8, 'generator', { pr_url: 'https://github.com/test/pr/2', eval_round: 1 });
    await insertStep(TEST_TASK_ID_LG, 9, 'evaluator', { eval_round: 2, evaluator_verdict: 'PASS' });
    await insertStep(TEST_TASK_ID_LG, 10, 'report');

    // 3 个 checkpoints（PostgresSaver 每步一个）
    await insertCheckpoint(TEST_TASK_ID_LG, 'ckpt-001');
    await insertCheckpoint(TEST_TASK_ID_LG, 'ckpt-002');
    await insertCheckpoint(TEST_TASK_ID_LG, 'ckpt-003');

    app = await makeApp();
  }, 30000);

  afterAll(async () => {
    await testPool.query(
      `DELETE FROM cecelia_events WHERE task_id = ANY($1::uuid[])`,
      [[TEST_TASK_ID_LG, TEST_TASK_ID_OLD]]
    );
    await testPool.query(
      `DELETE FROM checkpoints WHERE thread_id = ANY($1::text[])`,
      [[TEST_TASK_ID_LG, TEST_TASK_ID_OLD]]
    );
    await testPool.query(
      `DELETE FROM tasks WHERE id = ANY($1::uuid[])`,
      [[TEST_TASK_ID_LG, TEST_TASK_ID_OLD]]
    );
    await testPool.end();
  });

  it('响应根层含 langgraph 字段', async () => {
    const res = await request(app)
      .get(`/api/brain/harness/pipeline-detail?planner_task_id=${TEST_TASK_ID_LG}`)
      .expect(200);
    expect(res.body).toHaveProperty('langgraph');
    expect(res.body.langgraph).toBeTypeOf('object');
  });

  it('非 LangGraph task enabled=false，rounds 均为空', async () => {
    const res = await request(app)
      .get(`/api/brain/harness/pipeline-detail?planner_task_id=${TEST_TASK_ID_OLD}`)
      .expect(200);
    const lg = res.body.langgraph;
    expect(lg.enabled).toBe(false);
    expect(lg.thread_id).toBe(TEST_TASK_ID_OLD);
    expect(lg.steps).toEqual([]);
    expect(lg.gan_rounds).toEqual([]);
    expect(lg.fix_rounds).toEqual([]);
    expect(lg.checkpoints.count).toBe(0);
    expect(lg.checkpoints.state_available).toBe(false);
    expect(lg.mermaid).toContain('graph TD');
  });

  it('LangGraph task enabled=true，steps 按时间升序', async () => {
    const res = await request(app)
      .get(`/api/brain/harness/pipeline-detail?planner_task_id=${TEST_TASK_ID_LG}`)
      .expect(200);
    const lg = res.body.langgraph;
    expect(lg.enabled).toBe(true);
    expect(lg.thread_id).toBe(TEST_TASK_ID_LG);
    expect(lg.steps.length).toBe(10);
    expect(lg.steps[0].node).toBe('planner');
    expect(lg.steps[9].node).toBe('report');
  });

  it('GAN 对抗 2 轮正确配对', async () => {
    const res = await request(app)
      .get(`/api/brain/harness/pipeline-detail?planner_task_id=${TEST_TASK_ID_LG}`)
      .expect(200);
    const rounds = res.body.langgraph.gan_rounds;
    expect(rounds.length).toBe(2);
    expect(rounds[0].round).toBe(1);
    expect(rounds[0].proposer.node).toBe('proposer');
    expect(rounds[0].reviewer.node).toBe('reviewer');
    expect(rounds[0].reviewer.review_verdict).toBe('REVISION');
    expect(rounds[1].round).toBe(2);
    expect(rounds[1].reviewer.review_verdict).toBe('APPROVED');
  });

  it('Fix 循环 2 轮正确配对', async () => {
    const res = await request(app)
      .get(`/api/brain/harness/pipeline-detail?planner_task_id=${TEST_TASK_ID_LG}`)
      .expect(200);
    const rounds = res.body.langgraph.fix_rounds;
    expect(rounds.length).toBe(2);
    expect(rounds[0].round).toBe(1);
    expect(rounds[0].generator.pr_url).toBe('https://github.com/test/pr/1');
    expect(rounds[0].evaluator.evaluator_verdict).toBe('FAIL');
    expect(rounds[1].generator.pr_url).toBe('https://github.com/test/pr/2');
    expect(rounds[1].evaluator.evaluator_verdict).toBe('PASS');
  });

  it('checkpoints 计数为 3 且 state_available=true', async () => {
    const res = await request(app)
      .get(`/api/brain/harness/pipeline-detail?planner_task_id=${TEST_TASK_ID_LG}`)
      .expect(200);
    const cp = res.body.langgraph.checkpoints;
    expect(cp.count).toBe(3);
    expect(cp.state_available).toBe(true);
    expect(cp.latest_checkpoint_id).toBeDefined();
  });

  it('mermaid 字段非空，含 Planner/Proposer/Reviewer/Generator/Evaluator/Report 节点', async () => {
    const res = await request(app)
      .get(`/api/brain/harness/pipeline-detail?planner_task_id=${TEST_TASK_ID_LG}`)
      .expect(200);
    const m = res.body.langgraph.mermaid;
    expect(typeof m).toBe('string');
    expect(m).toContain('Planner');
    expect(m).toContain('Proposer');
    expect(m).toContain('Reviewer');
    expect(m).toContain('Generator');
    expect(m).toContain('Evaluator');
    expect(m).toContain('Report');
  });
});
