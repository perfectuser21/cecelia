import { describe, expect, it, vi } from 'vitest';

import { LOG_ACTION } from '../constants.js';
import { createAttemptCleanupWorker } from '../attempt-cleanup-worker.js';

const OUTBOX_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';

function claim(overrides = {}) {
  return {
    id: OUTBOX_ID,
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    target_machine_id: 'us-mac-m4',
    execution_transport: 'fleet-worker',
    remote_job_id: 'container-exact',
    lease_owner: 'attempt-dispatcher',
    lease_generation: 7,
    claim_owner: 'cleanup-worker-a',
    claim_generation: '11',
    status: 'leased',
    ...overrides,
  };
}

function harness({ cancelResult, cancelError, confirmResult = { status: 'confirmed' } } = {}) {
  let transactionOpen = false;
  const calls = [];
  const client = {
    query: vi.fn(async (sql, values) => {
      calls.push([String(sql), values]);
      if (sql === 'BEGIN') transactionOpen = true;
      if (sql === 'COMMIT' || sql === 'ROLLBACK') transactionOpen = false;
      if (String(sql).includes('INSERT INTO orchestrator_decision_log')) return { rows: [{ hop: 9 }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(),
    connect: vi.fn(async () => client),
  };
  const rootStore = {
    claimBatch: vi.fn(async () => [claim()]),
    retry: vi.fn(async () => ({ status: 'pending' })),
    block: vi.fn(async () => ({ status: 'blocked' })),
  };
  const transactionStore = {
    confirm: vi.fn(async () => confirmResult),
  };
  const storeFactory = vi.fn((db) => (db === client ? transactionStore : rootStore));
  const transport = {
    cancel: vi.fn(async (_input) => {
      expect(transactionOpen).toBe(false);
      if (cancelError) throw cancelError;
      return cancelResult;
    }),
  };
  const worker = createAttemptCleanupWorker({
    pool,
    transport,
    storeFactory,
    claimOwner: 'cleanup-worker-a',
    leaseSeconds: 30,
    limit: 5,
    retryAfterSeconds: 60,
  });
  return {
    worker,
    pool,
    client,
    calls,
    rootStore,
    transactionStore,
    transport,
  };
}

describe('attempt cleanup worker', () => {
  it.each(['cleaned', 'already_clean'])('confirms exact %s evidence with canonical receipt and decision atomically', async (status) => {
    const fixture = harness({ cancelResult: { status, attempt_id: ATTEMPT_ID, extra: 'discard-me' } });

    const result = await fixture.worker.runOnce();

    expect(result).toMatchObject({ claimed: 1, confirmed: 1, blocked: 0, retried: 0 });
    expect(fixture.transport.cancel).toHaveBeenCalledWith({
      attempt: {
        id: ATTEMPT_ID,
        run_id: RUN_ID,
        lease_owner: 'attempt-dispatcher',
        lease_generation: 7,
      },
      target: { machine: 'us-mac-m4' },
    });
    const receipt = {
      contract_version: 'attempt-cleanup-confirmation/v1',
      status,
      attempt_id: ATTEMPT_ID,
      run_id: RUN_ID,
      target_machine_id: 'us-mac-m4',
      execution_transport: 'fleet-worker',
      remote_job_id: 'container-exact',
      lease_owner: 'attempt-dispatcher',
      lease_generation: 7,
    };
    expect(fixture.transactionStore.confirm).toHaveBeenCalledWith(OUTBOX_ID, {
      claimOwner: 'cleanup-worker-a',
      claimGeneration: '11',
      receipt,
    });
    expect(fixture.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining('INSERT INTO orchestrator_decision_log'),
      'COMMIT',
    ]);
    expect(fixture.calls[1][1]).toEqual([RUN_ID]);
    expect(fixture.calls[2][0]).toContain(LOG_ACTION.ATTEMPT_CLEANUP_CONFIRMED);
    expect(JSON.parse(fixture.calls[2][1][1])).toEqual(receipt);
  });

  it.each([
    ['quarantined', { status: 'quarantined', attempt_id: ATTEMPT_ID }],
    ['rejected', { status: 'rejected', httpStatus: 409 }],
    ['identity missing', { status: 'cleaned' }],
    ['identity-missing response status', { status: 'identity_missing' }],
    ['identity mismatch', { status: 'cleaned', attempt_id: 'stale-attempt' }],
    ['unsupported response status', { status: 'unsupported' }],
  ])('blocks terminally unsafe cleanup evidence: %s', async (_label, cancelResult) => {
    const fixture = harness({ cancelResult });

    await expect(fixture.worker.runOnce()).resolves.toMatchObject({ blocked: 1 });

    expect(fixture.rootStore.block).toHaveBeenCalledWith(
      OUTBOX_ID,
      expect.objectContaining({ claimOwner: 'cleanup-worker-a', claimGeneration: '11' }),
    );
    expect(fixture.rootStore.retry).not.toHaveBeenCalled();
    expect(fixture.transactionStore.confirm).not.toHaveBeenCalled();
  });

  it('blocks unsupported stored transport without making an external call', async () => {
    const fixture = harness();
    fixture.rootStore.claimBatch.mockResolvedValueOnce([claim({ execution_transport: 'docker-local' })]);

    await expect(fixture.worker.runOnce()).resolves.toMatchObject({ blocked: 1 });

    expect(fixture.transport.cancel).not.toHaveBeenCalled();
    expect(fixture.rootStore.block).toHaveBeenCalledWith(
      OUTBOX_ID,
      expect.objectContaining({ errorCode: 'cleanup_transport_unsupported' }),
    );
  });

  it.each([
    ['404', { cancelResult: { status: 'missing', httpStatus: 404 } }],
    ['unavailable', { cancelResult: { status: 'unavailable' } }],
    ['configuration unavailable', {
      cancelError: new Error('execution_transport_unavailable:us-mac-m4'),
    }],
    ['timeout', { cancelError: new Error('remote_bridge_cancel_timeout') }],
    ['thrown 404', { cancelError: new Error('remote_bridge_cancel_http_404') }],
    ['5xx', { cancelError: new Error('remote_bridge_cancel_http_503') }],
  ])('retries recoverable cleanup failure: %s', async (_label, setup) => {
    const fixture = harness(setup);

    await expect(fixture.worker.runOnce()).resolves.toMatchObject({ retried: 1 });

    expect(fixture.rootStore.retry).toHaveBeenCalledWith(OUTBOX_ID, {
      claimOwner: 'cleanup-worker-a',
      claimGeneration: '11',
      errorCode: expect.any(String),
      errorMessage: expect.any(String),
      retryAfterSeconds: 60,
    });
    expect(fixture.rootStore.block).not.toHaveBeenCalled();
  });

  it('does not append confirmation when an old claim loses the CAS race', async () => {
    const fixture = harness({
      cancelResult: { status: 'cleaned', attempt_id: ATTEMPT_ID },
      confirmResult: null,
    });

    await expect(fixture.worker.runOnce()).resolves.toMatchObject({ stale: 1, confirmed: 0 });

    expect(fixture.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('pg_advisory_xact_lock'),
      'ROLLBACK',
    ]);
    expect(fixture.calls.some(([sql]) => sql.includes('INSERT INTO orchestrator_decision_log')))
      .toBe(false);
  });
});
