/**
 * kernel-approval-bridge.test.js
 *
 * [BEHAVIOR] B-06：approval bridge fail-closed + 完整认证写 verdict:human_review
 *
 * 当前 harness-pending-reviews.js 已有 HARNESS_REVIEW_APPROVER_TOKEN 认证（PR #4223 实现）。
 * 但 kernel ground-truth.js 的 reviewApproved 推导读 detail.verdict=APPROVED 还是
 * detail.approved===true 需要对齐（FR-12）。
 * 同时需验证旧 SHA 批准和重复批准被拒绝（INV-K7）。
 *
 * Sprint: 07231527-relay-50170af2
 * TASK_ID: 50170af2-fefa-41a7-b0b4-dcf1a5d7b077
 *
 * 修订说明（round-3）：
 * - C-2a 修复：删除内联副本 runAuthenticateApprover，改为从真实模块 import authenticateApprover
 * - C-2b 修复：T-17-b 升级为行为测试（mock pool + collectGroundTruth）
 */

import express from 'express';
import request from 'supertest';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

// ---- 从真实模块导入（C-2a 修复） ----
// harness-pending-reviews.js 是 ES module，直接静态导入
import { authenticateApprover } from '../../../packages/brain/src/routes/harness-pending-reviews.js';
import approvalRouter from '../../../packages/brain/src/routes/harness-kernel-approvals.js';
import {
  assessPostDiffRisk,
  canonicalContractDigest,
} from '../../../packages/brain/src/orchestrator/post-diff-risk-policy.js';

const ROUTE_TOKEN = 'test-token-abc';
const ROUTE_RUN_ID = '11111111-1111-4111-8111-111111111111';
const ROUTE_TASK_ID = '22222222-2222-4222-8222-222222222222';
const ROUTE_PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4226';
const ROUTE_SHA_A = 'a'.repeat(40);
const ROUTE_SHA_B = 'b'.repeat(40);
const REVIEW_CONTRACT_ID = '33333333-3333-4333-8333-333333333333';
const REVIEW_NOW = Date.parse('2026-07-29T00:00:00.000Z');
const REVIEW_CONTRACT_CONTENT = Object.freeze({
  acceptance: Object.freeze(['merge remains safe']),
});
const REVIEW_CONTRACT = Object.freeze({
  id: REVIEW_CONTRACT_ID,
  status: 'approved',
  version: 7,
  approved_at: '2026-07-28T00:00:00.000Z',
  contract_content: REVIEW_CONTRACT_CONTENT,
});
const REVIEW_PR = Object.freeze({
  url: ROUTE_PR_URL,
  repository: 'perfectuser21/cecelia',
  number: 4226,
  head_repository: 'perfectuser21/cecelia',
  head_ref: 'cp-kernel-review-proof',
  head_sha: ROUTE_SHA_A,
  base_repository: 'perfectuser21/cecelia',
  base_ref: 'main',
  base_sha: '9'.repeat(40),
  diff_digest: `sha256:${'8'.repeat(64)}`,
  required_checks: Object.freeze([Object.freeze({
    context: 'ci-passed',
    app_slug: 'github-actions',
    source: 'github-actions',
    run_id: '123456',
    job_id: '789012',
    head_sha: ROUTE_SHA_A,
    conclusion: 'SUCCESS',
  })]),
  files: Object.freeze([Object.freeze({
    path: 'apps/dashboard/src/App.jsx',
    previous_path: null,
    status: 'modified',
    blob_sha: '7'.repeat(40),
    patch_digest: `sha256:${'6'.repeat(64)}`,
    additions: 12,
    deletions: 3,
  })]),
  changed_paths: Object.freeze(['apps/dashboard/src/App.jsx']),
  state: 'OPEN',
  is_draft: false,
  mergeStateStatus: 'CLEAN',
  ci: 'pass',
  merged: false,
});

function canonicalReviewRisk(reviewRequestHop) {
  return assessPostDiffRisk({
    taskId: ROUTE_TASK_ID,
    runId: ROUTE_RUN_ID,
    hop: reviewRequestHop,
    repository: REVIEW_PR.repository,
    headRepository: REVIEW_PR.head_repository,
    headRef: REVIEW_PR.head_ref,
    headSha: REVIEW_PR.head_sha,
    baseRepository: REVIEW_PR.base_repository,
    baseRef: REVIEW_PR.base_ref,
    baseSha: REVIEW_PR.base_sha,
    diffDigest: REVIEW_PR.diff_digest,
    requiredChecks: REVIEW_PR.required_checks,
    files: REVIEW_PR.files,
    contract: {
      id: REVIEW_CONTRACT.id,
      version: REVIEW_CONTRACT.version,
      status: REVIEW_CONTRACT.status,
      approved_at: REVIEW_CONTRACT.approved_at,
      digest: canonicalContractDigest(REVIEW_CONTRACT.contract_content),
    },
    productionReceipt: null,
    callerRisk: 'high',
    evidence: { ci: 'pass', evaluator: null, judge: null },
    now: () => REVIEW_NOW,
  });
}

