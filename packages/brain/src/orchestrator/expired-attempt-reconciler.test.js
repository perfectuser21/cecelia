import { describe, expect, it, vi } from 'vitest';

import {
  createExpiredAttemptAuthority,
  oldestExpiredAttempt,
  reconcileExpiredAttempt,
} from './expired-attempt-reconciler.js';

const NOW = new Date('2026-08-03T08:00:00.000Z');
const ATTEMPT = Object.freeze({
  id: '863fdc22-ad3e-4e89-a8ce-6323cf9b9917',
  run_id: '92a67d1a-2c3a-4819-9930-09d841f31bd8',
  hop: 49,
  phase: 'gan',
  role: 'reviewer',
  status: 'running',
  lease_owner: 'controller-old:6328',
  lease_generation: 0,
  lease_expires_at: '2026-08-03T07:59:00.000Z',
  requested_machine_id: 'us-mac-m4',
  actual_machine_id: null,
  execution_transport: null,
  remote_job_id: null,
});
const VERIFIED_ATTEMPT = Object.freeze({
  ...ATTEMPT,
  actual_machine_id: 'us-mac-m4',
  execution_transport: 'fleet-worker',
  remote_job_id: ATTEMPT.id,
  machine_attestation_status: 'verified',
});

function makeDeps(overrides = {}) {
  return {
    now: () => NOW,
    launcher: {
      inspect: vi.fn(async () => ({ status: 'missing', attempt_id: ATTEMPT.id })),
      start: vi.fn(async () => ({
        status: 'running',
        attempt_id: ATTEMPT.id,
      })),
      cancel: vi.fn(async () => ({ status: 'cleaned', attempt_id: ATTEMPT.id })),
    },
    attemptStore: {
      heartbeat: vi.fn(async () => ({ ...ATTEMPT })),
    },
    terminalize: vi.fn(async (input) => ({
      attempt: { ...ATTEMPT, status: 'failed', error_code: input.code },
      hop: 50,
      deduped: false,
    })),
    leaseSeconds: 180,
    ...overrides,
  };
}

