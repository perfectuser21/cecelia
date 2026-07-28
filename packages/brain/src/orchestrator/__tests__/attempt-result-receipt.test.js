import { describe, expect, it, vi } from 'vitest';

import { createAttemptStore } from '../attempt-store.js';

const attemptId = '22222222-2222-4222-8222-222222222222';
const runId = '11111111-1111-4111-8111-111111111111';
const deliveryId = '55555555-5555-4555-8555-555555555555';
const resultNonce = '66666666-6666-4666-8666-666666666666';
const receiptId = '77777777-7777-4777-8777-777777777777';
const resultSha256 = 'a'.repeat(64);
const result = {
  contract_version: '1.0',
  attempt_id: attemptId,
  status: 'completed',
  summary: 'done',
  artifacts: [],
  checks: [],
  decision: null,
  error: null,
  provider_metadata: { provider: 'claude', session_id: 'session-1' },
};

function input(overrides = {}) {
  return {
    attemptId,
    runId,
    taskId: 'task-1',
    role: 'planner',
    workerId: 'xian-mac-m4',
    jobId: 'job-7',
    leaseOwner: 'brain-1:123',
    leaseGeneration: 2,
    deliveryId,
    resultNonce,
    resultSha256,
    resultBytes: 321,
    terminalStatus: 'completed',
    result,
    ...overrides,
  };
}

function transactionPool(queryResults) {
  const client = {
    query: vi.fn().mockImplementation(async () => (
      queryResults.shift() ?? { rows: [], rowCount: 0 }
    )),
    release: vi.fn(),
  };
  return {
    query: vi.fn(),
    connect: vi.fn(async () => client),
    client,
  };
}

describe('attempt store durable Fleet result receipt', () => {
  it('writes the terminal Attempt and append-only receipt in one transaction', async () => {
    const lockedAttempt = {
      id: attemptId,
      run_id: runId,
      role: 'planner',
      status: 'running',
      lease_owner: 'brain-1:123',
      lease_generation: 2,
      actual_machine_id: 'xian-mac-m4',
      execution_transport: 'fleet-worker',
      remote_job_id: 'job-7',
      machine_attestation_status: 'verified',
    };
    const receipt = {
      receipt_id: receiptId,
      attempt_id: attemptId,
      run_id: runId,
      result_sha256: resultSha256,
      persisted_at: '2026-07-28T01:00:00.000Z',
    };
    const persistedAttempt = { ...lockedAttempt, status: 'completed', result };
    const pool = transactionPool([
      { rows: [] }, // BEGIN
      { rows: [lockedAttempt], rowCount: 1 }, // SELECT FOR UPDATE
      { rows: [receipt], rowCount: 1 }, // receipt INSERT
      { rows: [persistedAttempt], rowCount: 1 }, // Attempt UPDATE
      { rows: [] }, // COMMIT
    ]);

    await expect(
      createAttemptStore(pool).persistFleetResultReceipt(input()),
    ).resolves.toMatchObject({
      attempt: persistedAttempt,
      receipt,
      deduped: false,
    });

    expect(pool.connect).toHaveBeenCalledTimes(1);
    const statements = pool.client.query.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toMatch(/SELECT \* FROM harness_attempts.*FOR UPDATE/is);
    expect(statements[2]).toMatch(/INSERT INTO harness_result_receipts/i);
    expect(statements[3]).toMatch(/UPDATE harness_attempts/i);
    expect(statements[3]).toMatch(/result_receipt_id/i);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(pool.client.release).toHaveBeenCalledTimes(1);
  });

  it('returns the persisted receipt for an exact retry without another write', async () => {
    const lockedAttempt = {
      id: attemptId,
      run_id: runId,
      role: 'planner',
      status: 'completed',
      lease_owner: 'brain-1:123',
      lease_generation: 2,
      actual_machine_id: 'xian-mac-m4',
      execution_transport: 'fleet-worker',
      remote_job_id: 'job-7',
      result_receipt_id: receiptId,
      result_sha256: resultSha256,
      result_bytes: 321,
      result_delivery_id: deliveryId,
      result_nonce: resultNonce,
      result_worker_id: 'xian-mac-m4',
      result,
    };
    const receipt = {
      receipt_id: receiptId,
      attempt_id: attemptId,
      run_id: runId,
      task_id: 'task-1',
      role: 'planner',
      worker_id: 'xian-mac-m4',
      job_id: 'job-7',
      lease_owner: 'brain-1:123',
      lease_generation: 2,
      delivery_id: deliveryId,
      result_nonce: resultNonce,
      result_sha256: resultSha256,
      result_bytes: 321,
      terminal_status: 'completed',
      persisted_at: '2026-07-28T01:00:00.000Z',
    };
    const pool = transactionPool([
      { rows: [] },
      { rows: [lockedAttempt] },
      { rows: [receipt] },
      { rows: [] },
    ]);

    await expect(
      createAttemptStore(pool).persistFleetResultReceipt(input()),
    ).resolves.toMatchObject({ attempt: lockedAttempt, receipt, deduped: true });

    expect(pool.client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringMatching(/FOR UPDATE/i),
      expect.stringMatching(/FROM harness_result_receipts/i),
      'COMMIT',
    ]);
  });

  it('rolls back and rejects a conflicting terminal digest for the same generation', async () => {
    const lockedAttempt = {
      id: attemptId,
      run_id: runId,
      role: 'planner',
      status: 'completed',
      lease_owner: 'brain-1:123',
      lease_generation: 2,
      actual_machine_id: 'xian-mac-m4',
      execution_transport: 'fleet-worker',
      remote_job_id: 'job-7',
      result_receipt_id: receiptId,
      result_sha256: 'b'.repeat(64),
    };
    const pool = transactionPool([
      { rows: [] },
      { rows: [lockedAttempt] },
      { rows: [] },
    ]);

    await expect(
      createAttemptStore(pool).persistFleetResultReceipt(input()),
    ).rejects.toMatchObject({ code: 'fleet_result_conflict' });

    expect(pool.client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(pool.client.release).toHaveBeenCalledTimes(1);
  });
});
