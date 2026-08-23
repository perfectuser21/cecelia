/**
 * GP-Anchor: factory/F1 造完真验 #step3
 *
 * 第 28 批之路由/文案两件：
 *
 * ③ r57 实证：run 有 PR 但 fix 后候选未发布（PR 头滞后），approve API 按 PR 头
 *    锚定，derive 按候选头消费——批准永远无效，只能 psql 手术。
 *    修复：请求行 detail.candidate_head_sha 存在且等于调用方 pr_head_sha 时，
 *    优先候选头路径放行（即使 run 有 PR），批准行记候选头。
 * ④ r59 实证：封印拒绝反馈固定写「表必须逐行登记」，UNRESOLVABLE（文件不存在）
 *    时误导 proposer 改表不建文件，两轮同错判死。
 *    修复：按 code 分文案。
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sealRejectionInstruction } from '../../../packages/brain/src/orchestrator/dispatcher.js';

const CANDIDATE_SHA = 'b'.repeat(40);
const STALE_PR_SHA = 'c'.repeat(40);
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const APPROVER_TOKEN = 'kernel-route-approver-token';

describe('④ seal_rejection 反馈按 code 分文案（r59 案卷）', () => {
  it('UNRESOLVABLE → 指示创建并 commit 测试文件，不再是「逐行登记」', () => {
    const text = sealRejectionInstruction('FROZEN_CONTRACT_TEST_CONTRACT_UNRESOLVABLE');
    expect(text).toMatch(/创建|commit/);
    expect(text).not.toMatch(/逐行登记/);
  });

  it('UNREGISTERED → 逐行登记指引', () => {
    expect(sealRejectionInstruction('FROZEN_CONTRACT_TEST_CONTRACT_UNREGISTERED')).toMatch(/逐行登记/);
  });

  it('FRAGILE_GREP → 稳健断言指引', () => {
    expect(sealRejectionInstruction('FROZEN_CONTRACT_TEST_CONTRACT_FRAGILE_GREP')).toMatch(/断言/);
  });

  it('未知 code → 通用指引（非空）', () => {
    const text = sealRejectionInstruction('FROZEN_CONTRACT_SOMETHING_NEW');
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(10);
  });
});

describe('③ approve 路由：有 PR 但候选未发布时按候选头放行（r57 案卷）', () => {
  let approvalRouter;
  beforeEach(async () => {
    vi.resetModules();
    ({ default: approvalRouter } = await import('../../../packages/brain/src/routes/harness-kernel-approvals.js'));
  });

  function buildApp() {
    const decisionLog = [{
      hop: 31,
      action: 'effect:human_review_requested',
      observed: { pr: { head_sha: STALE_PR_SHA } },
      detail: {
        review_reason: 'evidence_insufficient_after_recollect',
        candidate_head_sha: CANDIDATE_SHA,
        dispatch_hop: 30,
      },
      created_at: new Date('2026-08-24T00:00:00.000Z'),
    }];
    const state = { insertedDetail: null };
    const client = {
      async query(sql, params = []) {
        const normalized = String(sql).trim();
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [], rowCount: 0 };
        if (normalized.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
        if (normalized.includes("action='verdict:human_review'") && normalized.includes('SELECT 1')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('COALESCE(MAX(hop), 0) + 1')) return { rows: [{ next_hop: 32 }], rowCount: 1 };
        if (normalized.includes('INSERT INTO orchestrator_decision_log')) {
          state.insertedDetail = JSON.parse(params[4]);
          return { rows: [], rowCount: 1 };
        }
        if (normalized.includes('UPDATE initiative_runs')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
    const database = {
      async query(sql, params = []) {
        const normalized = String(sql).trim();
        if (normalized.includes('FROM initiative_runs r')) {
          return { rows: [{ run_id: RUN_ID, task_id: TASK_ID, pr_url: 'https://github.com/x/y/pull/1' }], rowCount: 1 };
        }
        if (normalized.includes("action='effect:human_review_requested'")) {
          if (normalized.includes('candidate_head_sha') && params[1] === CANDIDATE_SHA) {
            return { rows: decisionLog.slice(0, 1), rowCount: 1 };
          }
          if (normalized.includes("observed->'pr'->>'head_sha'")) {
            return { rows: decisionLog.filter((r) => r.observed?.pr?.head_sha === params[1]), rowCount: 1 };
          }
          return { rows: decisionLog.slice(0, 1), rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      connect: async () => client,
    };
    const app = express();
    app.use(express.json());
    app.set('pool', database);
    // PR 头解析返回滞后头——候选头路径不得依赖它
    app.set('kernelPrHeadResolver', async () => STALE_PR_SHA);
    app.use('/api/brain/kernel-reviews', approvalRouter);
    return { app, state };
  }

  it('调用方传候选头（≠PR 头）→ 202 放行，批准行锚候选头', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { app, state } = buildApp();
    const res = await request(app)
      .post(`/api/brain/kernel-reviews/${RUN_ID}/approve`)
      .set('x-approver-token', APPROVER_TOKEN)
      .send({ approved_by: 'alex', task_id: TASK_ID, pr_head_sha: CANDIDATE_SHA });
    expect(res.status).toBe(202);
    expect(state.insertedDetail?.pr_head_sha).toBe(CANDIDATE_SHA);
  });

  it('负向：传 PR 头且请求行按 PR 头能找到时仍走 PR 路径（现行为不回退）', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { app, state } = buildApp();
    const res = await request(app)
      .post(`/api/brain/kernel-reviews/${RUN_ID}/approve`)
      .set('x-approver-token', APPROVER_TOKEN)
      .send({ approved_by: 'alex', task_id: TASK_ID, pr_head_sha: STALE_PR_SHA });
    expect(res.status).toBe(202);
    expect(state.insertedDetail?.pr_head_sha).toBe(STALE_PR_SHA);
  });

  it('负向：传的 SHA 两路都锚不上 → 409', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { app } = buildApp();
    const res = await request(app)
      .post(`/api/brain/kernel-reviews/${RUN_ID}/approve`)
      .set('x-approver-token', APPROVER_TOKEN)
      .send({ approved_by: 'alex', task_id: TASK_ID, pr_head_sha: 'f'.repeat(40) });
    expect(res.status).toBe(409);
  });
});
