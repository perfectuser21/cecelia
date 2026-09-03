// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：桥接派发 × evaluator/judge 服务端权威注入
//
// r40（run nm83sq）双死因案卷：evaluate a1 工人**编造**了格式合法的 base_sha
//（锚 task uuid 前缀续写成 40hex），a2 工人**丢失**了 candidate 坐标——两轮 Commander
// 都正确诊断打回，但画布重试预算耗尽即中止。check-handoffs 只查缺漏与格式，防不住
// 格式合法的编造值。铁律「机械判定不能建立在 LLM 自愿配合上」在坐标转交层的最后残留。
//
// 修（第 73 批）：POST /attempt-run 对 evaluator/judge：
//   a) run_id 必填（400 role_requires_bridge_run）——没有 run 就没有权威源；
//   b) 从本 run 最新 completed generator/generator-fix attempt 的 git_candidate 产物
//      服务端覆写 candidate 五坐标 + base_sha（Worker 抄的值一律不信）；
//   c) 查无候选 → 409 candidate_not_found（fail-fast 留真实原因）。
//
// 真 import 被改模块 harness-attempt-run.js（守卫在边上），不 mock 它。
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHarnessAttemptRunRouter } from '../../../packages/brain/src/routes/harness-attempt-run.js';

const RUN_ID = 'cccccccc-0000-0000-0000-000000000009';
const GEN_RUN_ID = 'eeeeeeee-1111-0000-0000-000000000008';
const GEN_ATTEMPT = '76283ef5-0b9f-491f-8bb0-1d1a118c07e9';
const GIT_CANDIDATE = {
  type: 'git_candidate',
  repo: 'perfectuser21/cecelia',
  branch: 'cp-harness-propose-r1-x-a1',
  base_sha: '8'.repeat(40),
  head_sha: '9'.repeat(40),
  source_attempt_id: GEN_ATTEMPT,
};

