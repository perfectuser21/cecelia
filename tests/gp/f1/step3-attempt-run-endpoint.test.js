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
      // 第 73 批：evaluator/judge 派发前服务端从本 run 的 generator attempt 取 git_candidate
      // 权威坐标——默认答一份合法候选，让既有 judge/evaluator 用例继续走通。
      if (/role IN \('generator','generator-fix'\)/.test(sql)) {
        return { rows: [{ id: '76283ef5-0b9f-491f-8bb0-1d1a118c07e9', run_id: 'cccccccc-0000-0000-0000-000000000009', result: { artifacts: [{
          type: 'git_candidate', repo: 'perfectuser21/cecelia', branch: 'cp-harness-propose-r1-x-a1',
          base_sha: '8'.repeat(40), head_sha: 'a'.repeat(40),
          source_attempt_id: '76283ef5-0b9f-491f-8bb0-1d1a118c07e9',
        }] } }] };
      }
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
// 第 67 批（决策 3d7d64e1，封版唯一例外）：merge-pr 端点执行已获人审批准的合并。
// 公章语义：Alex 点人审卡片=批准；端点=执行已批决定（画布只有人审后才到 merge 格）。
// 防线：①合并前核对 PR 当前头===head_sha（批哪个头合哪个头）②GitHub merge 带 sha 双保险
// ③只合 cp-*→main ④幂等（已合并返回既有）。
describe('第67批：POST /attempt-run/merge-pr', () => {
  const mergeBody = { pr_number: 9, head_sha: 'a'.repeat(40) };
  function makeMergeApp({ prJson, mergeStatus = 200, mergeJson } = {}) {
    const calls = [];
    const fetchFn = vi.fn(async (url, opts = {}) => {
      calls.push([url, opts.method ?? 'GET', opts.body]);
      if (/\/pulls\/9$/.test(url)) return { ok: true, status: 200, json: async () => (prJson ?? {
        state: 'open', merged: false, number: 9,
        head: { sha: 'a'.repeat(40), ref: 'cp-harness-propose-r1-x' }, base: { ref: 'main' },
      }) };
      if (/\/pulls\/9\/merge$/.test(url)) return { ok: mergeStatus === 200, status: mergeStatus, json: async () => (mergeJson ?? { merged: true, sha: 'm'.repeat(40) }) };
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
    return { app, calls };
  }

  it('happy：头一致 → squash merge（带 sha 双保险）→ 200 merged', async () => {
    const { app, calls } = makeMergeApp({});
    const res = await request(app).post('/api/brain/harness/attempt-run/merge-pr').send(mergeBody);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, merged: true });
    const mergeCall = calls.find(([url, m]) => /\/merge$/.test(url) && m === 'PUT');
    expect(mergeCall).toBeTruthy();
    const body = JSON.parse(mergeCall[2]);
    expect(body).toMatchObject({ merge_method: 'squash', sha: 'a'.repeat(40) });
  });

  it('防漂移：PR 当前头 ≠ 批准头 → 409 merge_head_mismatch，不合并', async () => {
    const { app, calls } = makeMergeApp({ prJson: {
      state: 'open', merged: false, number: 9,
      head: { sha: 'f'.repeat(40), ref: 'cp-x' }, base: { ref: 'main' },
    } });
    const res = await request(app).post('/api/brain/harness/attempt-run/merge-pr').send(mergeBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('merge_head_mismatch');
    expect(calls.some(([url, m]) => /\/merge$/.test(url))).toBe(false);
  });

  it('防越权：base 非 main 或分支非 cp-* → 409', async () => {
    const { app } = makeMergeApp({ prJson: {
      state: 'open', merged: false, number: 9,
      head: { sha: 'a'.repeat(40), ref: 'feature/x' }, base: { ref: 'main' },
    } });
    const res = await request(app).post('/api/brain/harness/attempt-run/merge-pr').send(mergeBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('merge_branch_not_allowed');
  });

  it('幂等：PR 已 merged → 200 existing，不再调 merge', async () => {
    const { app, calls } = makeMergeApp({ prJson: {
      state: 'closed', merged: true, number: 9, merge_commit_sha: 'm'.repeat(40),
      head: { sha: 'a'.repeat(40), ref: 'cp-x' }, base: { ref: 'main' },
    } });
    const res = await request(app).post('/api/brain/harness/attempt-run/merge-pr').send(mergeBody);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, merged: true, existing: true });
    expect(calls.some(([url]) => /\/merge$/.test(url))).toBe(false);
  });

  it('参数闸：pr_number 非正整数 / head_sha 非 40hex → 400', async () => {
    const { app } = makeMergeApp({});
    expect((await request(app).post('/api/brain/harness/attempt-run/merge-pr').send({ pr_number: 0, head_sha: 'a'.repeat(40) })).status).toBe(400);
    expect((await request(app).post('/api/brain/harness/attempt-run/merge-pr').send({ pr_number: 9, head_sha: 'zzz' })).status).toBe(400);
  });
});

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

