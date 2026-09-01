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
      // 第 59 批起 GET 收尾先查 run host；默认答普通 run（共享 run 场景各测试自建 pool）
      if (/SELECT orchestrator_host FROM initiative_runs/.test(sql)) return { rows: [{ orchestrator_host: 'v4-bridge' }] };
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
// 第 57 批：V4 seal 阶段工具面。kernel 的 seal=materializeApprovedContract（机械校验：
// Test Contract 可解析、artifact projection、防篡改守卫、幂等封印），此前只有 loop 内部
// 能调。HK Worker 拿不到文件全文 → 端点必须由 Brain 自己按 approved_sha 从 git 读回
//（collectApprovedContractArtifacts），Worker 只提供坐标（run_id/sprint_dir/branch/sha）。
// 第 58 批：金丝雀 #8 实证——proposer/reviewer 各自派发时 Brain 现解析 main 头做基线，
// 两次派发之间 main 前进 → 合同里的 base_sha 与 reviewer 的权威基线必然冲突（REVISION
// 死循环）。修法：GET 投影暴露首次派发冻结的 workspace_base_sha，Worker 取出后传给
// 同一 workflow run 的所有后续派发（POST 本就支持显式 base_sha 跳过解析）。
describe('第58批：GET 投影暴露 workspace_base_sha', () => {
  it('GET 返回 task_bundle.inputs.workspace_spec.base_sha 为 workspace_base_sha；bundle 其余内容不泄', async () => {
    const row = {
      id: 'aaaaaaaa-0000-0000-0000-000000000001', run_id: 'r', role: 'planner', status: 'completed',
      result: {}, task_bundle: { inputs: { workspace_spec: { base_sha: 'f'.repeat(40), repo: 'x/y' }, callback_secret: 'NO_LEAK' } },
    };
    const { app } = makeApp({ getById: async () => row });
    const res = await request(app).get('/api/brain/harness/attempt-run/aaaaaaaa-0000-0000-0000-000000000001');
    expect(res.status).toBe(200);
    expect(res.body.workspace_base_sha).toBe('f'.repeat(40));
    expect(res.body.task_bundle).toBeUndefined();
  });

  it('bundle 缺失时 workspace_base_sha=null，不炸', async () => {
    const row = { id: 'aaaaaaaa-0000-0000-0000-000000000001', run_id: 'r', role: 'canary', status: 'completed', result: {} };
    const { app } = makeApp({ getById: async () => row });
    const res = await request(app).get('/api/brain/harness/attempt-run/aaaaaaaa-0000-0000-0000-000000000001');
    expect(res.status).toBe(200);
    expect(res.body.workspace_base_sha).toBe(null);
  });
});