function makeApp({ generatorRow } = {}) {
  const pool = {
    query: vi.fn(async (sql) => {
      if (/MAX\(hop\)/.test(sql)) return { rows: [{ hop: 7 }] };
      if (/SELECT orchestrator_host FROM initiative_runs/.test(sql)) return { rows: [{ orchestrator_host: 'v4-bridge' }] };
      if (/role IN \('generator','generator-fix'\)/.test(sql)) {
        if (!/completed_with_concerns/.test(sql)) return { rows: [] }; // 第75批契约：状态过滤必须含 completed_with_concerns
        return { rows: generatorRow === undefined
          ? [{ id: GEN_ATTEMPT, run_id: GEN_RUN_ID, result: { artifacts: ['a-doc.md', GIT_CANDIDATE] } }]
          : (generatorRow ? [generatorRow] : []) };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
  const dispatchFn = vi.fn(async () => ({
    status: 'LAUNCHED', attempt_id: 'aaaaaaaa-0000-0000-0000-000000000001', lease_owner: 'controller-x:1',
  }));
  const createTaskFn = vi.fn(async () => ({ success: true, task: { id: 'dddddddd-0000-0000-0000-000000000004' } }));
  const router = createHarnessAttemptRunRouter({
    pool,
    buildDeps: async () => ({ dispatch: dispatchFn }),
    attemptStoreFactory: async () => ({ getById: async () => null }),
    createTaskFn,
    uuid: () => 'bbbbbbbb-0000-0000-0000-000000000002',
  });
  const app = express();
  app.use(express.json());
  app.use('/api/brain/harness', router);
  return { app, dispatchFn, createTaskFn };
}

function evalBody(extra = {}) {
  return {
    role: 'evaluator',
    title: 'evaluate 候选',
    run_id: RUN_ID,
    payload: {
      sprint_dir: 'sprints/x',
      // Worker 抄来的一律是脏值：服务端必须无视
      base_sha: 'a78b37aa27814051ed14915e01c4224ff90e889d',
      candidate: { repo: 'x/y', branch: 'wrong', head_sha: 'f'.repeat(40) },
      ...extra,
    },
  };
}

describe('F1 step3 — evaluator/judge 服务端权威注入（r40 契约）', () => {
  it('evaluator：candidate 五坐标与 base_sha 被 git_candidate 权威覆写，脏值全部无视', async () => {
    const { app, dispatchFn, createTaskFn } = makeApp();
    const res = await request(app).post('/api/brain/harness/attempt-run').send(evalBody());
    expect(res.status).toBe(202);
    const ctx = dispatchFn.mock.calls[0][1];
    expect(ctx.observed.candidate).toEqual({
      repo: 'perfectuser21/cecelia',
      branch: 'cp-harness-propose-r1-x-a1',
      head_sha: '9'.repeat(40),
      source_attempt_id: GEN_ATTEMPT,
      bridge_run_id: GEN_RUN_ID,
    });
    expect(ctx.observed.task.payload.candidate).toEqual(ctx.observed.candidate);
    expect(ctx.observed.task.payload.base_sha).toBe('8'.repeat(40));
    // 锚 task payload 同样必须是权威值（implementation_baseline source=task_payload）
    const taskPayload = createTaskFn.mock.calls[0][0].payload;
    expect(taskPayload.base_sha).toBe('8'.repeat(40));
    expect(taskPayload.candidate.head_sha).toBe('9'.repeat(40));
  });

  it('judge：同样注入', async () => {
    const { app, dispatchFn } = makeApp();
    const res = await request(app).post('/api/brain/harness/attempt-run').send({ ...evalBody(), role: 'judge' });
    expect(res.status).toBe(202);
    expect(dispatchFn.mock.calls[0][1].observed.candidate.head_sha).toBe('9'.repeat(40));
  });

  it('第74批：工人不带 run_id → 照常按 sprint_dir 注入并把 run 归位到 generator 的 run', async () => {
    const { app, dispatchFn } = makeApp();
    const body = evalBody(); delete body.run_id;
    const res = await request(app).post('/api/brain/harness/attempt-run').send(body);
    expect(res.status).toBe(202);
    expect(res.body.run_id).toBe(GEN_RUN_ID);
    expect(dispatchFn.mock.calls[0][1].observed.candidate.bridge_run_id).toBe(GEN_RUN_ID);
  });

  it('第74批：工人递错 run_id（r42 案卷：拿 contract 的 run 当 generate 的）→ 仍按 sprint_dir 命中并归位', async () => {
    const { app, dispatchFn } = makeApp();
    const res = await request(app).post('/api/brain/harness/attempt-run').send(evalBody());
    expect(res.status).toBe(202);
    expect(res.body.run_id).toBe(GEN_RUN_ID);
    expect(dispatchFn.mock.calls[0][1].runId).toBe(GEN_RUN_ID);
  });

  it('run 内无 completed generator → 409 candidate_not_found，不建任何资源', async () => {
    const { app, createTaskFn } = makeApp({ generatorRow: null });
    const res = await request(app).post('/api/brain/harness/attempt-run').send(evalBody());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('candidate_not_found');
    expect(createTaskFn).not.toHaveBeenCalled();
  });

  it('generator result 无 git_candidate 产物 → 409 candidate_not_found', async () => {
    const { app } = makeApp({ generatorRow: { id: GEN_ATTEMPT, result: { artifacts: ['only-doc.md'] } } });
    const res = await request(app).post('/api/brain/harness/attempt-run').send(evalBody());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('candidate_not_found');
  });

  it('第75批：generator 终态 completed_with_concerns（r43 案卷）→ 候选照常注入', async () => {
    const { app, dispatchFn } = makeApp({ generatorRow: { id: GEN_ATTEMPT, run_id: GEN_RUN_ID, result: { artifacts: [GIT_CANDIDATE] } } });
    const res = await request(app).post('/api/brain/harness/attempt-run').send(evalBody());
    expect(res.status).toBe(202);
    expect(dispatchFn.mock.calls[0][1].observed.candidate.head_sha).toBe('9'.repeat(40));
  });

  it('generator 角色不受影响：无 run_id 照常派发', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/brain/harness/attempt-run').send({
      role: 'generator', title: 'gen', payload: { sprint_dir: 'sprints/x' },
    });
    expect(res.status).toBe(202);
  });
});
