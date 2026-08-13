import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { appendAttemptVerdict } from '../harness-callback.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);
let client;

const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';

describe('appendAttemptVerdict PostgreSQL contract', () => {
  beforeAll(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE orchestrator_decision_log (
        id bigserial PRIMARY KEY,
        run_id uuid NOT NULL,
        hop integer NOT NULL,
        observed jsonb NOT NULL,
        derived_phase text NOT NULL,
        gate_verdict text,
        action text NOT NULL,
        detail jsonb NOT NULL,
        UNIQUE (run_id, hop)
      ) ON COMMIT DROP
    `);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    await pool.end();
  });

  it('persists a reviewer verdict when run_id is a UUID column', async () => {
    const contractSha = 'a'.repeat(40);
    await appendAttemptVerdict({
      id: attemptId,
      run_id: runId,
      role: 'reviewer',
      task_bundle: { inputs: { contract_round: 1, contract_sha: contractSha } },
    }, {
      status: 'completed',
      decision: { outcome: 'APPROVED', reason: 'contract covers PRD' },
    }, client);

    const { rows } = await client.query(
      'SELECT run_id, action, detail FROM orchestrator_decision_log',
    );
    expect(rows).toEqual([expect.objectContaining({
      run_id: runId,
      action: 'verdict:reviewer',
      detail: expect.objectContaining({
        attempt_id: attemptId,
        verdict: 'APPROVED',
        rn: 1,
        contract_sha: contractSha,
      }),
    })]);
  });

  it('anchors an evaluator verdict to the retained candidate instead of a stale PR head', async () => {
    const candidateHead = 'b'.repeat(40);
    const stalePrHead = 'c'.repeat(40);
    const evaluatorAttemptId = '33333333-3333-4333-8333-333333333333';
    await appendAttemptVerdict({
      id: evaluatorAttemptId,
      run_id: runId,
      role: 'evaluator',
      task_bundle: {
        inputs: {
          pr_head_sha: candidateHead,
          pull_request: { head_sha: stalePrHead },
        },
      },
    }, {
      status: 'completed',
      decision: {
        outcome: 'FAIL',
        reason: 'candidate behavior failed',
        failure_class: 'product_failure',
      },
    }, client);

    const { rows } = await client.query(
      `SELECT detail FROM orchestrator_decision_log
        WHERE action='verdict:evaluate' AND detail->>'attempt_id'=$1`,
      [evaluatorAttemptId],
    );
    expect(rows[0]?.detail).toMatchObject({
      pr_head_sha: candidateHead,
      failure_class: 'product_failure',
    });
  });
});