describe('expired Fleet attempt reconciliation', () => {
  it('selects the oldest expired starting/running attempt only', () => {
    const attempts = [
      { ...ATTEMPT, id: 'future', lease_expires_at: '2026-08-03T08:01:00.000Z' },
      { ...ATTEMPT, id: 'newer', lease_expires_at: '2026-08-03T07:59:30.000Z' },
      { ...ATTEMPT, id: 'terminal', status: 'failed', lease_expires_at: '2026-08-03T07:00:00.000Z' },
      { ...ATTEMPT, id: 'oldest', lease_expires_at: '2026-08-03T07:58:30.000Z' },
    ];

    expect(oldestExpiredAttempt(attempts, NOW)?.id).toBe('oldest');
  });

  it('does not route an expired local-docker attempt through Fleet reconciliation', () => {
    const attempts = [{
      ...ATTEMPT,
      execution_transport: 'local-docker',
      actual_machine_id: 'us-mac-m4',
      machine_attestation_status: 'local',
    }];

    expect(oldestExpiredAttempt(attempts, NOW)).toBeNull();
  });

  it.each([
    ['unattested actual machine', {
      execution_transport: null,
      actual_machine_id: 'us-mac-m4',
      machine_attestation_status: 'unverified',
    }],
    ['noncanonical requested machine', {
      execution_transport: null,
      actual_machine_id: null,
      requested_machine_id: 'unknown-worker',
    }],
    ['other remote transport', {
      execution_transport: 'remote-bridge',
      actual_machine_id: null,
    }],
  ])('does not select an expired %s attempt for Fleet recovery', (_label, fields) => {
    expect(oldestExpiredAttempt([{ ...ATTEMPT, ...fields }], NOW)).toBeNull();
  });

  it('terminalizes a missing Worker attempt with exact old lease even without a launch receipt', async () => {
    const deps = makeDeps();

    const result = await reconcileExpiredAttempt({ attempt: ATTEMPT, ...deps });

    expect(deps.launcher.inspect).toHaveBeenCalledWith({
      attempt: ATTEMPT,
      target: { machine: 'us-mac-m4' },
    });
    expect(deps.terminalize).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: ATTEMPT.id,
      runId: ATTEMPT.run_id,
      leaseOwner: ATTEMPT.lease_owner,
      leaseGeneration: 0,
      code: 'worker_attempt_missing_after_lease',
      failureClass: 'infrastructure_blocked',
      evidence: {
        attempt_id: ATTEMPT.id,
        prior_lease_generation: 0,
        target: 'us-mac-m4',
        signature: 'worker_attempt_missing_after_lease',
      },
    }));
    expect(deps.attemptStore.heartbeat).not.toHaveBeenCalled();
    expect(deps.launcher.start).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'missing_terminalized',
      hop: 50,
    });
  });

  it('starts a prepared Worker with its old lease and never rotates Brain generation', async () => {
    const deps = makeDeps({
      launcher: {
        inspect: vi.fn(async () => ({
          status: 'prepared',
          attempt_id: ATTEMPT.id,
          container_id: VERIFIED_ATTEMPT.remote_job_id,
        })),
        start: vi.fn(async () => ({ status: 'running', attempt_id: ATTEMPT.id })),
        cancel: vi.fn(),
      },
    });

    const result = await reconcileExpiredAttempt({
      attempt: { ...VERIFIED_ATTEMPT, status: 'starting' },
      ...deps,
    });

    expect(deps.launcher.start).toHaveBeenCalledWith({
      attempt: { ...VERIFIED_ATTEMPT, status: 'starting' },
      target: { machine: 'us-mac-m4' },
    });
    expect(deps.launcher.start.mock.calls[0][0].attempt).toMatchObject({
      lease_owner: 'controller-old:6328',
      lease_generation: 0,
    });
    expect(deps.attemptStore.heartbeat).toHaveBeenCalledWith(ATTEMPT.id, {
      leaseOwner: 'controller-old:6328',
      leaseGeneration: 0,
      leaseSeconds: 180,
    });
    expect(result.status).toBe('adopted_prepared');
  });

  it('exact-cancels and replaces prepared state when the old Worker cannot start it', async () => {
    const startError = new Error('remote_bridge_start_http_500');
    const deps = makeDeps({
      launcher: {
        inspect: vi.fn(async () => ({
          status: 'prepared',
          attempt_id: ATTEMPT.id,
          container_id: VERIFIED_ATTEMPT.remote_job_id,
        })),
        start: vi.fn(async () => { throw startError; }),
        cancel: vi.fn(async () => ({ status: 'cleaned', attempt_id: ATTEMPT.id })),
      },
    });

    const result = await reconcileExpiredAttempt({
      attempt: { ...VERIFIED_ATTEMPT, status: 'starting' },
      ...deps,
    });

    expect(deps.launcher.cancel).toHaveBeenCalledWith({
      attempt: { ...VERIFIED_ATTEMPT, status: 'starting' },
      target: { machine: 'us-mac-m4' },
    });
    expect(deps.terminalize).toHaveBeenCalledWith(expect.objectContaining({
      code: 'worker_attempt_replacement_required_after_lease',
      failureClass: 'infrastructure_blocked',
    }));
    expect(result.status).toBe('replacement_required');
  });

  it.each([
    ['missing response', { status: 'missing' }],
    ['rejected response', { status: 'rejected' }],
    ['quarantined response', { status: 'quarantined' }],
  ])('fails closed when prepared cancellation is not confirmed safe: %s', async (_label, cancelResult) => {
    const deps = makeDeps({
      launcher: {
        inspect: vi.fn(async () => ({
          status: 'prepared',
          attempt_id: ATTEMPT.id,
          container_id: VERIFIED_ATTEMPT.remote_job_id,
        })),
        start: vi.fn(async () => { throw new Error('remote_bridge_start_http_500'); }),
        cancel: vi.fn(async () => cancelResult),
      },
    });

    const result = await reconcileExpiredAttempt({
      attempt: { ...VERIFIED_ATTEMPT, status: 'starting' },
      ...deps,
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'infrastructure_blocked',
      failure_class: 'infrastructure_blocked',
      signature: 'worker_attempt_cancel_unconfirmed',
    }));
    expect(deps.terminalize).not.toHaveBeenCalled();
  });

  it('fails closed when prepared cancellation throws', async () => {
    const deps = makeDeps({
      launcher: {
        inspect: vi.fn(async () => ({ status: 'prepared', attempt_id: ATTEMPT.id })),
        start: vi.fn(async () => { throw new Error('remote_bridge_start_http_500'); }),
        cancel: vi.fn(async () => { throw new Error('remote_bridge_cancel_http_503'); }),
      },
    });

    const result = await reconcileExpiredAttempt({
      attempt: { ...ATTEMPT, status: 'starting' },
      ...deps,
    });

    expect(result.signature).toBe('worker_attempt_cancel_unavailable');
    expect(deps.terminalize).not.toHaveBeenCalled();
  });

  it('keeps a running Worker on the old callback lease and only extends that exact identity', async () => {
    const deps = makeDeps({
      launcher: {
        inspect: vi.fn(async () => ({
          status: 'running',
          attempt_id: ATTEMPT.id,
          container_id: VERIFIED_ATTEMPT.remote_job_id,
        })),
        start: vi.fn(),
        cancel: vi.fn(),
      },
    });

    const result = await reconcileExpiredAttempt({ attempt: VERIFIED_ATTEMPT, ...deps });

    expect(deps.attemptStore.heartbeat).toHaveBeenCalledWith(ATTEMPT.id, {
      leaseOwner: 'controller-old:6328',
      leaseGeneration: 0,
      leaseSeconds: 180,
    });
    expect(deps.launcher.start).not.toHaveBeenCalled();
    expect(deps.launcher.cancel).not.toHaveBeenCalled();
    expect(result.status).toBe('adopted_running');
  });

  it.each(['prepared', 'running'])(
    'backs off when the exact %s Worker lease heartbeat has a transient DB error',
    async (workerStatus) => {
      const deps = makeDeps({
        launcher: {
          inspect: vi.fn(async () => ({
            status: workerStatus,
            attempt_id: ATTEMPT.id,
            container_id: VERIFIED_ATTEMPT.remote_job_id,
          })),
          start: vi.fn(async () => ({ status: 'running', attempt_id: ATTEMPT.id })),
          cancel: vi.fn(),
        },
        attemptStore: {
          heartbeat: vi.fn(async () => { throw new Error('postgres_connection_reset'); }),
        },
      });

      const result = await reconcileExpiredAttempt({ attempt: VERIFIED_ATTEMPT, ...deps });

      expect(result).toEqual(expect.objectContaining({
        status: 'infrastructure_blocked',
        failure_class: 'infrastructure_blocked',
        signature: 'worker_attempt_lease_heartbeat_unavailable',
      }));
      expect(deps.launcher.cancel).not.toHaveBeenCalled();
      expect(deps.terminalize).not.toHaveBeenCalled();
    },
  );

  it('returns infrastructure backoff when exact Worker inspection is unavailable', async () => {
    const deps = makeDeps({
      launcher: {
        inspect: vi.fn(async () => { throw new Error('remote_bridge_inspect_http_503'); }),
        start: vi.fn(),
        cancel: vi.fn(),
      },
    });

    const result = await reconcileExpiredAttempt({ attempt: ATTEMPT, ...deps });

    expect(result).toEqual(expect.objectContaining({
      status: 'infrastructure_blocked',
      failure_class: 'infrastructure_blocked',
      signature: 'worker_attempt_inspect_unavailable',
    }));
    expect(deps.terminalize).not.toHaveBeenCalled();
    expect(deps.launcher.start).not.toHaveBeenCalled();
  });

  it('treats a generic inspect HTTP 404 as unavailable and never terminalizes it', async () => {
    const deps = makeDeps({
      launcher: {
        inspect: vi.fn(async () => { throw new Error('remote_bridge_inspect_http_404'); }),
        start: vi.fn(),
        cancel: vi.fn(),
      },
    });

    const result = await reconcileExpiredAttempt({ attempt: ATTEMPT, ...deps });

    expect(result).toMatchObject({
      status: 'infrastructure_blocked',
      signature: 'worker_attempt_inspect_unavailable',
    });
    expect(deps.terminalize).not.toHaveBeenCalled();
    expect(deps.launcher.cancel).not.toHaveBeenCalled();
  });

  it.each([
    ['actual machine differs from requested', { actual_machine_id: 'xian-mac-m4' }],
    ['actual machine is not canonical', { actual_machine_id: 'unknown-worker' }],
    ['remote job identity is missing', { remote_job_id: null }],
    ['machine attestation is not verified', { machine_attestation_status: 'unverified' }],
    ['execution transport is not Fleet Worker', { execution_transport: 'remote-bridge' }],
  ])('fails closed on active Worker with partial launch receipt: %s', async (_label, fields) => {
    const deps = makeDeps({
      launcher: {
        inspect: vi.fn(async () => ({
          status: 'running',
          attempt_id: ATTEMPT.id,
          container_id: VERIFIED_ATTEMPT.remote_job_id,
        })),
        start: vi.fn(),
        cancel: vi.fn(),
      },
    });

    const result = await reconcileExpiredAttempt({
      attempt: { ...VERIFIED_ATTEMPT, ...fields },
      ...deps,
    });

    expect(result).toMatchObject({
      status: 'infrastructure_blocked',
      signature: 'worker_attempt_launch_receipt_unconfirmed',
    });
    expect(deps.attemptStore.heartbeat).not.toHaveBeenCalled();
    expect(deps.launcher.start).not.toHaveBeenCalled();
    expect(deps.launcher.cancel).not.toHaveBeenCalled();
    expect(deps.terminalize).not.toHaveBeenCalled();
  });

  it.each([
    ['missing container identity', undefined],
    ['mismatched container identity', 'stale-container'],
  ])('fails closed when active Worker has %s', async (_label, containerId) => {
    const deps = makeDeps({
      launcher: {
        inspect: vi.fn(async () => ({
          status: 'running',
          attempt_id: ATTEMPT.id,
          ...(containerId ? { container_id: containerId } : {}),
        })),
        start: vi.fn(),
        cancel: vi.fn(),
      },
    });

    const result = await reconcileExpiredAttempt({ attempt: VERIFIED_ATTEMPT, ...deps });

    expect(result).toMatchObject({
      status: 'infrastructure_blocked',
      signature: 'worker_attempt_container_identity_mismatch',
    });
    expect(deps.attemptStore.heartbeat).not.toHaveBeenCalled();
    expect(deps.launcher.start).not.toHaveBeenCalled();
    expect(deps.launcher.cancel).not.toHaveBeenCalled();
    expect(deps.terminalize).not.toHaveBeenCalled();
  });

  it.each([
    ['mismatched Attempt identity', { status: 'running', attempt_id: 'stale-attempt' }],
    ['non-running status', { status: 'prepared', attempt_id: ATTEMPT.id }],
  ])('exact-cancels prepared Worker after %s start acknowledgement', async (_label, startAck) => {
    const deps = makeDeps({
      launcher: {
        inspect: vi.fn(async () => ({
          status: 'prepared',
          attempt_id: ATTEMPT.id,
          container_id: VERIFIED_ATTEMPT.remote_job_id,
        })),
        start: vi.fn(async () => startAck),
        cancel: vi.fn(async () => ({ status: 'cleaned', attempt_id: ATTEMPT.id })),
      },
    });

    const result = await reconcileExpiredAttempt({
      attempt: { ...VERIFIED_ATTEMPT, status: 'starting' },
      ...deps,
    });

    expect(deps.attemptStore.heartbeat).not.toHaveBeenCalled();
    expect(deps.launcher.cancel).toHaveBeenCalledOnce();
    expect(result.status).toBe('replacement_required');
  });

  it('backs off after wrong start acknowledgement when exact cancel is not proven', async () => {
    const deps = makeDeps({
      launcher: {
        inspect: vi.fn(async () => ({
          status: 'prepared',
          attempt_id: ATTEMPT.id,
          container_id: VERIFIED_ATTEMPT.remote_job_id,
        })),
        start: vi.fn(async () => ({ status: 'running', attempt_id: 'stale-attempt' })),
        cancel: vi.fn(async () => ({ status: 'cleaned', attempt_id: 'stale-attempt' })),
      },
    });

    const result = await reconcileExpiredAttempt({
      attempt: { ...VERIFIED_ATTEMPT, status: 'starting' },
      ...deps,
    });

    expect(result).toMatchObject({
      status: 'infrastructure_blocked',
      signature: 'worker_attempt_cancel_unconfirmed',
    });
    expect(deps.attemptStore.heartbeat).not.toHaveBeenCalled();
    expect(deps.terminalize).not.toHaveBeenCalled();
  });

  it.each(['prepared', 'starting', 'running'])(
    'never adopts unconfirmed %s Worker state and replaces only after exact safe cancel',
    async (workerStatus) => {
      const deps = makeDeps({
        launcher: {
          inspect: vi.fn(async () => ({
            status: workerStatus,
            attempt_id: ATTEMPT.id,
          })),
          start: vi.fn(),
          cancel: vi.fn(async () => ({
            status: 'cleaned',
            attempt_id: ATTEMPT.id,
          })),
        },
      });

      const result = await reconcileExpiredAttempt({ attempt: ATTEMPT, ...deps });

      expect(deps.launcher.start).not.toHaveBeenCalled();
      expect(deps.attemptStore.heartbeat).not.toHaveBeenCalled();
      expect(deps.launcher.cancel).toHaveBeenCalledWith({
        attempt: ATTEMPT,
        target: { machine: 'us-mac-m4' },
      });
      expect(deps.terminalize).toHaveBeenCalledWith(expect.objectContaining({
        code: 'worker_attempt_replacement_required_after_lease',
      }));
      expect(result.status).toBe('replacement_required');
    },
  );

  it.each([
    ['missing Attempt identity', { status: 'cleaned' }],
    ['mismatched Attempt identity', { status: 'cleaned', attempt_id: 'stale-attempt' }],
    ['quarantined', { status: 'quarantined', attempt_id: ATTEMPT.id }],
    ['legacy cancelled', { status: 'cancelled', attempt_id: ATTEMPT.id }],
  ])('does not replace an unconfirmed Worker after %s cancel evidence', async (_label, cancelResult) => {
    const deps = makeDeps({
      launcher: {
        inspect: vi.fn(async () => ({ status: 'running', attempt_id: ATTEMPT.id })),
        start: vi.fn(),
        cancel: vi.fn(async () => cancelResult),
      },
    });

    const result = await reconcileExpiredAttempt({ attempt: ATTEMPT, ...deps });

    expect(result).toMatchObject({
      status: 'infrastructure_blocked',
      signature: 'worker_attempt_cancel_unconfirmed',
    });
    expect(deps.terminalize).not.toHaveBeenCalled();
  });

  it.each([
    ['parent_run_terminal', 'parent_terminal'],
    ['lease_owner_mismatch', 'ownership_lost'],
    ['lease_generation_mismatch', 'ownership_lost'],
    ['attempt_identity_mismatch', 'ownership_lost'],
    ['attempt_changed_before_terminal_write', 'ownership_lost'],
  ])('maps terminal authority conflict %s to %s', async (conflict, expectedStatus) => {
    const deps = makeDeps({
      terminalize: vi.fn(async () => ({
        attempt: null,
        hop: null,
        deduped: false,
        conflict,
      })),
    });

    const result = await reconcileExpiredAttempt({ attempt: ATTEMPT, ...deps });

    expect(result).toEqual({ status: expectedStatus, conflict });
  });
});

