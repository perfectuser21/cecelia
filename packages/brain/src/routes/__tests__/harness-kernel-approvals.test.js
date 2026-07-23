import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import approvalRouter from '../harness-kernel-approvals.js';

const APPROVER_TOKEN = 'kernel-route-approver-token';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const HEAD_SHA = 'a'.repeat(40);
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4226';

function createApprovalDatabase() {
  const state = {
    queries: [],
    transactionCommands: [],
    insertedDetail: null,
    insertedObserved: null,
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
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes('SELECT COALESCE(MAX(hop), 0) + 1 AS next_hop')) {
        return { rows: [{ next_hop: 4 }], rowCount: 1 };
      }
      if (normalized.includes('INSERT INTO orchestrator_decision_log')) {
        state.insertedObserved = JSON.parse(params[2]);
        state.insertedDetail = JSON.parse(params[4]);
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
        return {
          rows: [{
            hop: 3,
            observed: { pr: { head_sha: HEAD_SHA } },
            detail: { dispatch_hop: 2 },
          }],
          rowCount: 1,
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

function createApp(database) {
  const app = express();
  app.use(express.json());
  app.set('pool', database);
  app.set('kernelPrHeadResolver', async (prUrl) => {
    expect(prUrl).toBe(PR_URL);
    return HEAD_SHA;
  });
  app.use('/kernel-reviews', approvalRouter);
  return app;
}

function approvalRequest(app, { token = APPROVER_TOKEN } = {}) {
  const call = request(app)
    .post(`/kernel-reviews/${RUN_ID}/approve`)
    .send({
      task_id: TASK_ID,
      pr_head_sha: HEAD_SHA,
      review_request_hop: 3,
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

    const response = await approvalRequest(createApp(database), { token: 'wrong-token' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'invalid approver token' });
    expect(state.queries).toHaveLength(0);
  });

  it('accepts a current review request and commits an observable approval verdict', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { database, state } = createApprovalDatabase();

    const response = await approvalRequest(createApp(database));

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
});
