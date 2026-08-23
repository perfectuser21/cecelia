/**
 * GP-Anchor: factory/F1 造完真验 #step3
 *
 * r55 (run f51ba12b) 第二层死因：第 26 批的 recollect 止损闸把 run 停在
 * wait:human_review（evidence_insufficient_after_recollect），但这扇门没有出口——
 * ① approve API 对本地候选（发布前，run.pr_url=null）返回 409 run-has-no-pull-request，
 *    人工根本按不下批准键（「评审台不支持本地候选」老 issue 的 kernel-v1 变体）；
 * ② derive 没有任何分支消费该 reason 的 APPROVED verdict:human_review 行，
 *    即使手工落行，重放仍 alreadyRecollected=true → wait，死等到 deadline。
 *
 * 修复：
 * a) loop 落 review 请求行时 detail 带 candidate_head_sha（候选优先头），
 *    给本地候选一个结构化锚；
 * b) approve 路由：run 无 PR 时改用请求行 detail.candidate_head_sha 与调用方
 *    pr_head_sha 全等锚定（同等 SHA 强度），放行批准；
 * c) derive：evidence_insufficient 分支已 recollect 过时，先查匹配的 APPROVED
 *    行（review_request_hop 对应请求行 + pr_head_sha=currentHeadSha）——命中则
 *    人工已认定证据充分，本地候选路由 publish（发布走 CI/merge fence 兜底），
 *    不再死等。
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { __test__ as loopTest } from '../../../packages/brain/src/orchestrator/loop.js';

const CANDIDATE_SHA = 'e'.repeat(40);
const IDENTITY = { contract_id: 'c1', manifest_sha256: 'm1', source_revision: 'r1' };

function observed(decisionLog, overrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    pr: null,
    candidate: { branch: 'cp-route-api-r55', head_sha: CANDIDATE_SHA },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false, action: 'spawn:judge' },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    contract: { approved: true, identity: IDENTITY },
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: CANDIDATE_SHA, contract_identity: IDENTITY },
    judgeVerdict: {
      verdict: 'FAIL',
      failure_class: 'evidence_insufficient',
      pr_head_sha: CANDIDATE_SHA,
      contract_identity: IDENTITY,
    },
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 40, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    decisionLog,
    ...overrides,
  };
}

const recollectSpawn = (hop) => ({
  hop,
  action: 'spawn:evaluator',
  observed: { pr: null, counters: { hops: hop } },
  detail: { reason: 'judge_evidence_insufficient_recollect' },
});
const reviewRequest = (hop) => ({
  hop,
  action: 'effect:human_review_requested',
  observed: { pr: null },
  detail: {
    review_reason: 'evidence_insufficient_after_recollect',
    candidate_head_sha: CANDIDATE_SHA,
    dispatch_hop: hop - 1,
  },
});
const reviewApproved = (hop, requestHop) => ({
  hop,
  action: 'verdict:human_review',
  observed: { pr: null },
  detail: {
    verdict: 'APPROVED',
    approved: true,
    review_class: 'diagnostic',
    pr_head_sha: CANDIDATE_SHA,
    review_request_hop: requestHop,
    approved_by: 'alex',
  },
});

describe('derive：recollect 人审被批准后有出口', () => {
  it('APPROVED 行匹配请求 hop 与候选头 → 本地候选路由 publish，不再 wait', () => {
    const r = derive(observed([
      recollectSpawn(22),
      reviewRequest(31),
      reviewApproved(32, 31),
    ]));
    expect(r.action).not.toBe('wait:human_review');
    expect(r.phase).toBe('publish');
    expect(r.reason).toBe('evidence_insufficient_human_approved');
  });

  it('负向：无批准行 → 仍 wait:human_review（闸语义不回退）', () => {
    const r = derive(observed([
      recollectSpawn(22),
      reviewRequest(31),
    ]));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('evidence_insufficient_after_recollect');
  });

  it('负向：批准行 SHA 不匹配当前候选头 → 不消费，仍 wait', () => {
    const stale = reviewApproved(32, 31);
    stale.detail.pr_head_sha = 'f'.repeat(40);
    const r = derive(observed([
      recollectSpawn(22),
      reviewRequest(31),
      stale,
    ]));
    expect(r.action).toBe('wait:human_review');
  });
});

describe('loop：review 请求 detail 带候选头结构化锚', () => {
  it('humanReviewDetail 输出 candidate_head_sha=候选优先头', () => {
    const detail = loopTest.humanReviewDetail(
      observed([]),
      'evidence_insufficient_after_recollect',
    );
    expect(detail.candidate_head_sha).toBe(CANDIDATE_SHA);
    expect(detail.review_reason).toBe('evidence_insufficient_after_recollect');
  });
});

describe('approve 路由：本地候选（无 PR）可批准', () => {
  const APPROVER_TOKEN = 'kernel-route-approver-token';
  const RUN_ID = '11111111-1111-4111-8111-111111111111';
  const TASK_ID = '22222222-2222-4222-8222-222222222222';
  let approvalRouter;

  beforeEach(async () => {
    vi.resetModules();
    ({ default: approvalRouter } = await import('../../../packages/brain/src/routes/harness-kernel-approvals.js'));
  });

  function buildApp() {
    const decisionLog = [{
      hop: 31,
      action: 'effect:human_review_requested',
      observed: { pr: null },
      detail: {
        review_reason: 'evidence_insufficient_after_recollect',
        candidate_head_sha: CANDIDATE_SHA,
        dispatch_hop: 30,
      },
      created_at: new Date('2026-08-23T07:00:00.000Z'),
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
          return { rows: [{ run_id: RUN_ID, task_id: TASK_ID, pr_url: null }], rowCount: 1 };
        }
        if (normalized.includes("action='effect:human_review_requested'")) {
          return { rows: decisionLog.slice(0, 1), rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      connect: async () => client,
    };
    const app = express();
    app.use(express.json());
    app.set('pool', database);
    app.set('kernelPrHeadResolver', async () => { throw new Error('must not resolve PR for local candidate'); });
    app.use('/api/brain/kernel-reviews', approvalRouter);
    return { app, state };
  }

  it('run 无 PR 时按请求行 candidate_head_sha 锚定放行（不再 409）', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { app, state } = buildApp();
    const res = await request(app)
      .post(`/api/brain/kernel-reviews/${RUN_ID}/approve`)
      .set('x-approver-token', APPROVER_TOKEN)
      .send({ approved_by: 'alex', task_id: TASK_ID, pr_head_sha: CANDIDATE_SHA });
    expect(res.status).toBe(202);
    expect(state.insertedDetail?.approved).toBe(true);
    expect(state.insertedDetail?.pr_head_sha).toBe(CANDIDATE_SHA);
  });

  it('负向：无 PR 且 SHA 与请求行候选头不符 → 409 stale_sha', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { app } = buildApp();
    const res = await request(app)
      .post(`/api/brain/kernel-reviews/${RUN_ID}/approve`)
      .set('x-approver-token', APPROVER_TOKEN)
      .send({ approved_by: 'alex', task_id: TASK_ID, pr_head_sha: 'f'.repeat(40) });
    expect(res.status).toBe(409);
  });
});
