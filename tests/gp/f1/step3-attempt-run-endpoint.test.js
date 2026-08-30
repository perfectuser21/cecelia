// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：V4 画布 Worker 的单角色 attempt 接线
//
// 决策 bc242b62（08-30）：coding 迁 V4 骨架，kernel 编排层退役、fleet 派发保留为工具。
// V4 dev Worker 需要一个 HTTP 面「派发一个角色 attempt 并轮询 harness_attempts.result」，
// 此前不存在（attempt-telemetry 刻意剔除 result）。本断言锁死薄端点的边：
// a) POST：角色白名单、sprint_dir 必填、复用 dispatch 且 ctx 不携带 task_type/work_kind
//    （绕 routing receipt 的既有口子）、run 行写 orchestrator_version='v2'；
// b) POST：dispatch 未 LAUNCHED → 502 带 detail，不假装成功；
// c) GET：返回含 result/failure_class 的投影；不存在 → 404。
//
// 真 import 路由模块（被改的边），pool/dispatch/attemptStore 注入 fake。
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createHarnessAttemptRunRouter, ALLOWED_ROLES } from '../../../packages/brain/src/routes/harness-attempt-run.js';

function makeApp({ dispatch, getById } = {}) {
  const sqls = [];
  const pool = {
    query: vi.fn(async (sql, params) => {
      sqls.push([sql, params]);
      if (/MAX\(hop\)/.test(sql)) return { rows: [{ hop: 7 }] };
      return { rows: [], rowCount: 1 };
    }),
  };
  const dispatchFn = vi.fn(dispatch ?? (async () => ({
    status: 'LAUNCHED', attempt_id: 'aaaaaaaa-0000-0000-0000-000000000001', lease_owner: 'controller-x:1',
  })));
  const store = { getById: vi.fn(getById ?? (async () => null)) };
  const createTaskFn = vi.fn(async () => ({ success: true, task: { id: 'dddddddd-0000-0000-0000-000000000004' } }));
  const router = createHarnessAttemptRunRouter({
    pool,
    buildDeps: async () => ({ dispatch: dispatchFn }),
    attemptStoreFactory: async () => store,
    createTaskFn,
    uuid: () => 'bbbbbbbb-0000-0000-0000-000000000002',
  });
  const app = express();
  app.use(express.json());
  app.use('/api/brain/harness', router);
  return { app, pool, sqls, dispatchFn, store, createTaskFn };
}

