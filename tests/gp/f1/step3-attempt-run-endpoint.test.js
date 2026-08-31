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

  // 第 53 批：ctx.taskId / observed.task.id 必须是锚 task id，不能拿 runId 冒充。
  // 冒充的后果（生产实证 attempt f6059e0f）：①bundle.inputs.task_id=runId → planner 回执被
  // migration 428 权威触发器拒（source_task_id ≠ run.current_task_id）→ 回执 500 无限重试；
  // ②执行体查 /api/brain/tasks/<runId> 404，拿不到 payload.thin_prd。
  it('第53批：派发 ctx 用锚 task id（taskId/observed.task.id），runId 只走 runId 字段', async () => {
    const { app, dispatchFn } = makeApp();
    const res = await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'planner', title: 'x', payload: { sprint_dir: 'y' },
    });
    expect(res.status).toBe(202);
    const ctx = dispatchFn.mock.calls[0][1];
    expect(ctx.taskId).toBe('dddddddd-0000-0000-0000-000000000004');
    expect(ctx.observed.task.id).toBe('dddddddd-0000-0000-0000-000000000004');
    expect(ctx.observed.run.id).toBe('bbbbbbbb-0000-0000-0000-000000000002');
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

  // 第 52 批：派发失败不许留孤儿活跃桥接资源（51 批首夜留了 3 条活跃 run，人工 SQL 清的）。
  it('第52批：dispatch 未 LAUNCHED 且 run 是本调用新建 → 回滚 run→failed、session→closed、task 锚→cancelled', async () => {
    const { app, sqls } = makeApp({
      dispatch: async () => ({ status: 'DONE_WITH_CONCERNS', control_status: 'BLOCKED', fallback_reason: 'node_not_base_admitted' }),
    });
    const res = await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'canary', title: 'x', payload: { sprint_dir: 'y' },
    });
    expect(res.status).toBe(502);
    expect(sqls.some(([sql]) => /initiative_runs SET phase='failed'/.test(sql) && /orchestrator_host IN \('v4-bridge','v4-bridge-shared'\)/.test(sql))).toBe(true);
    expect(sqls.some(([sql]) => /kernel_controller_sessions SET status='closed'/.test(sql) && /source = 'v4-bridge'/.test(sql))).toBe(true);
    const taskRollback = sqls.find(([sql]) => /tasks SET status='cancelled'/.test(sql));
    expect(taskRollback).toBeTruthy();
    expect(taskRollback[0]).toMatch(/trigger_source = 'v4_bridge'/);
    expect(taskRollback[1]).toEqual(['dddddddd-0000-0000-0000-000000000004']);
  });

  it('第52批：dispatch 抛异常 → 500 且同样回滚（不留活跃 run）', async () => {
    const { app, sqls } = makeApp({
      dispatch: async () => { throw new Error('remote_bridge_prepare_http_503'); },
    });
    const res = await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'canary', title: 'x', payload: { sprint_dir: 'y' },
    });
    expect(res.status).toBe(500);
    expect(res.body.detail).toMatch(/remote_bridge_prepare_http_503/);
    expect(sqls.some(([sql]) => /initiative_runs SET phase='failed'/.test(sql))).toBe(true);
  });

  it('第52批：复用已存在的 run_id 时派发失败 → 绝不回滚（run/session/task 属于更早的调用）', async () => {
    const sqls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        sqls.push([sql, params]);
        if (/SELECT id FROM initiative_runs/.test(sql)) return { rows: [{ id: params[0] }] };
        if (/MAX\(hop\)/.test(sql)) return { rows: [{ hop: 2 }] };
        return { rows: [], rowCount: 1 };
      }),
    };
    const router = createHarnessAttemptRunRouter({
      pool,
      buildDeps: async () => ({ dispatch: async () => ({ status: 'DONE_WITH_CONCERNS', control_status: 'BLOCKED' }) }),
      attemptStoreFactory: async () => ({ getById: async () => null }),
      createTaskFn: async () => ({ success: true, task: { id: 'dddddddd-0000-0000-0000-000000000004' } }),
      uuid: () => 'bbbbbbbb-0000-0000-0000-000000000002',
    });
    const app = express();
    app.use(express.json());
    app.use('/api/brain/harness', router);
    const res = await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'planner', title: 'x', run_id: 'cccccccc-0000-0000-0000-000000000003', payload: { sprint_dir: 'y' },
    });
    expect(res.status).toBe(502);
    expect(sqls.some(([sql]) => /SET phase='failed'/.test(sql))).toBe(false);
    expect(sqls.some(([sql]) => /SET status='cancelled'/.test(sql))).toBe(false);
  });
});

