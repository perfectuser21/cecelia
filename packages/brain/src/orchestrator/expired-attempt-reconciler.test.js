import { describe, expect, it, vi } from 'vitest';

import {
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

function makeDeps(overrides = {}) {
  return {
    now: () => NOW,
    launcher: {
      inspect: vi.fn(async () => ({ status: 'missing' })),
      start: vi.fn(async () => ({
        status: 'running',
        attempt_id: ATTEMPT.id,
      })),
      cancel: vi.fn(async () => ({ status: 'cancelled' })),
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
        inspect: vi.fn(async () => ({ status: 'prepared' })),
        start: vi.fn(async () => ({ status: 'running', attempt_id: ATTEMPT.id })),
        cancel: vi.fn(),
      },
    });

    const result = await reconcileExpiredAttempt({
      attempt: { ...ATTEMPT, status: 'starting' },
      ...deps,
    });

    expect(deps.launcher.start).toHaveBeenCalledWith({
      attempt: { ...ATTEMPT, status: 'starting' },
      target: { machine: 'us-mac-m4' },
    });
    expect(deps.launcher.start.mock.calls[0][0].attempt).toMatchObject({
      lease_owner: 'controller-old:6328',
      lease_generation: 0,
    });
    expect(result.status).toBe('adopted_prepared');
  });

  it('exact-cancels and replaces prepared state when the old Worker cannot start it', async () => {
    const startError = new Error('remote_bridge_start_http_500');
    const deps = makeDeps({
      launcher: {
        inspect: vi.fn(async () => ({ status: 'prepared' })),
        start: vi.fn(async () => { throw startError; }),
        cancel: vi.fn(async () => ({ status: 'cancelled' })),
      },
    });

    const result = await reconcileExpiredAttempt({
      attempt: { ...ATTEMPT, status: 'starting' },
      ...deps,
    });

    expect(deps.launcher.cancel).toHaveBeenCalledWith({
      attempt: { ...ATTEMPT, status: 'starting' },
      target: { machine: 'us-mac-m4' },
    });
    expect(deps.terminalize).toHaveBeenCalledWith(expect.objectContaining({
      code: 'worker_attempt_replacement_required_after_lease',
      failureClass: 'infrastructure_blocked',
    }));
    expect(result.status).toBe('replacement_required');
  });

  it('keeps a running Worker on the old callback lease and only extends that exact identity', async () => {
    const deps = makeDeps({
      launcher: {
        inspect: vi.fn(async () => ({ status: 'running' })),
        start: vi.fn(),
        cancel: vi.fn(),
      },
    });

    const result = await reconcileExpiredAttempt({ attempt: ATTEMPT, ...deps });

    expect(deps.attemptStore.heartbeat).toHaveBeenCalledWith(ATTEMPT.id, {
      leaseOwner: 'controller-old:6328',
      leaseGeneration: 0,
      leaseSeconds: 180,
    });
    expect(deps.launcher.start).not.toHaveBeenCalled();
    expect(deps.launcher.cancel).not.toHaveBeenCalled();
    expect(result.status).toBe('adopted_running');
  });

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
});