// 第 66 批：V4 publish 阶段工具面。开 PR 是可逆动作可自动，但两条硬规矩：
// ①开 PR 前必须核对远端分支头===head_sha（防漂移候选被发布）；②幂等（同 head 已有
// open PR → 返回既有 PR，不重复开）；③绝不启用 auto-merge（merge 公章归人审线）。
describe('第66批：POST /attempt-run/publish-pr', () => {
  const pubBody = {
    branch: 'cp-harness-propose-r1-x', head_sha: 'a'.repeat(40),
    title: 'Harness approved candidate xyz', body: 'body',
  };
  function makePubApp({ refSha, createStatus = 201, createJson, listPrs } = {}) {
    const calls = [];
    const fetchFn = vi.fn(async (url, opts = {}) => {
      calls.push([url, opts.method ?? 'GET']);
      if (/git\/ref\/heads/.test(url)) return { ok: true, status: 200, json: async () => ({ object: { sha: refSha ?? 'a'.repeat(40) } }) };
      if (/\/pulls\?/.test(url)) return { ok: true, status: 200, json: async () => (listPrs ?? []) };
      if (/\/pulls$/.test(url)) return { ok: createStatus === 201, status: createStatus, json: async () => (createJson ?? { html_url: 'https://github.com/x/y/pull/9', number: 9 }) };
      return { ok: false, status: 500, json: async () => ({}) };
    });
    const router = createHarnessAttemptRunRouter({
      pool: { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) },
      buildDeps: async () => ({ dispatch: vi.fn() }),
      attemptStoreFactory: async () => ({ getById: async () => null }),
      createTaskFn: async () => ({ success: true, task: { id: 'x' } }),
      publishDepsFactory: async () => ({ resolveToken: async () => 'tok', fetchFn }),
    });
    const app = express();
    app.use(express.json());
    app.use('/api/brain/harness', router);
    return { app, fetchFn, calls };
  }

  it('happy：核头一致 → 开 PR → 200 带 pr_url/number；绝不调 auto-merge', async () => {
    const { app, calls } = makePubApp({});
    const res = await request(app).post('/api/brain/harness/attempt-run/publish-pr').send(pubBody);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, pr_url: 'https://github.com/x/y/pull/9', pr_number: 9 });
    expect(calls.some(([url]) => /merge/.test(url))).toBe(false);
  });

  it('防漂移：远端头 ≠ head_sha → 409 publish_head_mismatch，不开 PR', async () => {
    const { app, calls } = makePubApp({ refSha: 'f'.repeat(40) });
    const res = await request(app).post('/api/brain/harness/attempt-run/publish-pr').send(pubBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('publish_head_mismatch');
    expect(calls.some(([url, m]) => /\/pulls$/.test(url) && m === 'POST')).toBe(false);
  });

  it('幂等：422 already exists → 查同 head open PR 返回既有', async () => {
    const { app } = makePubApp({
      createStatus: 422,
      listPrs: [{ html_url: 'https://github.com/x/y/pull/7', number: 7 }],
    });
    const res = await request(app).post('/api/brain/harness/attempt-run/publish-pr').send(pubBody);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, pr_number: 7, existing: true });
  });

  it('负向：branch 非 cp-* / head_sha 非 40hex / 缺 title → 400', async () => {
    const { app } = makePubApp({});
    expect((await request(app).post('/api/brain/harness/attempt-run/publish-pr').send({ ...pubBody, branch: 'main' })).status).toBe(400);
    expect((await request(app).post('/api/brain/harness/attempt-run/publish-pr').send({ ...pubBody, head_sha: 'zzz' })).status).toBe(400);
    expect((await request(app).post('/api/brain/harness/attempt-run/publish-pr').send({ ...pubBody, title: '' })).status).toBe(400);
  });
});

describe('第57批：POST /attempt-run/contract-seal', () => {
  const sealBody = {
    run_id: 'cccccccc-0000-0000-0000-000000000003',
    sprint_dir: 'sprints/x',
    branch: 'cp-harness-propose-r1-x',
    approved_sha: 'a'.repeat(40),
  };
  function makeSealApp({ collect, materialize } = {}) {
    const collectFn = vi.fn(collect ?? (() => ({
      artifacts: [{ path: 'sprints/x/sprint-prd.md' }],
      prdContent: 'PRD', contractContent: 'DRAFT\n\nDOD',
    })));
    const materializeFn = vi.fn(materialize ?? (async () => ({ contract: { id: 'ct-1', version: 1, status: 'approved' } })));
    const router = createHarnessAttemptRunRouter({
      pool: { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) },
      buildDeps: async () => ({ dispatch: vi.fn() }),
      attemptStoreFactory: async () => ({ getById: async () => null }),
      createTaskFn: async () => ({ success: true, task: { id: 'dddddddd-0000-0000-0000-000000000004' } }),
      sealDepsFactory: async () => ({ collectArtifacts: collectFn, materialize: materializeFn }),
    });
    const app = express();
    app.use(express.json());
    app.use('/api/brain/harness', router);
    return { app, collectFn, materializeFn };
  }

  it('happy：坐标齐 → Brain 读回产物并调 materialize（runId/branch/version/prd/contract/artifacts）→ 200', async () => {
    const { app, collectFn, materializeFn } = makeSealApp();
    const res = await request(app).post('/api/brain/harness/attempt-run/contract-seal').send(sealBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(collectFn).toHaveBeenCalledWith(expect.objectContaining({
      sourceRevision: 'a'.repeat(40), sprintDir: 'sprints/x',
    }));
    expect(materializeFn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      runId: sealBody.run_id, branch: sealBody.branch, version: 1,
      prdContent: 'PRD', contractContent: 'DRAFT\n\nDOD',
    }));
  });

  it('负向：缺 approved_sha / 非 40hex → 400；缺 sprint_dir/branch/run_id → 400', async () => {
    const { app } = makeSealApp();
    for (const omit of ['run_id', 'sprint_dir', 'branch', 'approved_sha']) {
      const body = { ...sealBody }; delete body[omit];
      expect((await request(app).post('/api/brain/harness/attempt-run/contract-seal').send(body)).status).toBe(400);
    }
    expect((await request(app).post('/api/brain/harness/attempt-run/contract-seal').send({ ...sealBody, approved_sha: 'zzz' })).status).toBe(400);
  });

  it('负向：机械校验拒绝（FROZEN_* / seal 冲突）→ 409 结构化 code，不吞成 500', async () => {
    const { app } = makeSealApp({
      collect: () => { throw new Error('FROZEN_CONTRACT_ARTIFACTS_MISSING:tests'); },
    });
    const res = await request(app).post('/api/brain/harness/attempt-run/contract-seal').send(sealBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('contract_seal_rejected');
    expect(res.body.detail).toMatch(/FROZEN_CONTRACT_ARTIFACTS_MISSING:tests/);
  });
});