// 第 54 批：桥接 run 生命周期（金丝雀 #6b 实证：contract 阶段 proposer/reviewer 各开独立
// run+全新 workspace，proposer 的 contract_artifacts 对 reviewer 不可见 → 同阶段多角色必须
// 共享 run。52 批的 GET 自动收尾会在首个角色终态后立刻关 run，故：keep_open 建
// orchestrator_host='v4-bridge-shared' 的 run（GET 收尾天然跳过），配显式 close 口；
// 且一切收尾路径必须连锚 task 一起闭合（此前 GET 收尾漏关锚 task，in_progress 泄漏）。
// 第 56 批：金丝雀 #7 实证——reviewer 的 workspace 由 observed.proposeBranch/proposeBranchSha
// 决定（dispatcher.js reviewer 段），proposer 的由 observed.plannerPrdArtifact，evaluator/judge
// 的由 observed.candidate。桥接此前不透传 → reviewer 永远在 main 的全新 workspace 里找不到
// proposer 推的合同产物（连续两发金丝雀 REVISION）。
describe('第56批：角色续接字段透传', () => {
  it('第56批：payload 的续接字段映射进 observed（proposeBranch/Sha/Rn、plannerPrdArtifact、candidate）', async () => {
    const { app, dispatchFn } = makeApp();
    const res = await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'reviewer',
      title: 'contract review',
      payload: {
        sprint_dir: 'sprints/x',
        propose_branch: 'cp-harness-propose-r1-dddddddd-rbbbbbbbb-a1',
        propose_branch_sha: 'a'.repeat(40),
        propose_branch_rn: 1,
        planner_prd_artifact: { kind: 'planner_prd', path: 'sprints/x/sprint-prd.md', branch: 'cp-prd', head_sha: 'b'.repeat(40), verification_status: 'verified' },
        candidate: { branch: 'cp-cand', head_sha: 'c'.repeat(40) },
      },
    });
    expect(res.status).toBe(202);
    const ctx = dispatchFn.mock.calls[0][1];
    expect(ctx.observed.proposeBranch).toBe('cp-harness-propose-r1-dddddddd-rbbbbbbbb-a1');
    expect(ctx.observed.proposeBranchSha).toBe('a'.repeat(40));
    expect(ctx.observed.proposeBranchRn).toBe(1);
    expect(ctx.observed.plannerPrdArtifact).toMatchObject({ verification_status: 'verified', head_sha: 'b'.repeat(40) });
    expect(ctx.observed.candidate).toMatchObject({ branch: 'cp-cand' });
  });

  it('第56批：不传续接字段 → observed 里不出现这些键（不给 dispatcher 塞 null 干扰兜底链）', async () => {
    const { app, dispatchFn } = makeApp();
    await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'canary', title: 'x', payload: { sprint_dir: 'y' },
    });
    const ctx = dispatchFn.mock.calls[0][1];
    expect('proposeBranch' in ctx.observed).toBe(false);
    expect('plannerPrdArtifact' in ctx.observed).toBe(false);
    expect('candidate' in ctx.observed).toBe(false);
  });
});

describe('第54批：桥接 run 生命周期', () => {
  it('keep_open:true → run 建成 orchestrator_host=v4-bridge-shared（GET 自动收尾不会碰它）', async () => {
    const { app, sqls } = makeApp();
    const res = await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'proposer', title: 'x', keep_open: true, payload: { sprint_dir: 'y' },
    });
    expect(res.status).toBe(202);
    const runInsert = sqls.find(([sql]) => /INSERT INTO initiative_runs/.test(sql));
    expect(runInsert[1]).toContain('v4-bridge-shared');
  });

  it('POST /attempt-run/close → run→done、session→closed、锚 task→completed（双 host 值都认）', async () => {
    const { app, sqls } = makeApp();
    const res = await request(app).post('/api/brain/harness/attempt-run/close').send({
      run_id: 'cccccccc-0000-0000-0000-000000000003',
    });
    expect(res.status).toBe(200);
    expect(sqls.some(([sql]) => /SET phase='done'/.test(sql) && /'v4-bridge-shared'/.test(sql))).toBe(true);
    expect(sqls.some(([sql]) => /kernel_controller_sessions SET status='closed'/.test(sql))).toBe(true);
    // 第 55 批：tasks 表没有 source_id 列（54 批 SQL 真库必炸）——锚 task 必须经
    // initiative_runs.current_task_id 定位。
    const taskClose = sqls.find(([sql]) => /tasks SET status='completed'/.test(sql));
    expect(taskClose).toBeTruthy();
    expect(taskClose[0]).toMatch(/trigger_source = 'v4_bridge'/);
    expect(taskClose[0]).toMatch(/current_task_id FROM initiative_runs/);
    expect(taskClose[0]).not.toMatch(/source_id/);
  });

  it('GET 终态自动收尾必须连锚 task 一起 completed（52 批漏关，in_progress 泄漏）', async () => {
    const row = { id: 'aaaaaaaa-0000-0000-0000-000000000001', run_id: 'r', role: 'canary', status: 'completed', result: {} };
    const { app, sqls } = makeApp({ getById: async () => row });
    await request(app).get('/api/brain/harness/attempt-run/aaaaaaaa-0000-0000-0000-000000000001');
    const taskClose = sqls.find(([sql]) => /tasks SET status='completed'/.test(sql));
    expect(taskClose).toBeTruthy();
    expect(taskClose[0]).toMatch(/trigger_source = 'v4_bridge'/);
    expect(taskClose[0]).toMatch(/current_task_id FROM initiative_runs/);
    expect(taskClose[0]).not.toMatch(/source_id/);
  });
});

// 第 55 批：54 批的锚 task 收尾 SQL 引用了不存在的 tasks.source_id 列（source_id 实际
// 存在 work_routing_receipts；GP fake pool 测不出列名，真库 GET 轮询终态即 500）。
describe('第55批：收尾 SQL 列名', () => {
  it('第55批：一切锚 task 收尾 SQL 禁引用 tasks.source_id，必须经 run.current_task_id 定位', async () => {
    const row = { id: 'aaaaaaaa-0000-0000-0000-000000000001', run_id: 'r', role: 'canary', status: 'completed', result: {} };
    const { app, sqls } = makeApp({ getById: async () => row });
    await request(app).get('/api/brain/harness/attempt-run/aaaaaaaa-0000-0000-0000-000000000001');
    await request(app).post('/api/brain/harness/attempt-run/close').send({ run_id: 'cccccccc-0000-0000-0000-000000000003' });
    const taskCloses = sqls.filter(([sql]) => /UPDATE tasks SET/.test(sql));
    expect(taskCloses.length).toBeGreaterThanOrEqual(2);
    for (const [sql] of taskCloses) {
      expect(sql).not.toMatch(/source_id/);
      expect(sql).toMatch(/current_task_id FROM initiative_runs/);
    }
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