async function collectReviewGroundTruth({
  reviewRequestHop,
  mutateApprovalRisk = (risk) => risk,
}) {
  const { collectGroundTruth } = await import(
    '../../../packages/brain/src/orchestrator/ground-truth.js'
  );
  const requestRisk = canonicalReviewRisk(reviewRequestHop);
  const approvalRisk = mutateApprovalRisk(structuredClone(requestRisk));
  const decisionLog = [
    {
      hop: reviewRequestHop,
      action: 'effect:human_review_requested',
      observed: {
        pr: { head_sha: REVIEW_PR.head_sha },
        post_diff_risk: requestRisk,
      },
      derived_phase: 'review',
      gate_verdict: null,
      detail: {
        review_reason: 'awaiting_human_review',
        post_diff_risk: requestRisk,
      },
    },
    {
      hop: reviewRequestHop + 1,
      action: 'verdict:human_review',
      observed: { pr: { head_sha: REVIEW_PR.head_sha } },
      derived_phase: 'review',
      gate_verdict: 'allow',
      detail: {
        approved: true,
        review_class: 'merge_gate',
        pr_head_sha: REVIEW_PR.head_sha,
        review_request_hop: reviewRequestHop,
        approved_by: 'alex',
        post_diff_risk: approvalRisk,
      },
    },
  ];
  const mockPool = {
    query: async (sql) => {
      if (sql.includes('FROM initiative_runs')) {
        return {
          rows: [{
            id: ROUTE_RUN_ID,
            phase: 'review',
            contract_id: REVIEW_CONTRACT_ID,
            cost_usd: '0',
            pr_url: ROUTE_PR_URL,
          }],
        };
      }
      if (sql.includes('FROM initiative_contracts')) {
        return { rows: [REVIEW_CONTRACT] };
      }
      if (sql.includes('FROM tasks')) {
        return {
          rows: [{
            id: ROUTE_TASK_ID,
            status: 'in_progress',
            payload: { review_required: true },
            title: 'review authority regression',
            ability_id: null,
          }],
        };
      }
      if (sql.includes('SELECT hop, action, observed')) {
        return { rows: decisionLog };
      }
      return { rows: [] };
    },
  };

  return collectGroundTruth(
    {
      pool: mockPool,
      execCmd: (cmd) => {
        if (cmd.includes('git ls-remote')) return '';
        if (cmd.includes('docker ps')) return '';
        if (cmd.includes('docker inspect')) return JSON.stringify({ ExitCode: 0 });
        return '';
      },
      observePullRequest: async () => structuredClone(REVIEW_PR),
      fileExists: (path) => path.includes('sprint-prd.md'),
      readFile: () => '# PRD content',
      now: () => REVIEW_NOW,
    },
    { taskId: ROUTE_TASK_ID, runId: ROUTE_RUN_ID },
  );
}

// ---- helper: 构建 mock request/response ----

function mockReq({ headers = {}, body = {}, params = {} } = {}) {
  return {
    get: (name) => headers[name.toLowerCase()] ?? headers[name],
    headers,
    body,
    params,
    app: { get: () => null },
    ip: '127.0.0.1',
  };
}

function mockRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) { res._status = code; return res; },
    json(body) { res._body = body; return res; },
    send(body) { res._body = body; return res; },
  };
  return res;
}