// 第 70 批（金丝雀 #37 案卷）：seal 把合同产物封进 initiative_contract_artifacts，但桥接
// 派发 generator 时 observed.contract.artifacts 为空 → bundle 缺 contract-draft/dod 全文
// → generator 按 CONTRACT IS LAW 正确拒绝（needs_context FROZEN_CONTRACT_ARTIFACTS_MISSING）。
// 修法：payload.contract_id 存在时从封印表装回全套产物。

// 第 69 批（决策 d2de68fb，止损评估方案A）：金丝雀 #31/#36 两次死于「Worker 忘带
// keep_open」——旗标依赖物理消除：generator/generator-fix 角色无条件建共享 run
//（候选保留工作区必须活到 judge），不看 payload 有没有旗标。

describe('第54批：桥接 run 生命周期', () => {

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
    const taskClose = sqls.find(([sql]) => /tasks SET status = 'completed'/.test(sql));
    expect(taskClose).toBeTruthy();
    expect(taskClose[0]).toMatch(/trigger_source = 'v4_bridge'/);
    expect(taskClose[0]).toMatch(/current_task_id FROM initiative_runs/);
    expect(taskClose[0]).not.toMatch(/source_id/);
  });

  it('GET 终态自动收尾必须连锚 task 一起 completed（52 批漏关，in_progress 泄漏）', async () => {
    const row = { id: 'aaaaaaaa-0000-0000-0000-000000000001', run_id: 'r', role: 'canary', status: 'completed', result: {} };
    const { app, sqls } = makeApp({ getById: async () => row });
    await request(app).get('/api/brain/harness/attempt-run/aaaaaaaa-0000-0000-0000-000000000001');
    const taskClose = sqls.find(([sql]) => /tasks SET status = 'completed'/.test(sql));
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
    expect(sqls.some(([sql]) => /tasks SET status = 'completed'/.test(sql))).toBe(false);
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
    expect(sqls.some(([sql]) => /tasks SET status = 'completed'/.test(sql))).toBe(true);
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

describe('退役Kernel创建入口，历史读回/收尾保留',()=>{
 it.each([...ALLOWED_ROLES,'commander','unknown'])('role %s cannot create a run/task/session or dispatch',async role=>{
  const {app,pool,dispatchFn,createTaskFn}=makeApp();
  const response=await request(app).post('/api/brain/harness/attempt-run').send({role,title:'legacy',run_id:'11111111-1111-4111-8111-111111111111',payload:{sprint_dir:'old',keep_open:true}});
  expect(response.status).toBe(410);expect(response.body.error).toBe('kernel_runtime_retired');
  expect(pool.query).not.toHaveBeenCalled();expect(dispatchFn).not.toHaveBeenCalled();expect(createTaskFn).not.toHaveBeenCalled();
 });
});
