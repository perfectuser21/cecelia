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
    machine_attestation_status: remote ? 'verified' : 'local',
    status: 'completed',
    started_at: '2026-07-26T01:00:00.000Z',
    completed_at: '2026-07-26T01:00:01.000Z',
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

  it.skip('parallel waits for every machine terminal and reports all evidence after an early failure', async () => {
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

  it('uses each machine canonical account boundary through the real live dispatch adapter', async () => {
    const attemptByMachine = {
      'us-mac-m4': ATTEMPT_IDS['us-mac-m4'],
      'xian-mac-m4': ATTEMPT_IDS['xian-mac-m4'],
      'xian-mac-m1': ATTEMPT_IDS['xian-mac-m1'],
    };
    const dispatchCalls = [];
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
    });

    for (const machine of MACHINE_IDS) {
      await dispatch({ machine, attemptNumber: 1 });
    }

    expect(dispatchCalls.map(({ machine, context }) => [
      machine,
      context.observed.task.payload.role_assignments.reviewer.account,
    ])).toEqual([
      ['us-mac-m4', 'team1'],
      ['xian-mac-m4', 'team2'],
      ['xian-mac-m1', 'team5'],
    ]);
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
