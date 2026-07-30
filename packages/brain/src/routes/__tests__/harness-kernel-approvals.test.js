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
      detail: { dispatch_hop: 2, review_reason: 'awaiting_human_review' },
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
        if (normalized.includes("detail->>'review_request_hop'")) {
          rows = rows.filter(
            (row) => String(row.detail.review_request_hop) === String(params[2]),
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

function rejectionRequest(app, {
  token = APPROVER_TOKEN,
  sha = HEAD_SHA,
  reviewRequestHop = 3,
} = {}) {
  const call = request(app)
    .post(`/kernel-reviews/${RUN_ID}/reject`)
    .send({
      task_id: TASK_ID,
      pr_head_sha: sha,
      review_request_hop: reviewRequestHop,
      rejected_by: 'review-owner',
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
      review_class: 'merge_gate',
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

  it('allows approvals for two GitHub head SHAs in the same run', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { database, state } = createApprovalDatabase();
    const app = createApp(database, state);

    expect((await approvalRequest(app)).status).toBe(202);

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

  it('allows two review-request hops on the same SHA exactly once each', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { database, state } = createApprovalDatabase();
    const app = createApp(database, state);

    expect((await approvalRequest(app)).status).toBe(202);
    state.decisionLog.push({
      hop: 5,
      action: 'effect:human_review_requested',
      observed: { pr: { head_sha: HEAD_SHA } },
      detail: { dispatch_hop: 4, review_reason: 'failure_set_repeated' },
      created_at: new Date('2026-07-23T01:00:00.000Z'),
    });

    expect((await approvalRequest(app, { reviewRequestHop: 5 })).status).toBe(202);
    expect(state.insertedDetail).toMatchObject({
      review_class: 'convergence',
      review_request_hop: 5,
    });
    expect((await approvalRequest(app, { reviewRequestHop: 5 })).status).toBe(409);
    expect(state.decisionLog.filter(
      (row) => row.action === 'verdict:human_review'
        && row.detail.pr_head_sha === HEAD_SHA,
    )).toHaveLength(2);
  });

  it('authenticated reject records one terminal human verdict for its request', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const { database, state } = createApprovalDatabase();
    const app = createApp(database, state);

    const response = await rejectionRequest(app);

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      ok: true,
      run_id: RUN_ID,
      review_request_hop: 3,
      rejected_by: 'review-owner',
    });
    expect(state.insertedDetail).toMatchObject({
      verdict: 'REJECTED',
      approved: false,
      rejected: true,
      pr_head_sha: HEAD_SHA,
      review_request_hop: 3,
      rejected_by: 'review-owner',
    });
    expect(state.decisionLog.filter(
      (row) => row.action === 'verdict:human_review',
    )).toHaveLength(1);
    expect((await rejectionRequest(app)).status).toBe(409);
  });

  it('lists each unanswered context request with its exact version anchor', async () => {
    const database = {
      query: async () => ({
        rows: [{
          run_id: RUN_ID,
          task_id: TASK_ID,
          task_title: 'Repair Kernel convergence',
          context_request_hop: 8,
          detail: {
            callback_hop: 7,
            context_version: 'context-v1:7:attempt-7',
            question: 'Which rollback policy should be used?',
          },
          created_at: REVIEW_REQUESTED_AT,
        }],
      }),
    };
    const app = express();
    app.use(express.json());
    app.set('pool', database);
    app.use('/kernel-reviews', approvalRouter);

    const response = await request(app).get('/kernel-reviews/contexts');

    expect(response.status).toBe(200);
    expect(response.body.contexts).toEqual([{
      run_id: RUN_ID,
      task_id: TASK_ID,
      task_title: 'Repair Kernel convergence',
      context_request_hop: 8,
      context_version: 'context-v1:7:attempt-7',
      callback_hop: 7,
      question: 'Which rollback policy should be used?',
      created_at: REVIEW_REQUESTED_AT.toISOString(),
    }]);
  });

  it('records a version-bound context answer and atomically reopens the paused run', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const contextVersion = 'context-v1:7:attempt-7';
    const queries = [];
    let phase = 'paused';
    let answerDetail = null;
    const client = {
      async query(sql, params = []) {
        const normalized = String(sql).trim();
        queries.push({ sql: normalized, params });
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) {
          return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('pg_advisory_xact_lock')) {
          return { rows: [{}], rowCount: 1 };
        }
        if (normalized.includes("action='verdict:context_answer'")) {
          return {
            rows: answerDetail ? [{ detail: answerDetail }] : [],
            rowCount: answerDetail ? 1 : 0,
          };
        }
        if (normalized.includes('SELECT phase') && normalized.includes('FROM initiative_runs')) {
          return { rows: [{ phase }], rowCount: 1 };
        }
        if (normalized.includes('SELECT COALESCE(MAX(hop), 0) + 1 AS next_hop')) {
          return { rows: [{ next_hop: 9 }], rowCount: 1 };
        }
        if (normalized.includes('INSERT INTO orchestrator_decision_log')) {
          answerDetail = JSON.parse(params[3]);
          return { rows: [{ hop: 9 }], rowCount: 1 };
        }
        if (normalized.includes('UPDATE initiative_runs')) {
          phase = params[1];
          return { rows: [{ id: RUN_ID }], rowCount: 1 };
        }
        if (normalized.includes('UPDATE tasks')) {
          return { rows: [{ id: TASK_ID }], rowCount: 1 };
        }
        throw new Error(`unexpected context transaction query: ${normalized}`);
      },
      release() {},
    };
    const database = {
      async query(sql) {
        const normalized = String(sql).trim();
        queries.push({ sql: normalized, params: [] });
        if (normalized.includes("action='effect:context_requested'")) {
          return {
            rows: [{
              run_id: RUN_ID,
              task_id: TASK_ID,
              phase,
              context_request_hop: 8,
              detail: {
                callback_hop: 7,
                context_version: contextVersion,
                resume_phase: 'generate',
              },
            }],
            rowCount: 1,
          };
        }
        throw new Error(`unexpected context pool query: ${normalized}`);
      },
      async connect() {
        return client;
      },
    };
    const app = express();
    app.use(express.json());
    app.set('pool', database);
    app.use('/kernel-reviews', approvalRouter);

    const response = await request(app)
      .post(`/kernel-reviews/${RUN_ID}/context`)
      .set('x-approver-token', APPROVER_TOKEN)
      .send({
        task_id: TASK_ID,
        context_request_hop: 8,
        context_version: contextVersion,
        answer: 'Use the existing rollback policy.',
        approved_by: 'review-owner',
      });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      ok: true,
      run_id: RUN_ID,
      task_id: TASK_ID,
      context_request_hop: 8,
      context_version: contextVersion,
    });
    const insert = queries.find(({ sql }) => (
      sql.includes('INSERT INTO orchestrator_decision_log')
    ));
    expect(insert?.sql).toMatch(/verdict:context_answer/i);
    expect(insert?.params.join(' ')).toContain('Use the existing rollback policy.');
    const reopen = queries.find(({ sql }) => sql.includes('UPDATE initiative_runs'));
    expect(reopen?.sql).toMatch(/phase=\$2/i);
    expect(reopen?.params).toContain('generate');
    expect(queries.some(({ sql }) => (
      /UPDATE tasks[\s\S]*updated_at=NOW\(\)/i.test(sql)
    ))).toBe(true);
    expect(queries.at(-1).sql).toBe('COMMIT');

    const retry = await request(app)
      .post(`/kernel-reviews/${RUN_ID}/context`)
      .set('x-approver-token', APPROVER_TOKEN)
      .send({
        task_id: TASK_ID,
        context_request_hop: 8,
        context_version: contextVersion,
        answer: 'Use the existing rollback policy.',
        approved_by: 'review-owner',
      });

    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, deduped: true });
  });
});
