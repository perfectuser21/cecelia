/**
 * Harness v2 M6 — GET /api/brain/initiatives/:id/dag integration test
 *
 * 覆盖：
 *   1. happy path — contract + run + 3 harness_task + task_dependencies → 聚合正确
 *   2. 只有 contract 没有 run → phase 推断为 B_task_loop
 *   3. 完全无记录 → 404
 *   4. 非法 id（空串 / 超长） → 400
 *
 * 策略：挂载真实 router 到 express app，supertest 发请求，用 BEGIN/ROLLBACK 外层事务
 * 隔离不污染共享 DB。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

let pool;
let initiativesRouter;
let app;

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  initiativesRouter = (await import('../../routes/initiatives.js')).default;
  app = express();
  app.use('/api/brain/initiatives', initiativesRouter);
});

afterAll(async () => {
  // 共享 pool，不调 pool.end()
});

// ─── helpers ───────────────────────────────────────────────────────────

async function insertInitiative(client, { initiativeId, title }) {
  const r = await client.query(
    `INSERT INTO tasks (id, task_type, title, description, status, priority)
     VALUES ($1::uuid, 'harness_initiative', $2, 'dag-endpoint-test', 'queued', 'P2')
     RETURNING id`,
    [initiativeId, title]
  );
  return r.rows[0].id;
}

async function insertContract(client, { initiativeId, status = 'approved', reviewRounds = 2 }) {
  const r = await client.query(
    `INSERT INTO initiative_contracts
       (initiative_id, version, status, prd_content, contract_content,
        e2e_acceptance, review_rounds, budget_cap_usd, timeout_sec)
     VALUES ($1::uuid, 1, $2, 'PRD TEXT', 'CONTRACT TEXT',
             '{"scenarios":["s1"]}'::jsonb, $3, 10, 21600)
     RETURNING id`,
    [initiativeId, status, reviewRounds]
  );
  return r.rows[0].id;
}

async function insertRun(client, { initiativeId, contractId, phase = 'B_task_loop', costUsd = 0.5 }) {
  const r = await client.query(
    `INSERT INTO initiative_runs
       (initiative_id, contract_id, phase, cost_usd, deadline_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, NOW() + INTERVAL '6 hours')
     RETURNING id`,
    [initiativeId, contractId, phase, costUsd]
  );
  return r.rows[0].id;
}

async function insertSubtask(client, { initiativeId, title, status = 'queued', fixRounds = 0, costUsd = 0, prUrl = null }) {
  const r = await client.query(
    `INSERT INTO tasks (task_type, title, status, priority, pr_url, payload)
     VALUES ('harness_task', $1, $2, 'P2', $3,
       jsonb_build_object('parent_task_id', $4::text, 'fix_rounds', $5::int, 'cost_usd', $6::numeric))
     RETURNING id`,
    [title, status, prUrl, initiativeId, fixRounds, costUsd]
  );
  return r.rows[0].id;
}

async function insertDep(client, { fromId, toId, edgeType = 'hard' }) {
  await client.query(
    `INSERT INTO task_dependencies (from_task_id, to_task_id, edge_type)
     VALUES ($1::uuid, $2::uuid, $3)`,
    [fromId, toId, edgeType]
  );
}

async function cleanup(client, initiativeId, subtaskIds) {
  if (subtaskIds.length) {
    await client.query(
      `DELETE FROM task_dependencies WHERE from_task_id = ANY($1::uuid[]) OR to_task_id = ANY($1::uuid[])`,
      [subtaskIds]
    );
    await client.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [subtaskIds]);
  }
  await client.query(`DELETE FROM initiative_runs WHERE initiative_id = $1::uuid`, [initiativeId]);
  await client.query(`DELETE FROM initiative_contracts WHERE initiative_id = $1::uuid`, [initiativeId]);
  await client.query(`DELETE FROM tasks WHERE id = $1::uuid`, [initiativeId]);
}

// ─── tests ──────────────────────────────────────────────────────────────

describe('GET /api/brain/initiatives/:id/dag', () => {
  let initiativeId;
  let subtaskIds;
  let client;

  beforeEach(async () => {
    initiativeId = randomUUID();
    subtaskIds = [];
    client = await pool.connect();
  });

  afterEach(async () => {
    try {
      await cleanup(client, initiativeId, subtaskIds);
    } finally {
      client.release();
    }
  });

  it('happy path — 返回 phase / contract / tasks / deps / cost', async () => {
    await insertInitiative(client, { initiativeId, title: 'M6 dag test' });
    const cId = await insertContract(client, { initiativeId, status: 'approved' });
    await insertRun(client, { initiativeId, contractId: cId, phase: 'B_task_loop', costUsd: 1.23 });

    const t1 = await insertSubtask(client, {
      initiativeId, title: 'T1', status: 'completed', fixRounds: 1, costUsd: 0.4,
      prUrl: 'https://github.com/a/b/pull/1',
    });
    const t2 = await insertSubtask(client, {
      initiativeId, title: 'T2', status: 'in_progress', fixRounds: 0, costUsd: 0.3,
    });
    const t3 = await insertSubtask(client, {
      initiativeId, title: 'T3', status: 'queued', fixRounds: 0, costUsd: 0,
    });
    subtaskIds = [t1, t2, t3];

    await insertDep(client, { fromId: t2, toId: t1 });
    await insertDep(client, { fromId: t3, toId: t2 });

    const res = await request(app).get(`/api/brain/initiatives/${initiativeId}/dag`);
    expect(res.status).toBe(200);
    expect(res.body.initiative_id).toBe(initiativeId);
    expect(res.body.phase).toBe('B_task_loop');
    expect(res.body.prd_content).toBe('PRD TEXT');
    expect(res.body.contract_content).toBe('CONTRACT TEXT');
    expect(res.body.e2e_acceptance).toEqual({ scenarios: ['s1'] });
    expect(res.body.contract.status).toBe('approved');
    expect(res.body.tasks).toHaveLength(3);
    expect(res.body.tasks[0].title).toBe('T1');
    expect(res.body.tasks[0].pr_url).toBe('https://github.com/a/b/pull/1');
    expect(res.body.tasks[0].fix_rounds).toBe(1);
    expect(res.body.dependencies).toHaveLength(2);
    expect(res.body.dependencies.map((d) => d.edge_type)).toEqual(['hard', 'hard']);
    expect(res.body.cost.total_usd).toBeCloseTo(1.23, 2);
    expect(res.body.cost.by_task).toHaveLength(3);
    expect(res.body.timing.deadline_at).toBeTruthy();
    expect(res.body.run.current_task_id).toBeNull();
  });

  it('只有 approved contract 没有 run → phase 推断 B_task_loop', async () => {
    await insertInitiative(client, { initiativeId, title: 'no-run' });
    await insertContract(client, { initiativeId, status: 'approved' });

    const res = await request(app).get(`/api/brain/initiatives/${initiativeId}/dag`);
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('B_task_loop');
    expect(res.body.tasks).toEqual([]);
    expect(res.body.run).toBeNull();
  });

  it('只有 draft contract 没有 run → phase 推断 A_contract', async () => {
    await insertInitiative(client, { initiativeId, title: 'draft-only' });
    await insertContract(client, { initiativeId, status: 'draft' });

    const res = await request(app).get(`/api/brain/initiatives/${initiativeId}/dag`);
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('A_contract');
  });

  it('无任何记录 → 404', async () => {
    const fakeId = randomUUID();
    const res = await request(app).get(`/api/brain/initiatives/${fakeId}/dag`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('initiative not found');
  });

  it('非法 id（超长）→ 400', async () => {
    const longId = 'x'.repeat(200);
    const res = await request(app).get(`/api/brain/initiatives/${longId}/dag`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid id');
  });
});