describe('expired attempt transactional authority', () => {
  function transactionalPool({ insertError = null } = {}) {
    const client = {
      query: vi.fn(async (sql) => {
        if (/SELECT attempt\.\*/i.test(sql)) {
          return { rows: [{ ...ATTEMPT, run_phase: 'gan' }] };
        }
        if (/UPDATE harness_attempts/i.test(sql)) {
          return {
            rows: [{
              ...ATTEMPT,
              status: 'failed',
              error_code: 'worker_attempt_missing_after_lease',
              failure_class: 'infrastructure_blocked',
            }],
          };
        }
        if (/INSERT INTO orchestrator_decision_log/i.test(sql)) {
          if (insertError) throw insertError;
          return { rows: [{ hop: 50 }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    return {
      pool: { connect: vi.fn(async () => client) },
      client,
    };
  }

  const terminalInput = Object.freeze({
    attemptId: ATTEMPT.id,
    runId: ATTEMPT.run_id,
    leaseOwner: ATTEMPT.lease_owner,
    leaseGeneration: ATTEMPT.lease_generation,
    code: 'worker_attempt_missing_after_lease',
    message: 'Worker has no exact state after lease expiry',
    failureClass: 'infrastructure_blocked',
    evidence: {
      attempt_id: ATTEMPT.id,
      prior_lease_generation: 0,
      target: 'us-mac-m4',
      signature: 'worker_attempt_missing_after_lease',
    },
  });

  it('commits exact terminal CAS and bounded decision evidence in one transaction', async () => {
    const { pool, client } = transactionalPool();
    const authority = createExpiredAttemptAuthority(pool);

    const result = await authority.terminalize(terminalInput);

    const statements = client.query.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toBe('BEGIN');
    expect(statements.some((sql) => (
      /UPDATE harness_attempts/i.test(sql)
      && /lease_owner=\$3/i.test(sql)
      && /lease_generation=\$4/i.test(sql)
      && /lease_expires_at < NOW\(\)/i.test(sql)
    ))).toBe(true);
    expect(statements.some((sql) => (
      /INSERT INTO orchestrator_decision_log/i.test(sql)
      && /effect:expired_attempt_reconciled/i.test(sql)
    ))).toBe(true);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ hop: 50, deduped: false });
  });

  it('rolls back the terminal write when evidence append fails', async () => {
    const { pool, client } = transactionalPool({ insertError: new Error('decision_write_failed') });
    const authority = createExpiredAttemptAuthority(pool);

    await expect(authority.terminalize(terminalInput)).rejects.toThrow('decision_write_failed');

    expect(client.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