function createRealApprovalHarness() {
  const state = {
    currentSha: ROUTE_SHA_A,
    decisionLog: [{
      hop: 3,
      action: 'effect:human_review_requested',
      observed: { pr: { head_sha: ROUTE_SHA_A } },
      gate_verdict: 'allow',
      detail: { dispatch_hop: 2 },
      created_at: new Date('2026-07-23T00:00:00.000Z'),
    }],
    transactionCommands: [],
  };

  const query = async (sql, params = []) => {
    const normalized = String(sql).trim();
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) {
      state.transactionCommands.push(normalized);
      return { rows: [], rowCount: 0 };
    }
    if (normalized.includes('FROM initiative_runs r')) {
      return {
        rows: [{
          run_id: ROUTE_RUN_ID,
          task_id: ROUTE_TASK_ID,
          pr_url: ROUTE_PR_URL,
        }],
        rowCount: 1,
      };
    }
    if (normalized.includes("action='effect:human_review_requested'")) {
      const row = state.decisionLog.find(
        (candidate) => candidate.hop === Number(params[1])
          && candidate.action === 'effect:human_review_requested',
      );
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (normalized.includes('pg_advisory_xact_lock')) {
      return { rows: [{}], rowCount: 1 };
    }
    if (normalized.includes("action='verdict:human_review'") && normalized.includes('SELECT 1')) {
      let rows = state.decisionLog.filter(
        (candidate) => candidate.action === 'verdict:human_review',
      );
      // The old route asks whether the run has any approval. The fixed route must
      // include the SHA predicate and pass currentSha as $2.
      if (normalized.includes("detail->>'pr_head_sha'")) {
        rows = rows.filter((candidate) => candidate.detail.pr_head_sha === params[1]);
      }
      if (normalized.includes("detail->>'review_request_hop'")) {
        rows = rows.filter(
          (candidate) => String(candidate.detail.review_request_hop) === String(params[2]),
        );
      }
      return { rows: rows.slice(0, 1), rowCount: Math.min(rows.length, 1) };
    }
    if (normalized.includes('SELECT COALESCE(MAX(hop), 0) + 1 AS next_hop')) {
      return {
        rows: [{
          next_hop: state.decisionLog.reduce(
            (maxHop, row) => Math.max(maxHop, Number(row.hop)),
            0,
          ) + 1,
        }],
        rowCount: 1,
      };
    }
    if (normalized.includes('INSERT INTO orchestrator_decision_log')) {
      state.decisionLog.push({
        hop: Number(params[1]),
        action: 'verdict:human_review',
        observed: JSON.parse(params[2]),
        gate_verdict: params[3],
        detail: JSON.parse(params[4]),
      });
      return { rows: [], rowCount: 1 };
    }
    if (normalized.includes('UPDATE initiative_runs') && normalized.includes('deadline_at')) {
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected approval test query: ${normalized}`);
  };

  const client = {
    query,
    release() {},
  };
  const database = {
    query,
    async connect() {
      return client;
    },
  };
  const app = express();
  app.use(express.json());
  app.set('pool', database);
  app.set('kernelPrHeadResolver', async (prUrl) => {
    expect(prUrl).toBe(ROUTE_PR_URL);
    return state.currentSha;
  });
  app.use('/api/brain/harness/kernel-reviews', approvalRouter);

  const addReviewRound = (sha) => {
    const nextHop = state.decisionLog.reduce(
      (maxHop, row) => Math.max(maxHop, Number(row.hop)),
      0,
    ) + 1;
    state.currentSha = sha;
    state.decisionLog.push({
      hop: nextHop,
      action: 'effect:human_review_requested',
      observed: { pr: { head_sha: sha } },
      gate_verdict: 'allow',
      detail: { dispatch_hop: nextHop - 1 },
      created_at: new Date('2026-07-23T01:00:00.000Z'),
    });
    return nextHop;
  };

  const approve = ({ sha = state.currentSha, reviewHop = 3 } = {}) => request(app)
    .post(`/api/brain/harness/kernel-reviews/${ROUTE_RUN_ID}/approve`)
    .set('x-approver-token', ROUTE_TOKEN)
    .send({
      task_id: ROUTE_TASK_ID,
      pr_head_sha: sha,
      review_request_hop: reviewHop,
      approved_by: 'alex',
    });

  const reject = ({ sha = state.currentSha, reviewHop = 3 } = {}) => request(app)
    .post(`/api/brain/harness/kernel-reviews/${ROUTE_RUN_ID}/reject`)
    .set('x-approver-token', ROUTE_TOKEN)
    .send({
      task_id: ROUTE_TASK_ID,
      pr_head_sha: sha,
      review_request_hop: reviewHop,
      rejected_by: 'alex',
    });

  return { state, addReviewRound, approve, reject };
}

describe('[BEHAVIOR] B-06 approval bridge 认证', () => {
  const ORIGINAL_TOKEN = process.env.HARNESS_REVIEW_APPROVER_TOKEN;

  beforeEach(() => {
    // 清理环境变量
    delete process.env.HARNESS_REVIEW_APPROVER_TOKEN;
  });

  afterEach(() => {
    if (ORIGINAL_TOKEN !== undefined) {
      process.env.HARNESS_REVIEW_APPROVER_TOKEN = ORIGINAL_TOKEN;
    } else {
      delete process.env.HARNESS_REVIEW_APPROVER_TOKEN;
    }
  });

  /**
   * T-17-a: token 未配置 → 503 fail-closed（行为测试）
   * 调用真实 authenticateApprover，HARNESS_REVIEW_APPROVER_TOKEN 未配置时返回 503。
   */
  test('T-17-a: token 未配置 → 503 fail-closed', () => {
    // HARNESS_REVIEW_APPROVER_TOKEN 已在 beforeEach 中 delete
    const req = mockReq({ headers: {}, body: { approved_by: 'alex' } });
    const res = mockRes();

    const result = authenticateApprover(req, res);

    expect(result.ok).toBe(false);
    expect(res._status).toBe(503);
    expect(res._body).toMatchObject({ error: 'approver token not configured' });
  });

  /**
   * T-17-b: ground-truth reviewApproved 推导：同 SHA、request hop、diff、
   * contract 与 policy 的 canonical proof 全匹配才为 true（行为测试）。
   * C-2b 修复：从 readFileSync 源码扫描升级为真实行为测试。
   * 调用 collectGroundTruth，验证 server-derived post_diff_risk 与批准证明完全一致。
   */
  test('T-17-b: reviewApproved 只接受同 SHA merge-gate request 的 approved verdict', async () => {
    const observed = await collectReviewGroundTruth({ reviewRequestHop: 4 });

    expect(observed.reviewApproved).toBe(true);
    expect(observed.postDiffRisk).toEqual(canonicalReviewRisk(4));
  });

  test('T-17-c: 旧 SHA 批准 → 409（真实 Router）', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = ROUTE_TOKEN;
    const { approve } = createRealApprovalHarness();

    const response = await approve({ sha: 'c'.repeat(40) });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: 'stale_sha' });
  });

  test('T-17-d: 同 SHA 重复批准 → 409 且只写一行（真实 Router）', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = ROUTE_TOKEN;
    const { state, approve } = createRealApprovalHarness();

    expect((await approve()).status).toBe(202);
    expect((await approve()).status).toBe(409);
    expect(state.decisionLog.filter(
      (row) => row.action === 'verdict:human_review'
        && row.detail.pr_head_sha === ROUTE_SHA_A,
    )).toHaveLength(1);
  });

  test('T-17-e: 同 run 两轮 review 的两个 SHA 各批准一次（真实 Router）', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = ROUTE_TOKEN;
    const { state, addReviewRound, approve } = createRealApprovalHarness();

    expect((await approve()).status).toBe(202);
    const shaBReviewHop = addReviewRound(ROUTE_SHA_B);
    const secondApproval = await approve({
      sha: ROUTE_SHA_B,
      reviewHop: shaBReviewHop,
    });

    expect(secondApproval.status).toBe(202);
    expect(state.decisionLog.filter(
      (row) => row.action === 'verdict:human_review'
        && row.detail.pr_head_sha === ROUTE_SHA_A,
    )).toHaveLength(1);
    expect(state.decisionLog.filter(
      (row) => row.action === 'verdict:human_review'
        && row.detail.pr_head_sha === ROUTE_SHA_B,
    )).toHaveLength(1);
  });

  test('T-17-g: 同 SHA 的两个 review request hop 各可批准一次（真实 Router）', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = ROUTE_TOKEN;
    const { state, addReviewRound, approve } = createRealApprovalHarness();

    expect((await approve()).status).toBe(202);
    const secondReviewHop = addReviewRound(ROUTE_SHA_A);
    expect((await approve({ reviewHop: secondReviewHop })).status).toBe(202);
    expect(state.decisionLog.filter(
      (row) => row.action === 'verdict:human_review'
        && row.detail.pr_head_sha === ROUTE_SHA_A,
    )).toHaveLength(2);
  });

  test('T-17-h: reject 经真实认证 Router 写入终局 verdict', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = ROUTE_TOKEN;
    const { state, reject } = createRealApprovalHarness();

    const response = await reject();

    expect(response.status).toBe(202);
    expect(state.decisionLog.find(
      (row) => row.action === 'verdict:human_review',
    )).toMatchObject({
      gate_verdict: 'deny:human_review_rejected',
      detail: {
        verdict: 'REJECTED',
        rejected: true,
        approved: false,
        review_request_hop: 3,
      },
    });
  });
});

// ---- T-17-f: ground-truth reviewApproved 语义与 verdict:human_review 对齐 ----

describe('[BEHAVIOR] B-06 ground-truth reviewApproved 推导', () => {
  test('T-17-f: diff-bound post_diff_risk 不匹配时同 SHA 批准仍 fail-closed', async () => {
    const observed = await collectReviewGroundTruth({
      reviewRequestHop: 9,
      mutateApprovalRisk: (risk) => ({
        ...risk,
        bindings: {
          ...risk.bindings,
          diff_hash: `sha256:${'5'.repeat(64)}`,
        },
      }),
    });

    expect(observed.reviewApproved).toBe(false);
  });
});
