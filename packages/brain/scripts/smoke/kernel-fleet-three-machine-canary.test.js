/* global AbortSignal, setTimeout */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MACHINE_IDS,
  assertLiveSafety,
  createLiveDispatch,
  parseCanaryArgs,
  runThreeMachineCanary,
} from './kernel-fleet-three-machine-canary.mjs';

const liveMocks = vi.hoisted(() => ({
  pool: {
    query: vi.fn(),
    end: vi.fn(),
  },
  buildRealDeps: vi.fn(),
}));

vi.mock('../../src/db.js', () => ({ default: liveMocks.pool }));
vi.mock('../../src/orchestrator/run.js', () => ({
  buildRealDeps: liveMocks.buildRealDeps,
}));

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_IDS = {
  'us-mac-m4': '22222222-2222-4222-8222-222222222222',
  'xian-mac-m4': '33333333-3333-4333-8333-333333333333',
  'xian-mac-m1': '44444444-4444-4444-8444-444444444444',
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function completedEvidence(machine, overrides = {}) {
  const remote = machine !== 'us-mac-m4';
  return {
    attempt_id: ATTEMPT_IDS[machine],
    run_id: RUN_ID,
    requested_machine_id: machine,
    actual_machine_id: machine,
    execution_transport: remote ? 'remote-bridge' : 'local-docker',
    lease_generation: 0,
    local_container_naming: 'generation-v1',
    machine_attestation_status: remote ? 'verified' : 'local',
    status: 'completed',
    started_at: '2026-07-26T01:00:00.000Z',
    completed_at: '2026-07-26T01:00:01.000Z',
    result: {
      artifacts: [],
      checks: [],
      decision: { outcome: 'CANARY_OK' },
      error: null,
      provider_metadata: { provider: 'codex' },
    },
    ...overrides,
  };
}

describe('runThreeMachineCanary', () => {
  it('serial waits for US M4 before xian M4 before xian M1', async () => {
    const gates = new Map(MACHINE_IDS.map((machine) => [machine, deferred()]));
    const starts = [];
    const dispatch = vi.fn(async ({ machine }) => {
      starts.push(machine);
      await gates.get(machine).promise;
      return completedEvidence(machine);
    });

    const running = runThreeMachineCanary({
      mode: 'serial',
      runId: RUN_ID,
      dispatch,
      clock: () => new Date('2026-07-26T01:00:00.000Z'),
    });

    await vi.waitFor(() => expect(starts).toEqual(['us-mac-m4']));
    gates.get('us-mac-m4').resolve();
    await vi.waitFor(() => expect(starts).toEqual(['us-mac-m4', 'xian-mac-m4']));
    gates.get('xian-mac-m4').resolve();
    await vi.waitFor(() => expect(starts).toEqual(MACHINE_IDS.slice(0, 3)));
    gates.get('xian-mac-m1').resolve();

    await expect(running).resolves.toMatchObject({ mode: 'serial', passed: true });
  });

  it('parallel starts all three machines before any dispatch resolves', async () => {
    const gates = new Map(MACHINE_IDS.map((machine) => [machine, deferred()]));
    const starts = [];
    const dispatch = vi.fn(async ({ machine }) => {
      starts.push(machine);
      await gates.get(machine).promise;
      const windows = {
        'us-mac-m4': ['2026-07-26T01:00:00.000Z', '2026-07-26T01:00:03.000Z'],
        'xian-mac-m4': ['2026-07-26T01:00:01.000Z', '2026-07-26T01:00:04.000Z'],
        'xian-mac-m1': ['2026-07-26T01:00:05.000Z', '2026-07-26T01:00:06.000Z'],
      };
      return completedEvidence(machine, {
        started_at: windows[machine][0],
        completed_at: windows[machine][1],
      });
    });

    const running = runThreeMachineCanary({
      mode: 'parallel',
      runId: RUN_ID,
      dispatch,
      clock: () => new Date('2026-07-26T01:00:00.000Z'),
    });

    await vi.waitFor(() => expect(new Set(starts)).toEqual(new Set(MACHINE_IDS)));
    expect(dispatch).toHaveBeenCalledTimes(3);
    for (const gate of gates.values()) gate.resolve();

    await expect(running).resolves.toMatchObject({
      mode: 'parallel',
      passed: true,
      overlapping_machine_count: 2,
    });
  });

  it('keeps one Run ID and unique Attempt IDs across all machines', async () => {
    const result = await runThreeMachineCanary({
      mode: 'serial',
      runId: RUN_ID,
      dispatch: vi.fn(async ({ machine }) => completedEvidence(machine)),
      clock: () => new Date('2026-07-26T01:00:00.000Z'),
    });

    expect(new Set(result.evidence.map((row) => row.run_id))).toEqual(new Set([RUN_ID]));
    expect(new Set(result.evidence.map((row) => row.attempt_id)).size).toBe(3);
  });

  it('strict mode rejects requested/actual machine mismatch', async () => {
    const dispatch = vi.fn(async ({ machine }) => completedEvidence(machine, machine === 'xian-mac-m4'
      ? { actual_machine_id: 'us-mac-m4' }
      : {}));

    await expect(runThreeMachineCanary({
      mode: 'serial',
      strict: true,
      runId: RUN_ID,
      dispatch,
      clock: () => new Date('2026-07-26T01:00:00.000Z'),
    })).rejects.toThrow('machine_receipt_mismatch:xian-mac-m4:us-mac-m4');
  });

  it('rejects a completed callback without the canary decision', async () => {
    const dispatch = vi.fn(async ({ machine }) => completedEvidence(machine, {
      result: {
        artifacts: [],
        checks: [],
        decision: null,
        error: null,
        provider_metadata: { provider: 'codex' },
      },
    }));

    await expect(runThreeMachineCanary({
      mode: 'serial',
      strict: true,
      runId: RUN_ID,
      dispatch,
      clock: () => new Date('2026-07-26T01:00:00.000Z'),
    })).rejects.toThrow(`canary_decision_mismatch:${ATTEMPT_IDS['us-mac-m4']}`);
  });

  it('rejects a completed callback that did not execute through Codex', async () => {
    const dispatch = vi.fn(async ({ machine }) => completedEvidence(machine, {
      result: {
        artifacts: [],
        checks: [],
        decision: { outcome: 'CANARY_OK' },
        error: null,
        provider_metadata: { provider: 'claude' },
      },
    }));

    await expect(runThreeMachineCanary({
      mode: 'serial',
      strict: true,
      runId: RUN_ID,
      dispatch,
      clock: () => new Date('2026-07-26T01:00:00.000Z'),
    })).rejects.toThrow(
      `canary_provider_mismatch:${ATTEMPT_IDS['us-mac-m4']}:claude`,
    );
  });

  it('rejects a completed callback with a non-empty side-effect envelope', async () => {
    const dispatch = vi.fn(async ({ machine }) => completedEvidence(machine, {
      result: {
        artifacts: ['unexpected'],
        checks: [],
        decision: { outcome: 'CANARY_OK' },
        error: null,
        provider_metadata: { provider: 'codex' },
      },
    }));

    await expect(runThreeMachineCanary({
      mode: 'serial',
      strict: true,
      runId: RUN_ID,
      dispatch,
      clock: () => new Date('2026-07-26T01:00:00.000Z'),
    })).rejects.toThrow(
      `canary_side_effect_envelope:${ATTEMPT_IDS['us-mac-m4']}`,
    );
  });

  it('non-strict failure creates a new Attempt instead of mutating the failed one', async () => {
    const failedId = '55555555-5555-4555-8555-555555555555';
    let m4Calls = 0;
    const dispatch = vi.fn(async ({ machine }) => {
      if (machine === 'xian-mac-m4' && m4Calls++ === 0) {
        return completedEvidence(machine, {
          attempt_id: failedId,
          status: 'failed',
          completed_at: '2026-07-26T01:00:00.500Z',
        });
      }
      return completedEvidence(machine);
    });

    const result = await runThreeMachineCanary({
      mode: 'serial',
      strict: false,
      runId: RUN_ID,
      dispatch,
      clock: () => new Date('2026-07-26T01:00:00.000Z'),
    });

    const m4Attempts = result.attempts.filter(
      (row) => row.requested_machine_id === 'xian-mac-m4',
    );
    expect(m4Attempts.map((row) => row.attempt_id)).toEqual([
      failedId,
      ATTEMPT_IDS['xian-mac-m4'],
    ]);
    expect(new Set(m4Attempts.map((row) => row.attempt_id)).size).toBe(2);
  });

  it('deduplicates repeated terminal callbacks without increasing terminal count', async () => {
    const dispatch = vi.fn(async ({ machine }) => {
      const callback = completedEvidence(machine);
      return machine === 'xian-mac-m1' ? [callback, { ...callback }] : callback;
    });

    const result = await runThreeMachineCanary({
      mode: 'serial',
      runId: RUN_ID,
      dispatch,
      clock: () => new Date('2026-07-26T01:00:00.000Z'),
    });

    expect(result.terminal_count).toBe(3);
    expect(result.duplicate_callback_count).toBe(1);
    expect(result.evidence).toHaveLength(3);
  });

  it('parallel waits for every machine terminal and reports all evidence after an early failure', async () => {
    const gates = {
      'us-mac-m4': deferred(),
      'xian-mac-m1': deferred(),
    };
    const starts = [];
    const dispatch = vi.fn(async ({ machine }) => {
      starts.push(machine);
      if (machine === 'xian-mac-m4') {
        return completedEvidence(machine, { actual_machine_id: 'us-mac-m4' });
      }
      await gates[machine].promise;
      return completedEvidence(machine);
    });

    const observed = runThreeMachineCanary({
      mode: 'parallel',
      strict: true,
      runId: RUN_ID,
      dispatch,
      clock: () => new Date('2026-07-26T01:00:00.000Z'),
    }).then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason }),
    );

    await vi.waitFor(() => expect(new Set(starts)).toEqual(new Set(MACHINE_IDS)));
    const early = await Promise.race([
      observed,
      new Promise((resolve) => setTimeout(() => resolve('pending'), 10)),
    ]);
    gates['us-mac-m4'].resolve();
    gates['xian-mac-m1'].resolve();
    const settled = await observed;

    expect(early).toBe('pending');
    expect(settled.status).toBe('fulfilled');
    expect(settled.value).toMatchObject({ passed: false, mode: 'parallel' });
    expect(settled.value.machine_results).toHaveLength(3);
    expect(settled.value.evidence).toHaveLength(3);
    expect(settled.value.machine_results.every((row) => row.evidence?.status === 'completed'))
      .toBe(true);
  });
});