describe('POST /api/brain/harness/attempt-run', () => {
  it('happy：canary 角色 → 建 v2 run 行、按 MAX(hop)+1 派发、202 带 attempt_id', async () => {
    const { app, sqls, dispatchFn, createTaskFn } = makeApp();
    const res = await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'canary',
      title: 'v4 桥接连通性金丝雀',
      payload: { sprint_dir: '/var/empty/v4-bridge', role_assignments: { reporter: { provider: 'codex', account: 'team1' } } },
    });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      status: 'LAUNCHED',
      run_id: 'bbbbbbbb-0000-0000-0000-000000000002',
      attempt_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      role: 'canary',
    });
    // migration 375 硬约束：v2 run 行必须带 current_task_id（FK→tasks）与 created_source；
    // task 锚必须走正门 createTask（inventory 守卫禁止直接 INSERT INTO tasks），status 直接
    // in_progress 防 tick 捡走。
    expect(createTaskFn).toHaveBeenCalledWith(expect.objectContaining({
      status: 'in_progress',
      allow_unscoped: true,
      source_id: 'v4-bridge:bbbbbbbb-0000-0000-0000-000000000002',
    }));
    // 主权闸（migration 423）：先建 active controller 会话，run 的租约字段从会话行复制。
    const sessionInsert = sqls.find(([sql]) => /INSERT INTO kernel_controller_sessions/.test(sql));
    expect(sessionInsert).toBeTruthy();
    expect(sessionInsert[0]).toMatch(/'active'/);
    const runInsert = sqls.find(([sql]) => /INSERT INTO initiative_runs/.test(sql));
    expect(runInsert).toBeTruthy();
    expect(runInsert[0]).toMatch(/'v2'/);
    expect(runInsert[0]).toMatch(/current_task_id/);
    expect(runInsert[0]).toMatch(/created_source/);
    expect(runInsert[0]).toMatch(/FROM kernel_controller_sessions/);
    expect(dispatchFn).toHaveBeenCalledWith('spawn:canary', expect.objectContaining({
      hop: 7,
      runId: 'bbbbbbbb-0000-0000-0000-000000000002',
    }));
    const ctx = dispatchFn.mock.calls[0][1];
    expect(ctx.observed.task.task_type).toBeUndefined();
    expect(ctx.observed.task.payload.work_kind).toBeUndefined();
  });

  it('复用调用方给的 run_id（同一 V4 run 多阶段共享）；work_kind 被剥离', async () => {
    const { app, dispatchFn } = makeApp();
    const res = await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'planner',
      title: 'plan 阶段',
      run_id: 'cccccccc-0000-0000-0000-000000000003',
      payload: { sprint_dir: 'sprints/x', work_kind: 'coding_mutation' },
    });
    expect(res.status).toBe(202);
    expect(res.body.run_id).toBe('cccccccc-0000-0000-0000-000000000003');
    expect(dispatchFn.mock.calls[0][1].observed.task.payload.work_kind).toBeUndefined();
  });

  it('负向：角色不在白名单 → 400；缺 title / sprint_dir → 400', async () => {
    const { app } = makeApp();
    expect((await request(app).post('/api/brain/harness/attempt-run').send({ role: 'commander', title: 'x', payload: { sprint_dir: 'y' } })).status).toBe(400);
    expect((await request(app).post('/api/brain/harness/attempt-run').send({ role: 'canary', payload: { sprint_dir: 'y' } })).status).toBe(400);
    expect((await request(app).post('/api/brain/harness/attempt-run').send({ role: 'canary', title: 'x' })).status).toBe(400);
    expect(ALLOWED_ROLES).not.toContain('commander');
  });

  it('负向：dispatch 被闸（DONE_WITH_CONCERNS/BLOCKED）→ 502 带 detail，不假装成功', async () => {
    const { app } = makeApp({
      dispatch: async () => ({ status: 'DONE_WITH_CONCERNS', control_status: 'BLOCKED', fallback_reason: 'node_not_base_admitted' }),
    });
    const res = await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'evaluator', title: 'x', payload: { sprint_dir: 'y' },
    });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: 'dispatch_not_launched', control_status: 'BLOCKED', detail: 'node_not_base_admitted' });
  });
});

describe('GET /api/brain/harness/attempt-run/:id', () => {
  it('返回含 result / failure_class 的投影（attempt-telemetry 不给的字段这里必须给）', async () => {
    const row = {
      id: 'aaaaaaaa-0000-0000-0000-000000000001', run_id: 'r', role: 'canary', status: 'completed',
      result: { decision: { outcome: 'CANARY_OK' } }, failure_class: null, error_code: null, error_message: null,
      provider: 'codex', account_id: 'team1', requested_machine_id: 'us-mac-m4', actual_machine_id: 'us-mac-m4',
      execution_transport: 'local-docker', machine_attestation_status: 'local',
      started_at: 't1', completed_at: 't2', created_at: 't0', updated_at: 't2',
      callback_secret_hash: 'MUST_NOT_LEAK', lease_owner: 'x',
    };
    const { app, sqls } = makeApp({ getById: async () => row });
    const res = await request(app).get('/api/brain/harness/attempt-run/aaaaaaaa-0000-0000-0000-000000000001');
    expect(res.status).toBe(200);
    // 终态自动收尾：桥接 run→done、session→closed（只动 created_source='v4-bridge'）
    expect(sqls.some(([sql]) => /SET phase='done'/.test(sql) && /orchestrator_host = 'v4-bridge'/.test(sql))).toBe(true);
    expect(sqls.some(([sql]) => /kernel_controller_sessions SET status='closed'/.test(sql))).toBe(true);
    expect(res.body.result).toEqual({ decision: { outcome: 'CANARY_OK' } });
    expect(res.body.status).toBe('completed');
    expect(res.body.callback_secret_hash).toBeUndefined();
    expect(res.body.lease_owner).toBeUndefined();
  });

  it('负向：不存在 → 404', async () => {
    const { app } = makeApp({ getById: async () => null });
    expect((await request(app).get('/api/brain/harness/attempt-run/xx')).status).toBe(404);
  });
});
