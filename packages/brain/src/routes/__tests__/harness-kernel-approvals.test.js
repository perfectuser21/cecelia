import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import approvalRouter from '../harness-kernel-approvals.js';

const APPROVER_TOKEN = 'kernel-route-approver-token';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const HEAD_SHA = 'a'.repeat(40);
const NEXT_HEAD_SHA = 'b'.repeat(40);
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4226';
const REVIEW_REQUESTED_AT = new Date('2026-07-23T00:00:00.000Z');

function createApprovalDatabase() {
  const state = {
    queries: [],
    transactionCommands: [],
    insertedDetail: null,
    insertedObserved: null,
    deadlineExtension: null,
    decisionLog: [{
      hop: 3,
      action: 'effect:human_review_requested',
      observed: { pr: { head_sha: HEAD_SHA } },
      detail: { dispatch_hop: 2 },
      created_at: REVIEW_REQUESTED_AT,
    }],
    currentSha: HEAD_SHA,
    released: false,
  };

  const client = {
    async query(sql, params = []) {
      const normalized = String(sql).trim();
      state.queries.push({ scope: 'client', sql: normalized, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) {
        state.transactionCommands.push(normalized);
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes('pg_advisory_xact_lock')) {
        return { rows: [{}], rowCount: 1 };
      }
      if (normalized.includes("action='verdict:human_review'") && normalized.includes('SELECT 1')) {
        let rows = state.decisionLog.filter((row) => row.action === 'verdict:human_review');
        if (normalized.includes("detail->>'pr_head_sha'")) {
          rows = rows.filter((row) => row.detail.pr_head_sha === params[1]);
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
        state.insertedObserved = JSON.parse(params[2]);
        state.insertedDetail = JSON.parse(params[4]);
        state.decisionLog.push({
          hop: Number(params[1]),
          action: 'verdict:human_review',
          observed: state.insertedObserved,
          gate_verdict: params[3],
          detail: state.insertedDetail,
        });
        return { rows: [], rowCount: 1 };
      }
      if (normalized.includes('UPDATE initiative_runs') && normalized.includes('deadline_at')) {
        state.deadlineExtension = { sql: normalized, params };
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected transaction query: ${normalized}`);
    },
    release() {
      state.released = true;
    },
  };

  const database = {
    async query(sql, params = []) {
      const normalized = String(sql).trim();
      state.queries.push({ scope: 'pool', sql: normalized, params });
      if (normalized.includes('FROM initiative_runs r')) {
        return {
          rows: [{ run_id: RUN_ID, task_id: TASK_ID, pr_url: PR_URL }],
          rowCount: 1,
        };
      }
      if (normalized.includes("action='effect:human_review_requested'")) {
        const row = state.decisionLog.find(
          (candidate) => candidate.hop === Number(params[1])
            && candidate.action === 'effect:human_review_requested',
        );
        return {
          rows: row ? [row] : [],
          rowCount: row ? 1 : 0,
        };
      }
      throw new Error(`unexpected pool query: ${normalized}`);
    },
    async connect() {
      return client;
    },
  };

  return { database, state };
}

function createApp(database, state) {
  const app = express();
  app.use(express.json());
  app.set('pool', database);
  app.set('kernelPrHeadResolver', async (prUrl) => {
    expect(prUrl).toBe(PR_URL);
    return state.currentSha;
  });
  app.use('/kernel-reviews', approvalRouter);
  return app;
}

function approvalRequest(app, {
  token = APPROVER_TOKEN,
  sha = HEAD_SHA,
  reviewRequestHop = 3,
} = {}) {
  const call = request(app)
    .post(`/kernel-reviews/${RUN_ID}/approve`)
    .send({
      task_id: TASK_ID,
      pr_head_sha: sha,
      review_request_hop: reviewRequestHop,
      approved_by: 'review-owner',
    });
  if (token !== null) call.set('x-approver-token', token);
  return call;
}

describe('harness-kernel-approvals mounted Router behavior', () => {
  afterEach(() => {
    delete process.env.HARNESS_REVIEW_APPROVER_TOKEN;
  });

  it('rejects an invalid approver token before any database access', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { database, state } = createApprovalDatabase();

    const response = await approvalRequest(createApp(database, state), { token: 'wrong-token' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'invalid approver token' });
    expect(state.queries).toHaveLength(0);
  });

  it('accepts a current review request and commits an observable approval verdict', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { database, state } = createApprovalDatabase();

    const response = await approvalRequest(createApp(database, state));

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      ok: true,
      run_id: RUN_ID,
      task_id: TASK_ID,
      pr_head_sha: HEAD_SHA,
      review_request_hop: 3,
      approved_by: 'review-owner',
    });
    expect(state.insertedObserved).toEqual({
      pr: { head_sha: HEAD_SHA },
      review_request_hop: 3,
    });
    expect(state.insertedDetail).toMatchObject({
      verdict: 'APPROVED',
      approved: true,
      pr_head_sha: HEAD_SHA,
      review_request_hop: 3,
      approved_by: 'review-owner',
    });
    expect(state.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
    expect(state.released).toBe(true);
  });

  it('adds the open human-review wait back to deadline in the approval transaction', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { database, state } = createApprovalDatabase();

    const response = await approvalRequest(createApp(database, state));

    expect(response.status).toBe(202);
    const requestRead = state.queries.find(
      ({ scope, sql }) => scope === 'pool'
        && sql.includes("action='effect:human_review_requested'"),
    );
    expect(requestRead?.sql).toMatch(/\bcreated_at\b/);
    expect(state.deadlineExtension).not.toBeNull();
    expect(state.deadlineExtension.sql).toMatch(
      /UPDATE initiative_runs[\s\S]*deadline_at[\s\S]*NOW\(\)/i,
    );
    expect(state.deadlineExtension.params).toContain(RUN_ID);
    expect(state.deadlineExtension.params.some(
      (value) => new Date(value).getTime() === REVIEW_REQUESTED_AT.getTime(),
    )).toBe(true);
    const updateIndex = state.queries.findIndex(
      ({ scope, sql }) => scope === 'client'
        && sql.includes('UPDATE initiative_runs')
        && sql.includes('deadline_at'),
    );
    const commitIndex = state.queries.findIndex(({ sql }) => sql === 'COMMIT');
    expect(updateIndex).toBeGreaterThan(-1);
    expect(commitIndex).toBeGreaterThan(updateIndex);
  });

  it('allows one approval per GitHub head SHA in the same run', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { database, state } = createApprovalDatabase();
    const app = createApp(database, state);

    expect((await approvalRequest(app)).status).toBe(202);
    expect((await approvalRequest(app)).status).toBe(409);

    state.currentSha = NEXT_HEAD_SHA;
    state.decisionLog.push({
      hop: 5,
      action: 'effect:human_review_requested',
      observed: { pr: { head_sha: NEXT_HEAD_SHA } },
      detail: { dispatch_hop: 4 },
      created_at: new Date('2026-07-23T01:00:00.000Z'),
    });
    const secondSha = await approvalRequest(app, {
      sha: NEXT_HEAD_SHA,
      reviewRequestHop: 5,
    });

    expect(secondSha.status).toBe(202);
    expect(state.decisionLog.filter(
      (row) => row.action === 'verdict:human_review'
        && row.detail.pr_head_sha === HEAD_SHA,
    )).toHaveLength(1);
    expect(state.decisionLog.filter(
      (row) => row.action === 'verdict:human_review'
        && row.detail.pr_head_sha === NEXT_HEAD_SHA,
    )).toHaveLength(1);
  });
});
