// F1「工厂 · 开发闭环」步骤 2「合同即法律」—— 边：contract-seal 引用完备性校验
//
// r51（run kjjvb6）案卷：合同正文把 sprints/<dir>/task-plan.json 列进范围白名单，
// 但 proposer 从未提交该文件；seal 照常封印，40 分钟后 generate 才按 CONTRACT IS LAW
// 拦停（bundle 缺冻结内容）。修：seal 时扫描合同/PRD 正文中 sprint 内**合同期管理文件**
//（contract-draft/dod、sprint-prd、task-plan、tests/**）的全路径引用，凡引用必须在
// 封印集内，缺席 → 409 contract_references_missing_artifact 即刻打回 contract 格
//（那里重试 5 分钟，比 generate 陪葬便宜一个量级）。
// generator 自产文件（red-evidence.md 等）不在管理家族，引用不受限（零误伤）。
//
// 真 import 被改模块 harness-attempt-run.js（守卫在边上），不 mock 它。
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHarnessAttemptRunRouter } from '../../../packages/brain/src/routes/harness-attempt-run.js';

const DIR = 'sprints/coding-harness-20260903232107-kjjvb6';
const sealBody = {
  run_id: 'cccccccc-0000-0000-0000-000000000003',
  sprint_dir: DIR,
  branch: 'cp-harness-propose-r1-x',
  approved_sha: 'a'.repeat(40),
};

function makeApp({ contractContent, artifacts }) {
  const materializeFn = vi.fn(async () => ({ contract: { id: 'ct-1', version: 1, status: 'approved' } }));
  const router = createHarnessAttemptRunRouter({
    pool: { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) },
    buildDeps: async () => ({ dispatch: vi.fn() }),
    attemptStoreFactory: async () => ({ getById: async () => null }),
    createTaskFn: async () => ({ success: true, task: { id: 'dddddddd-0000-0000-0000-000000000004' } }),
    sealDepsFactory: async () => ({
      collectArtifacts: vi.fn(async () => ({
        artifacts, prdContent: 'PRD', contractContent,
      })),
      materialize: materializeFn,
    }),
  });
  const app = express();
  app.use(express.json());
  app.use('/api/brain/harness', router);
  return { app, materializeFn };
}

const BASE_ARTIFACTS = [
  { path: `${DIR}/contract-draft.md` },
  { path: `${DIR}/contract-dod.md` },
  { path: `${DIR}/sprint-prd.md` },
  { path: `${DIR}/tests/x.contract.test.ts` },
];

describe('F1 step2 — seal 引用完备性（r51 契约）', () => {
  it('合同引用 task-plan.json 但封印集缺席 → 409 contract_references_missing_artifact，不落印', async () => {
    const { app, materializeFn } = makeApp({
      contractContent: `范围白名单：\n  ${DIR}/task-plan.json \\\n  ${DIR}/contract-draft.md`,
      artifacts: BASE_ARTIFACTS,
    });
    const res = await request(app).post('/api/brain/harness/attempt-run/contract-seal').send(sealBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('contract_references_missing_artifact');
    expect(res.body.missing).toContain(`${DIR}/task-plan.json`);
    expect(materializeFn).not.toHaveBeenCalled();
  });

  it('引用的管理文件全在封印集 → 正常落印 200', async () => {
    const { app } = makeApp({
      contractContent: `交付：${DIR}/contract-draft.md 与 ${DIR}/tests/x.contract.test.ts`,
      artifacts: BASE_ARTIFACTS,
    });
    const res = await request(app).post('/api/brain/harness/attempt-run/contract-seal').send(sealBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('引用 generator 自产文件（red-evidence.md）不在管理家族 → 不拦（零误伤）', async () => {
    const { app } = makeApp({
      contractContent: `生成证据：${DIR}/red-evidence.md 会由 generator 写入`,
      artifacts: BASE_ARTIFACTS,
    });
    const res = await request(app).post('/api/brain/harness/attempt-run/contract-seal').send(sealBody);
    expect(res.status).toBe(200);
  });

  it('引用未封印的 tests/ 文件 → 409（tests/** 属管理家族）', async () => {
    const { app } = makeApp({
      contractContent: `冻结测试：${DIR}/tests/missing.contract.test.ts`,
      artifacts: BASE_ARTIFACTS,
    });
    const res = await request(app).post('/api/brain/harness/attempt-run/contract-seal').send(sealBody);
    expect(res.status).toBe(409);
    expect(res.body.missing).toContain(`${DIR}/tests/missing.contract.test.ts`);
  });
});