// 第 60 批：generator/evaluator/judge 的 bundle 需要冻结合同（dispatcher 见
// observed.contract.row.id 即自动从 git 装配 collectFrozenContractArtifacts）。
// 桥接此前只给 propose_branch 空壳 → fleet prepare 必 400（generator 预演实证）。
// 第 62 批：fleet 对验证类角色（generator/evaluator）bundle 硬要求 validation clock
//（r71 机制），桥接不带 → prepare 400:validation_clock_required（61 批诊断改进后拿到真码）。
// 第 65 批：judge 派发要求 observed 里有与合同身份一致的 evaluator 权威（dispatcher
// judge_evaluator_authority_mismatch 闸，judge 预演实证）。桥接按 payload.evaluate_attempt_id
// 查 attempt、按 contract_id 查封印表组 identity，组装 evaluateVerdict/evaluateResult。
describe('第65批：judge 桥接组装 evaluator 权威', () => {
  it('judge + evaluate_attempt_id → observed 带 evaluateVerdict/evaluateResult/contract.identity 且身份一致', async () => {
    const evalResult = {
      attempt_id: 'eeeeeeee-0000-4000-8000-000000000005', status: 'completed',
      summary: 's', decision: { outcome: 'FAIL', reason: 'r' }, checks: [],
    };
    const sqls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        sqls.push([sql, params]);
        if (/MAX\(hop\)/.test(sql)) return { rows: [{ hop: 1 }] };
        if (/SELECT orchestrator_host FROM initiative_runs/.test(sql)) return { rows: [{ orchestrator_host: 'v4-bridge' }] };
        if (/initiative_contract_artifact_seals/.test(sql)) return { rows: [{ manifest_sha256: 'a'.repeat(64), source_revision: 'b'.repeat(40) }] };
        return { rows: [], rowCount: 1 };
      }),
    };
    const dispatchFn = vi.fn(async () => ({ status: 'LAUNCHED', attempt_id: 'aaaaaaaa-0000-0000-0000-000000000001' }));
    const router = createHarnessAttemptRunRouter({
      pool,
      buildDeps: async () => ({ dispatch: dispatchFn }),
      attemptStoreFactory: async () => ({ getById: async () => ({ id: 'eeeeeeee-0000-4000-8000-000000000005', status: 'completed', result: evalResult }) }),
      createTaskFn: async () => ({ success: true, task: { id: 'dddddddd-0000-0000-0000-000000000004' } }),
      uuid: () => 'bbbbbbbb-0000-0000-0000-000000000002',
    });
    const app = express();
    app.use(express.json());
    app.use('/api/brain/harness', router);
    const res = await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'judge', title: 'x',
      payload: {
        sprint_dir: 'y',
        contract_id: 'cccccccc-1111-4111-8111-000000000009',
        approved_sha: 'c'.repeat(40),
        evaluate_attempt_id: 'eeeeeeee-0000-4000-8000-000000000005',
        candidate: { repo: 'perfectuser21/cecelia', branch: 'cp-x', head_sha: 'd'.repeat(40) },
      },
    });
    expect(res.status).toBe(202);
    const ctx = dispatchFn.mock.calls[0][1];
    const identity = { contract_id: 'cccccccc-1111-4111-8111-000000000009', manifest_sha256: 'a'.repeat(64), source_revision: 'b'.repeat(40) };
    expect(ctx.observed.contract.identity).toEqual(identity);
    expect(ctx.observed.evaluateVerdict).toMatchObject({
      attempt_id: 'eeeeeeee-0000-4000-8000-000000000005',
      verdict: 'FAIL',
      pr_head_sha: 'd'.repeat(40),
      contract_identity: identity,
    });
    expect(ctx.observed.evaluateResult.attempt_id).toBe('eeeeeeee-0000-4000-8000-000000000005');
  });

  it('judge 带 evaluate_attempt_id 但 attempt 不存在 → 400 结构化', async () => {
    const { app } = makeApp({ getById: async () => null });
    const res = await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'judge', title: 'x',
      payload: { sprint_dir: 'y', contract_id: 'cccccccc-1111-4111-8111-000000000009', evaluate_attempt_id: 'eeeeeeee-0000-4000-8000-000000000005' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('evaluate_attempt_not_found');
  });
});

