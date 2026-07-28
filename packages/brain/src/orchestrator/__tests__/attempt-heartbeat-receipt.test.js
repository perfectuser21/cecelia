import { describe, expect, it, vi } from 'vitest';

import { createAttemptStore } from '../attempt-store.js';

const attemptId = '22222222-2222-4222-8222-222222222222';
const runId = '11111111-1111-4111-8111-111111111111';
const nonce = '55555555-5555-4555-8555-555555555555';
const receiptId = '66666666-6666-4666-8666-666666666666';
const nowMs = Date.parse('2026-07-28T02:00:00.000Z');

function input(overrides = {}) {
  return {
    attemptId,
    runId,
    workerId: 'xian-mac-m4',
    jobId: 'job-7',
    leaseOwner: 'brain-1:123',
    leaseGeneration: 2,
    heartbeatNonce: nonce,
    requestSha256: 'a'.repeat(64),
    observedAt: '2026-07-28T01:59:30.000Z',
    leaseSeconds: 180,
    providerSessionId: null,
    ...overrides,
  };
}

function lockedAttempt(overrides = {}) {
  return {
    id: attemptId,
    run_id: runId,
    status: 'running',
    execution_transport: 'fleet-worker',
    actual_machine_id: 'xian-mac-m4',
    remote_job_id: 'job-7',
    lease_owner: 'brain-1:123',
    lease_generation: 2,
    machine_attestation_status: 'verified',
    provider_session_id: null,
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return {
    receipt_id: receiptId,
    attempt_id: attemptId,
    run_id: runId,
    worker_id: 'xian-mac-m4',
    job_id: 'job-7',
    lease_owner: 'brain-1:123',
    lease_generation: 2,
    heartbeat_nonce: nonce,
    request_sha256: 'a'.repeat(64),
    observed_at: '2026-07-28T01:59:30.000Z',
    lease_seconds: 180,
    provider_session_id: null,
    heartbeat_at: '2026-07-28T02:00:00.000Z',
    lease_expires_at: '2026-07-28T02:03:00.000Z',
    persisted_at: '2026-07-28T02:00:00.000Z',
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

describe('AttemptStore durable Fleet heartbeat receipt', () => {
  it('renews the lease and inserts one receipt in the same transaction', async () => {
    const renewed = {
      ...lockedAttempt(),
      heartbeat_at: '2026-07-28T02:00:00.000Z',
      lease_expires_at: '2026-07-28T02:03:00.000Z',
    };
    const persistedReceipt = receipt();
    const pool = transactionPool([
      { rows: [] },
      { rows: [lockedAttempt()] },
      { rows: [] },
      { rows: [renewed] },
      { rows: [persistedReceipt] },
      { rows: [] },
    ]);
    const store = createAttemptStore(pool, { now: () => nowMs });

    await expect(store.persistFleetHeartbeat(input())).resolves.toEqual({
      attempt: renewed,
      receipt: persistedReceipt,
      deduped: false,
    });

    const statements = pool.client.query.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toMatch(/SELECT \* FROM harness_attempts.*FOR UPDATE/is);
    expect(statements[2]).toMatch(/FROM harness_heartbeat_receipts/i);
    expect(statements[3]).toMatch(/UPDATE harness_attempts/i);
    expect(statements[3]).toMatch(/lease_generation = \$\d+/i);
    expect(statements[4]).toMatch(/INSERT INTO harness_heartbeat_receipts/i);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(pool.client.release).toHaveBeenCalledOnce();
  });

  it('returns the immutable receipt for an exact retry even after it is stale', async () => {
    const persistedReceipt = receipt();
    const current = lockedAttempt({ status: 'completed' });
    const pool = transactionPool([
      { rows: [] },
      { rows: [current] },
      { rows: [persistedReceipt] },
      { rows: [] },
    ]);
    const store = createAttemptStore(pool, {
      now: () => nowMs + (24 * 60 * 60 * 1000),
    });

    await expect(store.persistFleetHeartbeat(input())).resolves.toEqual({
      attempt: current,
      receipt: persistedReceipt,
      deduped: true,
    });

    const statements = pool.client.query.mock.calls.map(([sql]) => sql);
    expect(statements).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/UPDATE harness_attempts/i),
      expect.stringMatching(/INSERT INTO harness_heartbeat_receipts/i),
    ]));
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('rejects the same nonce with an altered signed request', async () => {
    const pool = transactionPool([
      { rows: [] },
      { rows: [lockedAttempt()] },
      { rows: [receipt()] },
      { rows: [] },
    ]);
    const store = createAttemptStore(pool, { now: () => nowMs });

    await expect(store.persistFleetHeartbeat(input({
      requestSha256: 'b'.repeat(64),
      leaseSeconds: 240,
    }))).rejects.toMatchObject({
      code: 'fleet_heartbeat_conflict',
    });

    expect(pool.client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  });

  it('rejects a new stale nonce but does not delete historical receipts', async () => {
    const pool = transactionPool([
      { rows: [] },
      { rows: [lockedAttempt()] },
      { rows: [] },
      { rows: [] },
    ]);
    const store = createAttemptStore(pool, { now: () => nowMs });

    await expect(store.persistFleetHeartbeat(input({
      heartbeatNonce: '77777777-7777-4777-8777-777777777777',
      observedAt: '2026-07-27T01:00:00.000Z',
      requestSha256: 'c'.repeat(64),
    }))).rejects.toMatchObject({
      code: 'fleet_heartbeat_stale',
    });

    const statements = pool.client.query.mock.calls.map(([sql]) => sql);
    expect(statements).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/DELETE FROM harness_heartbeat_receipts/i),
    ]));
    expect(statements.at(-1)).toBe('ROLLBACK');
  });

  it('rejects changed Fleet authority under the locked Attempt row', async () => {
    const pool = transactionPool([
      { rows: [] },
      { rows: [lockedAttempt({ lease_generation: 3 })] },
      { rows: [] },
    ]);
    const store = createAttemptStore(pool, { now: () => nowMs });

    await expect(store.persistFleetHeartbeat(input())).rejects.toMatchObject({
      code: 'fleet_heartbeat_conflict',
    });
    expect(pool.client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  });

  it('rejects provider session reuse inside the heartbeat transaction', async () => {
    const pool = transactionPool([
      { rows: [] },
      { rows: [lockedAttempt()] },
      { rows: [] },
      {
        rows: [{
          id: '99999999-9999-4999-8999-999999999999',
          role: 'reviewer',
          provider_session_id: 'session-shared',
        }],
      },
      { rows: [] },
    ]);
    const store = createAttemptStore(pool, { now: () => nowMs });

    await expect(store.persistFleetHeartbeat(input({
      providerSessionId: 'session-shared',
    }))).rejects.toMatchObject({
      code: 'fleet_heartbeat_conflict',
    });

    const statements = pool.client.query.mock.calls.map(([sql]) => sql);
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringMatching(/provider_session_id\s*=\s*\$2/i),
    ]));
    expect(statements).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/UPDATE harness_attempts/i),
    ]));
  });

  it('maps a PostgreSQL uniqueness race to a heartbeat conflict', async () => {
    const uniqueError = Object.assign(new Error('duplicate nonce'), { code: '23505' });
    const pool = transactionPool([
      { rows: [] },
      { rows: [lockedAttempt()] },
      { rows: [] },
      { rows: [{
        ...lockedAttempt(),
        heartbeat_at: '2026-07-28T02:00:00.000Z',
        lease_expires_at: '2026-07-28T02:03:00.000Z',
      }] },
    ]);
    pool.client.query.mockImplementationOnce(async () => ({ rows: [] }))
      .mockImplementationOnce(async () => ({ rows: [lockedAttempt()] }))
      .mockImplementationOnce(async () => ({ rows: [] }))
      .mockImplementationOnce(async () => ({
        rows: [{
          ...lockedAttempt(),
          heartbeat_at: '2026-07-28T02:00:00.000Z',
          lease_expires_at: '2026-07-28T02:03:00.000Z',
        }],
      }))
      .mockRejectedValueOnce(uniqueError)
      .mockResolvedValueOnce({ rows: [] });
    const store = createAttemptStore(pool, { now: () => nowMs });

    await expect(store.persistFleetHeartbeat(input())).rejects.toMatchObject({
      code: 'fleet_heartbeat_conflict',
    });
    expect(pool.client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
    expect(pool.client.release).toHaveBeenCalledOnce();
  });
});
