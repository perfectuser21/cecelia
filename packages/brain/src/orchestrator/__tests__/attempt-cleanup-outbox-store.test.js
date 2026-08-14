import { describe, expect, it, vi } from 'vitest';

import { createAttemptCleanupOutboxStore } from '../attempt-cleanup-outbox-store.js';

const OUTBOX_ID = '11111111-1111-4111-8111-111111111111';

function fakePool(rows = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  };
}

function leasedRow(overrides = {}) {
  return {
    id: OUTBOX_ID,
    status: 'leased',
    claim_owner: 'cleanup-worker',
    claim_generation: '9007199254740993',
    delivery_attempts: 1,
    ...overrides,
  };
}

describe('attempt cleanup outbox store', () => {
  it('claims due pending and expired leased rows in one ordered SKIP LOCKED CTE', async () => {
    const pool = fakePool([leasedRow()]);
    const store = createAttemptCleanupOutboxStore(pool);

    const rows = await store.claimBatch({
      claimOwner: 'cleanup-worker',
      leaseSeconds: 30,
      limit: 7,
    });

    expect(rows).toEqual([leasedRow()]);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toContain('WITH claimable AS');
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("status = 'leased'");
    expect(sql).toContain('available_at <= NOW()');
    expect(sql).toContain('claim_expires_at <= NOW()');
    expect(sql).toContain('ORDER BY created_at, id');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('claim_generation = outbox.claim_generation + 1');
    expect(sql).toContain('delivery_attempts = outbox.delivery_attempts + 1');
    expect(values).toEqual(['cleanup-worker', 30, 7]);
  });

  it('normalizes every returned BIGINT claim generation to canonical decimal string', async () => {
    const pool = fakePool([
      leasedRow({ claim_generation: 42n }),
      leasedRow({ id: '22222222-2222-4222-8222-222222222222', claim_generation: 7 }),
    ]);

    const rows = await createAttemptCleanupOutboxStore(pool).claimBatch({
      claimOwner: 'cleanup-worker',
      leaseSeconds: 30,
      limit: 2,
    });

    expect(rows.map((row) => row.claim_generation)).toEqual(['42', '7']);
  });

  it('confirms only the exact leased claim and keeps its claim identity', async () => {
    const row = leasedRow({ status: 'confirmed', receipt: { removed: true } });
    const pool = fakePool([row]);
    const receipt = { removed: true };

    const result = await createAttemptCleanupOutboxStore(pool).confirm(OUTBOX_ID, {
      claimOwner: 'cleanup-worker',
      claimGeneration: '9007199254740993',
      receipt,
    });

    expect(result).toEqual(row);
    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toContain("SET status = 'confirmed'");
    expect(sql).toContain("status = 'leased'");
    expect(sql).toContain('claim_owner = $2');
    expect(sql).toContain('claim_generation = $3::bigint');
    expect(sql).not.toContain('claim_owner = NULL');
    expect(values).toEqual([OUTBOX_ID, 'cleanup-worker', '9007199254740993', receipt]);
  });

  it('returns null on CAS miss without a follow-up read', async () => {
    const pool = fakePool([]);
    const store = createAttemptCleanupOutboxStore(pool);

    await expect(store.confirm(OUTBOX_ID, {
      claimOwner: 'cleanup-worker',
      claimGeneration: '1',
      receipt: { removed: true },
    })).resolves.toBeNull();
    await expect(store.retry(OUTBOX_ID, {
      claimOwner: 'cleanup-worker',
      claimGeneration: '1',
      errorCode: 'transport_failed',
      errorMessage: 'failed',
      retryAfterSeconds: 10,
    })).resolves.toBeNull();
    await expect(store.block(OUTBOX_ID, {
      claimOwner: 'cleanup-worker',
      claimGeneration: '1',
      errorCode: 'unsupported_transport',
      errorMessage: 'blocked',
    })).resolves.toBeNull();

    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('retries with cleared claim, unchanged generation, due time, and redacted bounded error', async () => {
    const pool = fakePool([leasedRow({ status: 'pending' })]);
    const secret = `Bearer very-secret ${'x'.repeat(2_500)}`;

    await createAttemptCleanupOutboxStore(pool).retry(OUTBOX_ID, {
      claimOwner: 'cleanup-worker',
      claimGeneration: '9007199254740993',
      errorCode: 'transport_failed',
      errorMessage: secret,
      retryAfterSeconds: 45,
    });

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toContain("SET status = 'pending'");
    expect(sql).toContain('claim_owner = NULL');
    expect(sql).toContain('claim_expires_at = NULL');
    expect(sql).not.toContain('claim_generation = claim_generation + 1');
    expect(sql).toContain("available_at = NOW() + ($6 * INTERVAL '1 second')");
    expect(values[4]).toContain('Bearer [REDACTED]');
    expect(values[4]).not.toContain('very-secret');
    expect(values[4].length).toBeLessThanOrEqual(2_000);
    expect(values[5]).toBe(45);
  });

  it('blocks with cleared claim and sanitized terminal error evidence', async () => {
    const pool = fakePool([leasedRow({ status: 'blocked' })]);

    await createAttemptCleanupOutboxStore(pool).block(OUTBOX_ID, {
      claimOwner: 'cleanup-worker',
      claimGeneration: '9007199254740993',
      errorCode: 'unsupported_transport',
      errorMessage: 'password=hunter2 cannot cancel',
    });

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toContain("SET status = 'blocked'");
    expect(sql).toContain('claim_owner = NULL');
    expect(sql).toContain('claim_expires_at = NULL');
    expect(sql).toContain('blocked_at = NOW()');
    expect(values[4]).toContain('password=[REDACTED]');
    expect(values[4]).not.toContain('hunter2');
  });

  it.each([
    ['missing query pool', null, 'pool'],
    ['blank owner', { claimOwner: ' ', leaseSeconds: 30, limit: 1 }, 'claimOwner'],
    ['fractional lease', { claimOwner: 'worker', leaseSeconds: 1.5, limit: 1 }, 'leaseSeconds'],
    ['zero limit', { claimOwner: 'worker', leaseSeconds: 30, limit: 0 }, 'limit'],
    ['oversized limit', { claimOwner: 'worker', leaseSeconds: 30, limit: 101 }, 'limit'],
  ])('fails closed for invalid claim input: %s', async (_name, input, expected) => {
    if (input === null) {
      expect(() => createAttemptCleanupOutboxStore({})).toThrow(expected);
      return;
    }
    const pool = fakePool();
    await expect(createAttemptCleanupOutboxStore(pool).claimBatch(input)).rejects.toThrow(expected);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid id', 'nope', { claimOwner: 'worker', claimGeneration: '1', receipt: {} }, 'id'],
    ['blank owner', OUTBOX_ID, { claimOwner: '', claimGeneration: '1', receipt: {} }, 'claimOwner'],
    ['numeric generation', OUTBOX_ID, { claimOwner: 'worker', claimGeneration: 1, receipt: {} }, 'claimGeneration'],
    ['bigint generation', OUTBOX_ID, { claimOwner: 'worker', claimGeneration: 1n, receipt: {} }, 'claimGeneration'],
    ['unsafe generation', OUTBOX_ID, { claimOwner: 'worker', claimGeneration: Number('9007199254740993'), receipt: {} }, 'claimGeneration'],
    ['noncanonical generation', OUTBOX_ID, { claimOwner: 'worker', claimGeneration: '01', receipt: {} }, 'claimGeneration'],
    ['array receipt', OUTBOX_ID, { claimOwner: 'worker', claimGeneration: '1', receipt: [] }, 'receipt'],
  ])('fails closed before confirm SQL: %s', async (_name, id, input, expected) => {
    const pool = fakePool();
    await expect(createAttemptCleanupOutboxStore(pool).confirm(id, input)).rejects.toThrow(expected);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('fails closed before SQL when receipt contains a cycle', async () => {
    const pool = fakePool();
    const receipt = { removed: true };
    receipt.self = receipt;

    await expect(createAttemptCleanupOutboxStore(pool).confirm(OUTBOX_ID, {
      claimOwner: 'worker',
      claimGeneration: '1',
      receipt,
    })).rejects.toThrow(/receipt.*JSON/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('fails closed before SQL when nested receipt evidence contains BIGINT', async () => {
    const pool = fakePool();

    await expect(createAttemptCleanupOutboxStore(pool).confirm(OUTBOX_ID, {
      claimOwner: 'worker',
      claimGeneration: '1',
      receipt: { evidence: { removedCount: 1n } },
    })).rejects.toThrow(/receipt.*JSON/i);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