describe('第62批：验证类角色带 validationClock', () => {
  it('generator 派发 ctx 带 validationClock（pipeline_started_at/deadline_at ISO）', async () => {
    const { app, dispatchFn } = makeApp();
    const res = await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'generator', title: 'x',
      payload: { sprint_dir: 'y', contract_id: 'cccccccc-1111-4111-8111-000000000009', approved_sha: 'c'.repeat(40) },
    });
    expect(res.status).toBe(202);
    const ctx = dispatchFn.mock.calls[0][1];
    expect(typeof ctx.validationClock?.pipeline_started_at).toBe('string');
    expect(typeof ctx.validationClock?.deadline_at).toBe('string');
    expect(new Date(ctx.validationClock.deadline_at).getTime())
      .toBeGreaterThan(new Date(ctx.validationClock.pipeline_started_at).getTime());
  });

  // 第 63 批：fleet 硬校验 钟窗口 === bundle.constraints.timeout_seconds*1000（dispatcher
  // 默认 5400）。桥接钟默认曾是 3600 → validation_clock_invalid（生产预演实证）。两处都读
  // payload.timeout_seconds，默认值必须同为 5400。
  it('第63批：默认钟窗口=5400s（与 dispatcher bundle 默认对齐）', async () => {
    const { app, dispatchFn } = makeApp();
    await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'generator', title: 'x', payload: { sprint_dir: 'y' },
    });
    const clock = dispatchFn.mock.calls[0][1].validationClock;
    expect(new Date(clock.deadline_at).getTime() - new Date(clock.pipeline_started_at).getTime())
      .toBe(5400 * 1000);
  });

  // 第 64 批：judge 无 decisionLog 时 resolveValidationClock 抛 validation_clock_required
  //（kernel 语义要求 generator origin）——桥接改为自构钟（judge 预演实证）。
  it('第64批：judge 同样带钟且窗口=5400s', async () => {
    const { app, dispatchFn } = makeApp();
    const res = await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'judge', title: 'x', payload: { sprint_dir: 'y' },
    });
    expect(res.status).toBe(202);
    const clock = dispatchFn.mock.calls[0][1].validationClock;
    expect(new Date(clock.deadline_at).getTime() - new Date(clock.pipeline_started_at).getTime())
      .toBe(5400 * 1000);
  });

  it('evaluator 同样带钟；canary/planner 不带', async () => {
    const { app, dispatchFn } = makeApp();
    await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'evaluator', title: 'x', payload: { sprint_dir: 'y' },
    });
    expect(dispatchFn.mock.calls[0][1].validationClock?.deadline_at).toBeTruthy();
    await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'canary', title: 'x', payload: { sprint_dir: 'y' },
    });
    expect(dispatchFn.mock.calls[1][1].validationClock).toBeUndefined();
  });
});

