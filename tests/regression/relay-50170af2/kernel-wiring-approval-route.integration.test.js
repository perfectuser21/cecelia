import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const TOKEN = 'kernel-approval-token';
const RUN_ID = 'b0000000-0000-4000-8000-00000000000b';
const TASK_ID = 'c0000000-0000-4000-8000-00000000000c';
const SHA = 'approval-head';
const REVIEW_HOP = 14;

function fakePool() {
  const decisionLog = [{
    hop: REVIEW_HOP,
    action: 'effect:human_review_requested',
    observed: { pr: { head_sha: SHA } },
    gate_verdict: 'allow',
    detail: { dispatch_hop: 13 },
  }];
  return {
    decisionLog,
    async query(sql, params) {
      if (sql.includes('FROM initiative_runs') && sql.includes('JOIN tasks')) {
        return {
          rows: [{
            run_id: RUN_ID,
            task_id: TASK_ID,
            pr_url: 'https://github.com/example/repo/pull/42',
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("action='effect:human_review_requested'")) {
        const row = decisionLog.find(
          (candidate) => candidate.hop === Number(params[1])
            && candidate.action === 'effect:human_review_requested',
        );
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes("action='verdict:human_review'") && sql.includes('SELECT')) {
        const rows = decisionLog.filter((row) => row.action === 'verdict:human_review');
        return { rows, rowCount: rows.length };
      }
      if (sql.includes('SELECT COALESCE(MAX(hop)')) {
        return {
          rows: [{
            next_hop: decisionLog.reduce((max, row) => Math.max(max, row.hop), 0) + 1,
          }],
        };
      }
      if (sql.includes('INSERT INTO orchestrator_decision_log')) {
        decisionLog.push({
          hop: params[1],
          action: 'verdict:human_review',
          observed: JSON.parse(params[2]),
          gate_verdict: params[3],
          detail: JSON.parse(params[4]),
        });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

async function makeApp(pool, currentSha = SHA) {
  let router = null;
  try {
    router = (await import('../../../packages/brain/src/routes/harness-kernel-approvals.js')).default;
  } catch {
    // Red phase: absent route deliberately leaves the endpoint at 404.
  }
  const app = express();
  app.use(express.json());
  app.set('pool', pool);
  app.set('kernelPrHeadResolver', async () => currentSha);
  if (router) app.use('/api/brain/harness/kernel-reviews', router);
  return app;
}

function approve(app, {
  token = TOKEN,
  sha = SHA,
  approvedBy = 'alex',
  reviewHop = REVIEW_HOP,
} = {}) {
  const call = request(app)
    .post(`/api/brain/harness/kernel-reviews/${RUN_ID}/approve`);
  if (token != null) call.set('x-approver-token', token);
  return call.send({
    task_id: TASK_ID,
    pr_head_sha: sha,
    review_request_hop: reviewHop,
    approved_by: approvedBy,
  });
}

describe('kernel wiring: authenticated approval route', () => {
  const originalToken = process.env.HARNESS_REVIEW_APPROVER_TOKEN;

  beforeEach(() => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.HARNESS_REVIEW_APPROVER_TOKEN;
    else process.env.HARNESS_REVIEW_APPROVER_TOKEN = originalToken;
  });

  test('mounted route rejects unauthenticated/stale/duplicate approval and valid approval unlocks merge', async () => {
    const pool = fakePool();
    const app = await makeApp(pool);

    expect((await approve(app, { token: null })).status).toBe(401);
    expect((await approve(app, { sha: 'stale-head' })).status).toBe(409);

    const accepted = await approve(app);
    expect(accepted.status).toBe(202);
    expect(accepted.body).toMatchObject({
      ok: true,
      run_id: RUN_ID,
      task_id: TASK_ID,
      pr_head_sha: SHA,
      review_request_hop: REVIEW_HOP,
    });
    expect((await approve(app)).status).toBe(409);

    const approval = pool.decisionLog.find((row) => row.action === 'verdict:human_review');
    expect(approval.detail).toMatchObject({
      verdict: 'APPROVED',
      approved: true,
      pr_head_sha: SHA,
      review_request_hop: REVIEW_HOP,
      approved_by: 'alex',
    });
    expect(approval.detail.approved_at).toEqual(expect.any(String));

    const decision = derive({
      run: { phase: 'review', cost_usd: '0' },
      task: { status: 'in_progress', payload: { review_required: true } },
      prdExists: true,
      contract: { approved: true, id: 'contract-1', row: {} },
      pr: {
        url: 'https://github.com/example/repo/pull/42',
        state: 'OPEN',
        merged: false,
        ci: 'pass',
        head_sha: SHA,
      },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: null, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: SHA },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: SHA },
      reviewRequired: true,
      reviewApproved: approval.detail.verdict === 'APPROVED'
        && approval.detail.pr_head_sha === SHA,
      decisionLog: pool.decisionLog,
      authCircuit: [],
      callbackResult: null,
      counters: {
        hops: pool.decisionLog.length,
        fixRound: 0,
        pollCount: 0,
        noPushStreak: 0,
        noVerdictStreak: 0,
        ganCostUsd: 0,
      },
    });
    expect(decision).toMatchObject({ phase: 'merge', action: 'merge_pr' });

    const serverSource = readFileSync(
      new URL('../../../packages/brain/server.js', import.meta.url),
      'utf8',
    );
    expect(serverSource).toMatch(/harnessKernelApprovalsRouter/);
    expect(serverSource).toMatch(
      /app\.use\('\/api\/brain\/harness\/kernel-reviews',\s*harnessKernelApprovalsRouter\)/,
    );
  });
});
