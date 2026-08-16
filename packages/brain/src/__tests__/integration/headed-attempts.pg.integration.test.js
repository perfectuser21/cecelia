// headed-attempts.pg.integration.test.js — 有头签发口 + validate 联动（真 Postgres）
//
// TDD Red：POST /api/brain/work-routing/headed-attempts 尚未实现 → 现返回 404，
// 下面断言 400/201/valid:true/409 全部失败 = RED。generator 实现后转绿。
//
// 禁 mock 边（合同「## 禁 mock 边清单」）：本文件必须真 Postgres、真 createKernelRun、
// 真 harness_attempts 写入、真 validateWorkRoutingIdentity；禁 vi.mock(pool)。
// 需注册进 packages/brain/vitest.config.js 的 POSTGRES_INTEGRATION_TESTS。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import pool from '../../db.js';
import workRoutingRouter from '../../routes/work-routing.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/work-routing', workRoutingRouter);
  return app;
}

describe('POST /work-routing/headed-attempts [BEHAVIOR B-03/B-04]', () => {
  const app = buildApp();
  const createdTaskIds = [];

  afterAll(async () => {
    for (const id of createdTaskIds) {
      await pool.query('DELETE FROM harness_attempts WHERE task_bundle->\'inputs\'->>\'task_id\' = $1', [id]).catch(() => {});
      await pool.query('DELETE FROM tasks WHERE id = $1', [id]).catch(() => {});
    }
  });

  it('B-03a: task 无 routing_receipt_id → 400，不写 harness_attempts', async () => {
    const taskId = randomUUID();
    createdTaskIds.push(taskId);
    // 裸 task（payload 无 routing_receipt_id）
    await pool.query(
      "INSERT INTO tasks(id, title, status, payload) VALUES ($1, 'headed-no-receipt', 'in_progress', '{}'::jsonb)",
      [taskId],
    );
    const res = await request(app)
      .post('/api/brain/work-routing/headed-attempts')
      .send({ task_id: taskId, branch: 'cp-headed-test', base_sha: 'a'.repeat(40), session_id: 'sess-1' });
    expect(res.status).toBe(400);
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM harness_attempts WHERE task_bundle->'inputs'->'workspace_spec'->>'branch' = 'cp-headed-test'",
    );
    expect(rows[0].n).toBe(0);
  });

  it('B-03b: branch 非 cp-* → 400（session-* 不可签发）', async () => {
    const taskId = randomUUID();
    createdTaskIds.push(taskId);
    await pool.query(
      "INSERT INTO tasks(id, title, status, payload) VALUES ($1, 'headed-bad-branch', 'in_progress', '{}'::jsonb)",
      [taskId],
    );
    const res = await request(app)
      .post('/api/brain/work-routing/headed-attempts')
      .send({ task_id: taskId, branch: 'session-abc', base_sha: 'a'.repeat(40) });
    expect(res.status).toBe(400);
  });

  // 完整往返（已路由 task → route_token → validate valid:true → completed → 409）需要
  // 一条通过 validate JOIN 全部约束的 work_routing_receipts + active v2 initiative_run。
  // generator 用仓库既有 routing 受理/kernel 授权 fixture（createRoutedTask +
  // createKernelRun / seedOwnedActiveV2Run 同款）真写种子后补齐以下断言：
  it('B-03c: 已路由 task → 201 返回 route_token(64hex) + harness_attempts running/workspace_spec/headed 标记', async () => {
    const seed = await seedRoutedTaskWithActiveRun(pool);
    createdTaskIds.push(seed.taskId);
    const res = await request(app)
      .post('/api/brain/work-routing/headed-attempts')
      .send({ task_id: seed.taskId, branch: seed.branch, base_sha: seed.baseSha, session_id: 'sess-2' });
    expect(res.status).toBe(201);
    expect(res.body.route_token).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.run_id).toBe(seed.runId);
    expect(res.body).not.toHaveProperty('callback_secret');
    const { rows } = await pool.query(
      `SELECT status, role, attempt_kind, lease_owner,
              task_bundle->'inputs'->'workspace_spec'->>'branch' AS branch,
              task_bundle->'inputs'->'workspace_spec'->>'base_sha' AS base_sha
         FROM harness_attempts
        WHERE run_id = $1 AND task_bundle->'inputs'->'workspace_spec'->>'branch' = $2`,
      [seed.runId, seed.branch],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('running');
    expect(['planner', 'proposer', 'reviewer', 'generator', 'evaluator', 'judge', 'reporter']).toContain(rows[0].role);
    expect(['initial', 'fix', 'retry', 'resume', 'recovery']).toContain(rows[0].attempt_kind);
    expect(rows[0].lease_owner).toMatch(/^headed:/);
    expect(rows[0].branch).toBe(seed.branch);
    expect(rows[0].base_sha).toBe(seed.baseSha);
  });

  it('B-04: validate 带 route_token 返回 valid:true；attempt completed 后 409 run_attempt_inactive', async () => {
    const seed = await seedRoutedTaskWithActiveRun(pool);
    createdTaskIds.push(seed.taskId);
    const issue = await request(app)
      .post('/api/brain/work-routing/headed-attempts')
      .send({ task_id: seed.taskId, branch: seed.branch, base_sha: seed.baseSha });
    expect(issue.status).toBe(201);
    const routeToken = issue.body.route_token;

    const ok = await request(app)
      .post('/api/brain/work-routing/validate')
      .set('X-Harness-Route-Token', routeToken)
      .send({
        routing_receipt_id: issue.body.routing_receipt_id,
        task_id: seed.taskId,
        run_id: seed.runId,
        repo: seed.repo,
        branch: seed.branch,
        base_sha: seed.baseSha,
      });
    expect(ok.status).toBe(200);
    expect(ok.body.valid).toBe(true);

    await pool.query(
      "UPDATE harness_attempts SET status='completed', completed_at=NOW() WHERE run_id=$1 AND status='running'",
      [seed.runId],
    );

    const inactive = await request(app)
      .post('/api/brain/work-routing/validate')
      .set('X-Harness-Route-Token', routeToken)
      .send({
        routing_receipt_id: issue.body.routing_receipt_id,
        task_id: seed.taskId,
        run_id: seed.runId,
        repo: seed.repo,
        branch: seed.branch,
        base_sha: seed.baseSha,
      });
    expect(inactive.status).toBe(409);
    expect(inactive.body.reason_code).toBe('run_attempt_inactive');
  });
});

// generator 用仓库既有 fixture 真写：一条满足 validate JOIN 全约束的
// work_routing_receipts（work_kind=coding_mutation, canonical_task_type=harness_initiative,
// pipeline=harness, orchestrator=kernel-harness-v2, router_version=work-router-v1,
// impact_contract_required=true, map_scope=[] …）+ 关联 tasks（payload.harness_runtime=kernel-v1
// + routing_receipt_id 等）+ active v2 initiative_run（orchestrator_version=v2, deadline_at>NOW()）。
// 禁伪造：必须走 createRoutedTask / createKernelRun 真写。
async function seedRoutedTaskWithActiveRun() {
  throw new Error('TODO(generator): 用 createRoutedTask + createKernelRun 真写已路由 task + receipt + active v2 run');
}
