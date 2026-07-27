import { execFileSync } from 'node:child_process';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import approvalRouter from '../../../packages/brain/src/routes/harness-kernel-approvals.js';
import { mergeGate } from '../../../packages/brain/src/orchestrator/gates.js';
import { createKernelHandlers } from '../../../packages/brain/src/orchestrator/kernel-handlers.js';

const APPROVER_TOKEN = 'kernel-contract-token';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const HEAD_SHA = 'a'.repeat(40);
const NEXT_HEAD_SHA = 'b'.repeat(40);
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4379';
const REPO = 'perfectuser21/cecelia';
const PR_NUMBER = 4379;

function createApprovalDatabase(options: {
  currentSha?: string;
  reviewRequestSha?: string;
  runExists?: boolean;
} = {}) {
  const state = {
    insertedDetail: null as null | Record<string, unknown>,
    decisionLog: [{
      hop: 3,
      action: 'effect:human_review_requested' as const,
      observed: { pr: { head_sha: options.reviewRequestSha ?? HEAD_SHA } },
      detail: { dispatch_hop: 2, review_reason: 'awaiting_human_review' },
      created_at: new Date('2026-07-27T18:48:02.000Z'),
    }],
    currentSha: options.currentSha ?? HEAD_SHA,
    runExists: options.runExists ?? true,
  };

  const client = {
    async query(sql: string, params: unknown[] = []) {
      const normalized = String(sql).trim();
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [], rowCount: 0 };
      if (normalized.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
      if (normalized.includes("action='verdict:human_review'") && normalized.includes('SELECT 1')) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes('SELECT COALESCE(MAX(hop), 0) + 1 AS next_hop')) {
        return { rows: [{ next_hop: 4 }], rowCount: 1 };
      }
      if (normalized.includes('UPDATE initiative_runs') && normalized.includes('deadline_at')) {
        return { rows: [], rowCount: 1 };
      }
      if (normalized.includes('INSERT INTO orchestrator_decision_log')) {
        state.insertedDetail = JSON.parse(String(params[4]));
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected transaction query: ${normalized}`);
    },
    release() {},
  };

  const database = {
    async query(sql: string, params: unknown[] = []) {
      const normalized = String(sql).trim();
      if (normalized.includes('FROM initiative_runs r')) {
        if (!state.runExists) return { rows: [], rowCount: 0 };
        return { rows: [{ run_id: RUN_ID, task_id: TASK_ID, pr_url: PR_URL }], rowCount: 1 };
      }
      if (normalized.includes("action='effect:human_review_requested'")) {
        return { rows: [state.decisionLog[0]], rowCount: 1 };
      }
      throw new Error(`unexpected pool query: ${normalized}`);
    },
    async connect() {
      return client;
    },
  };

  return { database, state };
}

function createApp(database: unknown) {
  const app = express();
  app.use(express.json());
  app.set('pool', database);
  app.set('kernelPrHeadResolver', async () => (database as { state?: { currentSha?: string } }).state?.currentSha ?? HEAD_SHA);
  app.use('/api/brain/harness/kernel-reviews', approvalRouter);
  return app;
}

afterEach(() => {
  delete process.env.HARNESS_REVIEW_APPROVER_TOKEN;
});

describe('kernel merge authority contract red tests', () => {
  it('approve route 缺少 repo 或 pr_number 时拒绝且不写 human_review verdict', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { database, state } = createApprovalDatabase();
    (database as { state?: unknown }).state = state;
    const app = createApp(database);

    const response = await request(app)
      .post(`/api/brain/harness/kernel-reviews/${RUN_ID}/approve`)
      .set('x-approver-token', APPROVER_TOKEN)
      .send({
        task_id: TASK_ID,
        pr_head_sha: HEAD_SHA,
        review_request_hop: 3,
        approved_by: 'alex',
      });

    expect(response.status).toBe(400);
    expect(state.insertedDetail).toBeNull();
  });

  it('approve route 记录含 approved_by pr_head_sha source timestamp repo pr_number run_id 的 human_review detail', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { database, state } = createApprovalDatabase();
    (database as { state?: unknown }).state = state;
    const app = createApp(database);

    const response = await request(app)
      .post(`/api/brain/harness/kernel-reviews/${RUN_ID}/approve`)
      .set('x-approver-token', APPROVER_TOKEN)
      .send({
        task_id: TASK_ID,
        repo: REPO,
        pr_number: PR_NUMBER,
        pr_head_sha: HEAD_SHA,
        review_request_hop: 3,
        approved_by: 'alex',
      });

    expect(response.status).toBe(202);
    expect(state.insertedDetail).toMatchObject({
      approved_by: 'alex',
      pr_head_sha: HEAD_SHA,
      source: 'authenticated_route',
      timestamp: expect.any(String),
      repo: REPO,
      pr_number: PR_NUMBER,
      run_id: RUN_ID,
    });
  });

  it('reject route stale SHA 或 run/PR 不匹配时拒绝且不写 human_review verdict', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { database, state } = createApprovalDatabase({ currentSha: NEXT_HEAD_SHA });
    (database as { state?: unknown }).state = state;
    const app = createApp(database);

    const response = await request(app)
      .post(`/api/brain/harness/kernel-reviews/${RUN_ID}/reject`)
      .set('x-approver-token', APPROVER_TOKEN)
      .send({
        task_id: TASK_ID,
        repo: REPO,
        pr_number: PR_NUMBER,
        pr_head_sha: HEAD_SHA,
        review_request_hop: 3,
        rejected_by: 'alex',
      });

    expect(response.status).toBe(409);
    expect(state.insertedDetail).toBeNull();

    const { database: mismatchDb, state: mismatchState } = createApprovalDatabase();
    (mismatchDb as { state?: unknown }).state = mismatchState;
    const mismatchApp = createApp(mismatchDb);
    const mismatch = await request(mismatchApp)
      .post(`/api/brain/harness/kernel-reviews/${RUN_ID}/reject`)
      .set('x-approver-token', APPROVER_TOKEN)
      .send({
        task_id: TASK_ID,
        repo: 'perfectuser21/other-repo',
        pr_number: PR_NUMBER,
        pr_head_sha: HEAD_SHA,
        review_request_hop: 3,
        rejected_by: 'alex',
      });

    expect(mismatch.status).toBe(409);
    expect(mismatchState.insertedDetail).toBeNull();
  });

  it('review_required=true 且无有效 human_review 批准时所有 merge caller 都不能合并', () => {
    const result = mergeGate({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: HEAD_SHA },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: HEAD_SHA },
      prHeadSha: HEAD_SHA,
      reviewRequired: true,
      reviewApproved: false,
      reviewVerdict: null,
    } as never);

    expect(result.allow).toBe(false);
  });

  it('mergeGate 对 stale human approval fail-closed 并要求重跑证据链', () => {
    const result = mergeGate({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      prHeadSha: 'sha-new',
      reviewRequired: true,
      reviewApproved: true,
      reviewVerdict: { approved: true, pr_head_sha: 'sha-old' },
    } as never);

    expect(result.allow).toBe(false);
  });

  it('merge_pr 调用 gh 时必须传 --match-head-commit 当前 head_sha', async () => {
    const execCmd = vi.fn();
    const handlers = createKernelHandlers({
      execCmd,
      pool: { query: vi.fn() },
      attemptStore: { complete: vi.fn() },
      judgeGate: vi.fn(),
      allocatePort: vi.fn(),
      spawnReviewPreview: vi.fn(),
      notifyReview: vi.fn(),
      promote: vi.fn(),
      buildHandoff: vi.fn(),
      saveHandoff: vi.fn(),
      syncOkr: vi.fn(),
      spawnStaging: vi.fn(),
      cleanup: vi.fn(),
    } as never);

    await handlers.merge_pr({
      observed: {
        pr: {
          url: PR_URL,
          head_sha: HEAD_SHA,
          state: 'OPEN',
          merged: false,
          mergeStateStatus: 'CLEAN',
        },
      },
      decisionLog: [],
    } as never);

    expect(execCmd).toHaveBeenCalledWith(expect.stringContaining(`--match-head-commit ${HEAD_SHA}`));
  });

  it('标题 feat(harness) 或 cp- branch 本身不能决定 Harness merge authority', () => {
    const out = execFileSync(
      'bash',
      ['.github/workflows/scripts/should-auto-merge.sh', 'cp-07271848-ws-deadbeef', 'feat(harness): demo'],
      { cwd: '/workspace', encoding: 'utf8' },
    ).trim();

    expect(out).toContain('FAIL_CLOSED');
  });

  it('resolveKernelMergeAuthority 只接受 repo pr_number run_id head_sha 四元组', async () => {
    const mod = await import('../../../packages/brain/src/harness-ci-gate.js');
    expect(typeof (mod as Record<string, unknown>).resolveKernelMergeAuthority).toBe('function');
    const resolver = (mod as Record<string, Function>).resolveKernelMergeAuthority;
    expect(resolver({
      repo: REPO,
      pr_number: PR_NUMBER,
      run_id: RUN_ID,
      head_sha: HEAD_SHA,
    })).toEqual({ kernelOwned: true });
  });
});