describe('第60批：冻结合同身份透传', () => {
  it('payload.contract_id/approved_sha/contract_version → observed.contract.row + approved 标记', async () => {
    const { app, dispatchFn } = makeApp();
    const res = await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'generator', title: 'x',
      payload: {
        sprint_dir: 'sprints/x', branch: 'cp-prop-r1',
        contract_id: 'cccccccc-1111-4111-8111-000000000009',
        approved_sha: 'c'.repeat(40),
        contract_version: 1,
      },
    });
    expect(res.status).toBe(202);
    const ctx = dispatchFn.mock.calls[0][1];
    expect(ctx.observed.contract.approved).toBe(true);
    expect(ctx.observed.contract.row).toMatchObject({
      id: 'cccccccc-1111-4111-8111-000000000009',
      approved_sha: 'c'.repeat(40),
      version: 1,
      propose_branch: 'cp-prop-r1',
    });
  });

  it('不带 contract_id → observed.contract 保持旧形状（不塞 approved/id）', async () => {
    const { app, dispatchFn } = makeApp();
    await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'canary', title: 'x', payload: { sprint_dir: 'y' },
    });
    const ctx = dispatchFn.mock.calls[0][1];
    expect(ctx.observed.contract.approved).toBeUndefined();
    expect(ctx.observed.contract.row.id).toBeUndefined();
  });
});

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
// 第 59 批：金丝雀 #13 实证——GET 自动收尾对共享 run（keep_open）正确跳过了 run 行，
// 但 session/锚 task 的关闭没带 host 守卫：proposer 终态被 GET 一碰，锚 task 即 completed，
// relay-watchdog house-keeping 按「task 完了」把活跃共享 run 收割为 done，级联枪毙刚起跑
// 的 reviewer（parent_run_terminal）。三条收尾 SQL 必须同一 host 语义。
describe('第59批：共享 run 的 GET 收尾守卫', () => {
  it('终态 attempt 挂在 v4-bridge-shared run 上 → GET 不关 session、不关锚 task、不动 run', async () => {
    const row = { id: 'aaaaaaaa-0000-0000-0000-000000000001', run_id: 'r-shared', role: 'proposer', status: 'completed', result: {} };
    const sqls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        sqls.push([sql, params]);
        if (/SELECT orchestrator_host FROM initiative_runs/.test(sql)) return { rows: [{ orchestrator_host: 'v4-bridge-shared' }] };
        return { rows: [], rowCount: 0 };
      }),
    };
    const router = createHarnessAttemptRunRouter({
      pool,
      buildDeps: async () => ({ dispatch: vi.fn() }),
      attemptStoreFactory: async () => ({ getById: async () => row }),
      createTaskFn: async () => ({ success: true, task: { id: 'x' } }),
    });
    const app = express();
    app.use(express.json());
    app.use('/api/brain/harness', router);
    const res = await request(app).get('/api/brain/harness/attempt-run/aaaaaaaa-0000-0000-0000-000000000001');
    expect(res.status).toBe(200);
    expect(sqls.some(([sql]) => /kernel_controller_sessions SET status='closed'/.test(sql))).toBe(false);
    expect(sqls.some(([sql]) => /tasks SET status='completed'/.test(sql))).toBe(false);
    expect(sqls.some(([sql]) => /initiative_runs SET phase='done'/.test(sql))).toBe(false);
  });

  it('终态 attempt 挂在普通 v4-bridge run 上 → 三件套照常收尾', async () => {
    const row = { id: 'aaaaaaaa-0000-0000-0000-000000000001', run_id: 'r-solo', role: 'canary', status: 'completed', result: {} };
    const sqls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        sqls.push([sql, params]);
        if (/SELECT orchestrator_host FROM initiative_runs/.test(sql)) return { rows: [{ orchestrator_host: 'v4-bridge' }] };
        return { rows: [], rowCount: 1 };
      }),
    };
    const router = createHarnessAttemptRunRouter({
      pool,
      buildDeps: async () => ({ dispatch: vi.fn() }),
      attemptStoreFactory: async () => ({ getById: async () => row }),
      createTaskFn: async () => ({ success: true, task: { id: 'x' } }),
    });
    const app = express();
    app.use(express.json());
    app.use('/api/brain/harness', router);
    await request(app).get('/api/brain/harness/attempt-run/aaaaaaaa-0000-0000-0000-000000000001');
    expect(sqls.some(([sql]) => /initiative_runs SET phase='done'/.test(sql))).toBe(true);
    expect(sqls.some(([sql]) => /kernel_controller_sessions SET status='closed'/.test(sql))).toBe(true);
    expect(sqls.some(([sql]) => /tasks SET status='completed'/.test(sql))).toBe(true);
  });
});

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