describe('canary CLI safety', () => {
  it('defaults to dry-run', () => {
    expect(parseCanaryArgs([])).toMatchObject({
      dryRun: true,
      execute: false,
      mode: 'serial',
    });
  });

  it('requires every live acknowledgement and the exact local Brain URL', () => {
    const safe = parseCanaryArgs([
      '--execute',
      '--run-id', RUN_ID,
      '--brain-url', 'http://localhost:5221',
      '--ack-no-business-writes',
    ]);
    expect(() => assertLiveSafety(safe)).not.toThrow();

    for (const argv of [
      ['--execute', '--brain-url', 'http://localhost:5221', '--ack-no-business-writes'],
      ['--execute', '--run-id', RUN_ID, '--ack-no-business-writes'],
      ['--execute', '--run-id', RUN_ID, '--brain-url', 'http://127.0.0.1:5221', '--ack-no-business-writes'],
      ['--execute', '--run-id', RUN_ID, '--brain-url', 'http://localhost:5221'],
      ['--execute', '--run-id', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', '--brain-url', 'http://localhost:5221', '--ack-no-business-writes'],
    ]) {
      expect(() => assertLiveSafety(parseCanaryArgs(argv))).toThrow(/live canary refused/);
    }
  });
});

describe('createLiveDispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a schema-valid synthetic initiative run with a non-null initiative_id', async () => {
    liveMocks.pool.query.mockImplementation(async (sql, params) => {
      if (/INSERT INTO initiative_runs/.test(sql)) {
        expect(sql).toMatch(/\(\s*id,\s*initiative_id,/);
        expect(sql).toContain("'v1'");
        expect(sql).not.toContain("'v2'");
        expect(params).toEqual([RUN_ID, RUN_ID]);
        return { rows: [{ id: RUN_ID }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    await createLiveDispatch({
      runId: RUN_ID,
      brainUrl: 'http://localhost:5221',
      fetchFn: vi.fn(async () => ({ ok: true, status: 200 })),
    });

    expect(liveMocks.pool.query).toHaveBeenCalledOnce();
  });

  it('refuses an existing canary run id instead of replaying old completed attempts', async () => {
    liveMocks.pool.query.mockImplementation(async (sql) => {
      if (/INSERT INTO initiative_runs/.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      if (/SELECT initiative_id, orchestrator_host/.test(sql)) {
        return {
          rows: [{
            initiative_id: RUN_ID,
            orchestrator_host: 'kernel-fleet-canary',
          }],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    await expect(createLiveDispatch({
      runId: RUN_ID,
      brainUrl: 'http://localhost:5221',
      fetchFn: vi.fn(async () => ({ ok: true, status: 200 })),
    })).rejects.toThrow(`live canary refused: run id already exists: ${RUN_ID}`);
  });

  it('uses each machine canonical account boundary through the real live dispatch adapter', async () => {
    const attemptByMachine = {
      'us-mac-m4': ATTEMPT_IDS['us-mac-m4'],
      'xian-mac-m4': ATTEMPT_IDS['xian-mac-m4'],
      'xian-mac-m1': ATTEMPT_IDS['xian-mac-m1'],
    };
    const dispatchCalls = [];
    const removeContainerFn = vi.fn(async () => true);
    const removeLocalWorkspace = vi.fn();
    liveMocks.pool.query.mockImplementation(async (sql, params) => {
      if (/INSERT INTO initiative_runs/.test(sql)) return { rows: [{ id: RUN_ID }], rowCount: 1 };
      if (/FROM harness_attempts/.test(sql)) {
        const machine = Object.entries(attemptByMachine)
          .find(([, attemptId]) => attemptId === params[0])?.[0];
        return { rows: [completedEvidence(machine)] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    liveMocks.buildRealDeps.mockImplementation(async ({ machineId }) => ({
      dispatch: vi.fn(async (_action, context) => {
        dispatchCalls.push({ machine: machineId, context });
        return { attemptId: attemptByMachine[machineId] };
      }),
    }));
    const dispatch = await createLiveDispatch({
      runId: RUN_ID,
      brainUrl: 'http://localhost:5221',
      fetchFn: vi.fn(async () => ({ ok: true, status: 200 })),
      createLocalWorkspace: vi.fn(() => '/tmp/private-kernel-canary'),
      removeLocalWorkspace,
      removeContainerFn,
    });

    for (const machine of MACHINE_IDS) {
      await dispatch({ machine, attemptNumber: 1 });
    }
    await dispatch.close();

    expect(dispatchCalls.map(({ machine, context }) => [
      machine,
      context.observed.task.payload.role_assignments.reporter.account,
    ])).toEqual([
      ['us-mac-m4', 'team1'],
      ['xian-mac-m4', 'team2'],
      ['xian-mac-m1', 'team5'],
    ]);
    expect(removeContainerFn).toHaveBeenCalledWith(
      `cecelia-harness-${ATTEMPT_IDS['us-mac-m4'].slice(0, 8)}-g0`,
    );
    const pollSql = liveMocks.pool.query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => /FROM harness_attempts/.test(sql));
    expect(pollSql).toContain('local_container_naming');
    expect(pollSql).not.toContain('local_container_id');
    expect(removeLocalWorkspace).toHaveBeenCalledWith('/tmp/private-kernel-canary');
  });

  it('cancels and removes the local container when its callback times out', async () => {
    const removeContainerFn = vi.fn(async () => true);
    const cancelAttemptFn = vi.fn(async () => true);
    liveMocks.pool.query.mockImplementation(async (sql) => {
      if (/INSERT INTO initiative_runs/.test(sql)) {
        return { rows: [{ id: RUN_ID }], rowCount: 1 };
      }
      if (/FROM harness_attempts/.test(sql)) {
        return {
          rows: [{
            ...completedEvidence('us-mac-m4', { status: 'running' }),
            lease_owner: 'canary:test',
            lease_generation: 0,
          }],
        };
      }
      if (/UPDATE harness_attempts/.test(sql)) {
        return { rows: [{ id: ATTEMPT_IDS['us-mac-m4'], status: 'cancelled' }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    liveMocks.buildRealDeps.mockResolvedValue({
      dispatch: vi.fn(async () => ({ attemptId: ATTEMPT_IDS['us-mac-m4'] })),
    });
    const dispatch = await createLiveDispatch({
      runId: RUN_ID,
      brainUrl: 'http://localhost:5221',
      fetchFn: vi.fn(async () => ({ ok: true, status: 200 })),
      timeoutMs: 5,
      pollMs: 1,
      createLocalWorkspace: vi.fn(() => '/tmp/private-kernel-canary'),
      removeLocalWorkspace: vi.fn(),
      removeContainerFn,
      cancelAttemptFn,
    });

    await expect(dispatch({
      machine: 'us-mac-m4',
      attemptNumber: 1,
    })).rejects.toThrow(`canary_callback_timeout:${ATTEMPT_IDS['us-mac-m4']}`);

    expect(removeContainerFn).toHaveBeenCalledOnce();
    expect(cancelAttemptFn).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt_id: ATTEMPT_IDS['us-mac-m4'],
        lease_owner: 'canary:test',
        lease_generation: 0,
      }),
      'us-mac-m4',
    );
    await dispatch.close();
  });

  it('cancels a remote attempt when its callback times out', async () => {
    const cancelAttemptFn = vi.fn(async () => true);
    liveMocks.pool.query.mockImplementation(async (sql) => {
      if (/INSERT INTO initiative_runs/.test(sql)) {
        return { rows: [{ id: RUN_ID }], rowCount: 1 };
      }
      if (/FROM harness_attempts/.test(sql)) {
        return {
          rows: [{
            ...completedEvidence('xian-mac-m4', { status: 'running' }),
            lease_owner: 'canary:test',
            lease_generation: 2,
          }],
        };
      }
      if (/UPDATE harness_attempts/.test(sql)) {
        return { rows: [{ id: ATTEMPT_IDS['xian-mac-m4'], status: 'cancelled' }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    liveMocks.buildRealDeps.mockResolvedValue({
      dispatch: vi.fn(async () => ({ attemptId: ATTEMPT_IDS['xian-mac-m4'] })),
    });
    const dispatch = await createLiveDispatch({
      runId: RUN_ID,
      brainUrl: 'http://localhost:5221',
      fetchFn: vi.fn(async () => ({ ok: true, status: 200 })),
      timeoutMs: 5,
      pollMs: 1,
      cancelAttemptFn,
    });

    await expect(dispatch({
      machine: 'xian-mac-m4',
      attemptNumber: 1,
    })).rejects.toThrow(`canary_callback_timeout:${ATTEMPT_IDS['xian-mac-m4']}`);

    expect(cancelAttemptFn).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt_id: ATTEMPT_IDS['xian-mac-m4'],
        lease_owner: 'canary:test',
        lease_generation: 2,
      }),
      'xian-mac-m4',
    );
    await dispatch.close();
  });

  it('fails cleanup when the remote Bridge rejects the lease-fenced cancel', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url === 'http://localhost:5221/api/brain/health') {
        return { ok: true, status: 200 };
      }
      return {
        ok: false,
        status: 409,
        json: vi.fn(async () => ({ status: 'rejected' })),
      };
    });
    liveMocks.pool.query.mockImplementation(async (sql) => {
      if (/INSERT INTO initiative_runs/.test(sql)) {
        return { rows: [{ id: RUN_ID }], rowCount: 1 };
      }
      if (/FROM harness_attempts/.test(sql)) {
        return {
          rows: [{
            ...completedEvidence('xian-mac-m4', { status: 'running' }),
            lease_owner: 'stale-owner',
            lease_generation: 1,
          }],
        };
      }
      if (/UPDATE harness_attempts/.test(sql)) return { rows: [], rowCount: 0 };
      if (/SELECT \* FROM harness_attempts/.test(sql)) {
        return { rows: [{ status: 'running' }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    liveMocks.buildRealDeps.mockResolvedValue({
      dispatch: vi.fn(async () => ({ attemptId: ATTEMPT_IDS['xian-mac-m4'] })),
    });
    const dispatch = await createLiveDispatch({
      runId: RUN_ID,
      brainUrl: 'http://localhost:5221',
      env: {
        KERNEL_FLEET_BRIDGE_TOKEN: 'shared-secret-at-least-thirty-two-characters',
        XIAN_M4_KERNEL_BRIDGE_URL: 'http://xian-m4.internal:3458',
      },
      fetchFn,
      timeoutMs: 5,
      pollMs: 1,
    });

    await expect(dispatch({
      machine: 'xian-mac-m4',
      attemptNumber: 1,
    })).rejects.toThrow(`canary_cleanup_failed:${ATTEMPT_IDS['xian-mac-m4']}`);
    await dispatch.close();
  });

  it('uses the authenticated production Bridge cancel path and fences the DB row', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url === 'http://localhost:5221/api/brain/health') {
        return { ok: true, status: 200 };
      }
      return {
        ok: true,
        status: 200,
        json: vi.fn(async () => ({
          status: 'cleaned',
          attempt_id: ATTEMPT_IDS['xian-mac-m1'],
        })),
      };
    });
    liveMocks.pool.query.mockImplementation(async (sql) => {
      if (/INSERT INTO initiative_runs/.test(sql)) {
        return { rows: [{ id: RUN_ID }], rowCount: 1 };
      }
      if (/FROM harness_attempts/.test(sql)) {
        return {
          rows: [{
            ...completedEvidence('xian-mac-m1', { status: 'running' }),
            lease_owner: 'canary:test',
            lease_generation: 3,
          }],
        };
      }
      if (/UPDATE harness_attempts/.test(sql)) {
        return { rows: [{ id: ATTEMPT_IDS['xian-mac-m1'], status: 'cancelled' }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    liveMocks.buildRealDeps.mockResolvedValue({
      dispatch: vi.fn(async () => ({ attemptId: ATTEMPT_IDS['xian-mac-m1'] })),
    });
    const dispatch = await createLiveDispatch({
      runId: RUN_ID,
      brainUrl: 'http://localhost:5221',
      env: {
        KERNEL_FLEET_BRIDGE_TOKEN: 'shared-secret-at-least-thirty-two-characters',
        XIAN_M1_KERNEL_BRIDGE_URL: 'http://xian-m1.internal:3458',
      },
      fetchFn,
      timeoutMs: 5,
      pollMs: 1,
    });

    await expect(dispatch({
      machine: 'xian-mac-m1',
      attemptNumber: 1,
    })).rejects.toThrow(`canary_callback_timeout:${ATTEMPT_IDS['xian-mac-m1']}`);

    expect(fetchFn).toHaveBeenCalledWith(
      `http://xian-m1.internal:3458/harness/attempts/${ATTEMPT_IDS['xian-mac-m1']}/cancel`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer shared-secret-at-least-thirty-two-characters',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lease_owner: 'canary:test',
          lease_generation: 3,
        }),
      }),
    );
    expect(liveMocks.pool.query.mock.calls.some(([sql]) => (
      /UPDATE harness_attempts/.test(sql)
    ))).toBe(true);
    await dispatch.close();
  });

  it('cleans up the launched attempt when polling the database fails', async () => {
    const cancelAttemptFn = vi.fn(async () => true);
    liveMocks.pool.query.mockImplementation(async (sql) => {
      if (/INSERT INTO initiative_runs/.test(sql)) {
        return { rows: [{ id: RUN_ID }], rowCount: 1 };
      }
      if (/FROM harness_attempts/.test(sql)) throw new Error('postgres unavailable');
      if (/UPDATE harness_attempts/.test(sql)) {
        return { rows: [{ id: ATTEMPT_IDS['xian-mac-m1'], status: 'cancelled' }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    liveMocks.buildRealDeps.mockResolvedValue({
      dispatch: vi.fn(async () => ({
        attemptId: ATTEMPT_IDS['xian-mac-m1'],
        leaseOwner: 'canary:test',
        leaseGeneration: 0,
        localContainerNaming: 'generation-v1',
      })),
    });
    const dispatch = await createLiveDispatch({
      runId: RUN_ID,
      brainUrl: 'http://localhost:5221',
      fetchFn: vi.fn(async () => ({ ok: true, status: 200 })),
      cancelAttemptFn,
    });

    await expect(dispatch({
      machine: 'xian-mac-m1',
      attemptNumber: 1,
    })).rejects.toThrow(/canary_poll_failed.*postgres unavailable/);

    expect(cancelAttemptFn).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt_id: ATTEMPT_IDS['xian-mac-m1'],
        lease_owner: 'canary:test',
        lease_generation: 0,
      }),
      'xian-mac-m1',
    );
    await dispatch.close();
  });

  it('bounds the local Brain health request with an abort timeout', async () => {
    const fetchFn = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal.reason), {
        once: true,
      });
    }));

    await expect(createLiveDispatch({
      runId: RUN_ID,
      brainUrl: 'http://localhost:5221',
      fetchFn,
      healthTimeoutMs: 5,
    })).rejects.toThrow(/health.*timed out/i);

    expect(fetchFn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
