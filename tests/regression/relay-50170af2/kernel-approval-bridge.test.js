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

const ROUTE_TOKEN = 'test-token-abc';
const ROUTE_RUN_ID = '11111111-1111-4111-8111-111111111111';
const ROUTE_TASK_ID = '22222222-2222-4222-8222-222222222222';
const ROUTE_PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4226';
const ROUTE_SHA_A = 'a'.repeat(40);
const ROUTE_SHA_B = 'b'.repeat(40);

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

  return { state, addReviewRound, approve };
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
   * T-17-b: ground-truth reviewApproved 推导：verdict:human_review 行含 approved:true → true（行为测试）
   * C-2b 修复：从 readFileSync 源码扫描升级为真实行为测试。
   * mock pool.query 返回含 action='verdict:human_review', detail.approved=true 的决策日志行，
   * 调用 collectGroundTruth，断言 reviewApproved === true。
   */
  test('T-17-b: reviewApproved 推导：verdict:human_review 行含 approved:true', async () => {
    const { collectGroundTruth } = await import('../../../packages/brain/src/orchestrator/ground-truth.js');

    const headSha = 'sha-approved-b';

    const mockPool = {
      query: async (sql) => {
        if (typeof sql === 'string' && sql.includes('initiative_runs')) {
          return {
            rows: [{
              id: 'run-b',
              phase: 'review',
              contract_id: 'c-b',
              cost_usd: '0',
              pr_url: 'https://github.com/test/repo/pull/77',
            }],
          };
        }
        if (typeof sql === 'string' && sql.includes('initiative_contracts')) {
          return { rows: [{ id: 'c-b', status: 'approved' }] };
        }
        if (typeof sql === 'string' && sql.includes('tasks')) {
          return {
            rows: [{
              id: 'task-b',
              status: 'in_progress',
              payload: JSON.stringify({ review_required: true }),
              title: 'test-b',
              ability_id: null,
            }],
          };
        }
        if (typeof sql === 'string' && sql.includes('orchestrator_decision_log')) {
          return {
            rows: [
              {
                hop: 5,
                action: 'verdict:human_review',
                observed: JSON.stringify({}),
                derived_phase: 'review',
                gate_verdict: null,
                detail: JSON.stringify({
                  approved: true,
                  pr_head_sha: headSha,
                  approved_by: 'alex',
                }),
              },
            ],
          };
        }
        if (typeof sql === 'string' && sql.includes('harness_attempts')) return { rows: [] };
        if (typeof sql === 'string' && sql.includes('account_usage_cache')) return { rows: [] };
        return { rows: [] };
      },
    };

    const observed = await collectGroundTruth(
      {
        pool: mockPool,
        execCmd: (cmd) => {
          if (cmd.includes('gh pr view')) {
            return JSON.stringify({
              state: 'OPEN',
              mergeStateStatus: 'CLEAN',
              headRefOid: headSha,
              statusCheckRollup: [{ state: 'SUCCESS' }],
            });
          }
          if (cmd.includes('git ls-remote')) return '';
          if (cmd.includes('docker ps') && cmd.includes('exited')) return '';
          if (cmd.includes('docker ps')) return '';
          if (cmd.includes('docker inspect')) return JSON.stringify({ ExitCode: 0 });
          return '';
        },
        fileExists: (path) => path.includes('sprint-prd.md'),
        readFile: () => '# PRD content',
      },
      { taskId: 'task-b', runId: 'run-b' },
    );

    expect(observed.reviewApproved).toBe(true);
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
});

// ---- T-17-f: ground-truth reviewApproved 语义与 verdict:human_review 对齐 ----

describe('[BEHAVIOR] B-06 ground-truth reviewApproved 推导', () => {
  test('T-17-f: reviewApproved = true 当 decision log 含 verdict:human_review(approved=true, sha 匹配)', async () => {
    // 直接测试 collectGroundTruth 的 reviewApproved 推导逻辑（用 mock 注入）
    const { collectGroundTruth } = await import('../../../packages/brain/src/orchestrator/ground-truth.js');

    const headSha = 'sha-approved';
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('initiative_runs')) {
          return {
            rows: [{
              id: 'run-1',
              phase: 'review',
              contract_id: 'c1',
              cost_usd: '0',
              pr_url: 'https://github.com/test/repo/pull/99',
            }],
          };
        }
        if (sql.includes('initiative_contracts')) {
          return { rows: [{ id: 'c1', status: 'approved' }] };
        }
        if (sql.includes('tasks')) {
          return {
            rows: [{
              id: 'task-1',
              status: 'in_progress',
              payload: JSON.stringify({ review_required: true }),
              title: 'test',
              ability_id: null,
            }],
          };
        }
        if (sql.includes('orchestrator_decision_log')) {
          return {
            rows: [
              {
                hop: 10,
                action: 'verdict:human_review',
                observed: JSON.stringify({}),
                detail: JSON.stringify({
                  approved: true,
                  pr_head_sha: headSha,
                  approved_by: 'alex',
                }),
              },
            ],
          };
        }
        if (sql.includes('harness_attempts')) return { rows: [] };
        if (sql.includes('account_usage_cache')) return { rows: [] };
        return { rows: [] };
      },
    };

    const mockDeps = {
      pool: mockPool,
      execCmd: (cmd) => {
        if (cmd.includes('gh pr view')) {
          return JSON.stringify({
            state: 'OPEN',
            mergeStateStatus: 'CLEAN',
            headRefOid: headSha,
            statusCheckRollup: [{ state: 'SUCCESS' }],
          });
        }
        if (cmd.includes('git ls-remote')) return '';
        if (cmd.includes('docker ps') && cmd.includes('exited')) return '';
        if (cmd.includes('docker ps')) return '';
        return '';
      },
      fileExists: (path) => path.includes('sprint-prd.md'),
      readFile: () => '# PRD content',
    };

    const observed = await collectGroundTruth(mockDeps, {
      taskId: 'task-1',
      runId: 'run-1',
    });

    // 实现后期望：reviewApproved = true
    // 当前（先红）：decision log 里用 verdict:human_review + approved:true，
    //              但 ground-truth 当前写法是检查 task_events，不读 decision_log 中的 verdict:human_review
    expect(observed.reviewApproved).toBe(true);
  });
});
