import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  CANARY_MACHINES,
  assertExecuteSafety,
  buildCleanupCanaryTask,
  launchMachinesConcurrently,
  parseCleanupCanaryArgs,
  runCleanupCanary,
  terminalizeCanaryParent,
  validateCleanupEvidence,
  waitForAttemptRunning,
} from '../../scripts/smoke/kernel-parent-terminal-worker-cleanup.mjs';
import { assertDispatchRoutingReceipt } from '../orchestrator/dispatcher.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';

function activeAttempt(index, overrides = {}) {
  const suffix = String(index).padStart(12, '0');
  const machine = CANARY_MACHINES[index - 1];
  return {
    attempt_id: `33333333-3333-4333-8333-${suffix}`,
    run_id: RUN_ID,
    status: 'running',
    machine_id: machine,
    actual_machine_id: machine,
    requested_machine_id: machine,
    execution_transport: 'fleet-worker',
    lease_owner: `canary-owner-${index}`,
    lease_generation: index,
    ...overrides,
  };
}

describe('parent-terminal Worker cleanup canary safety', () => {
  it('uses one canonical non-coding task snapshot without a routing receipt', () => {
    const task = buildCleanupCanaryTask({
      taskId: TASK_ID,
      runId: RUN_ID,
      machine: CANARY_MACHINES[0],
    });

    expect(task.task_type).toBe('audit');
    expect(task.payload.work_kind).not.toBe('coding_mutation');
    expect(task).not.toHaveProperty('routingReceipt');
    expect(assertDispatchRoutingReceipt(task, undefined, { hasV2Run: true })).toBe(true);

    const source = readFileSync(
      new URL('../../scripts/smoke/kernel-parent-terminal-worker-cleanup.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/INSERT INTO tasks\([^)]*task_type[^)]*\)/);
  });

  it('launches all machines concurrently instead of waiting for the prior machine', async () => {
    const pending = new Map();
    const launch = vi.fn((machine) => new Promise((resolve) => pending.set(machine, resolve)));

    const resultPromise = launchMachinesConcurrently(CANARY_MACHINES, launch);
    await Promise.resolve();
    expect(launch.mock.calls.map(([machine]) => machine)).toEqual(CANARY_MACHINES);

    for (const machine of CANARY_MACHINES) pending.get(machine)({ machine });
    await expect(resultPromise).resolves.toEqual(
      CANARY_MACHINES.map((machine) => ({ machine })),
    );
  });

  it('polls until the exact attempt lease is durably running', async () => {
    const snapshot = activeAttempt(1, { status: undefined });
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [activeAttempt(1, { status: 'starting' })] })
        .mockResolvedValueOnce({ rows: [activeAttempt(1)] }),
    };
    const sleep = vi.fn(async () => {});

    await expect(waitForAttemptRunning({
      pool,
      snapshot,
      timeoutMs: 1_000,
      pollMs: 1,
      sleep,
    })).resolves.toMatchObject(activeAttempt(1));
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('locks run then exact attempts and terminalizes only when all snapshots remain active', async () => {
    const attempts = [activeAttempt(1), activeAttempt(2), activeAttempt(3)];
    const calls = [];
    const client = {
      query: vi.fn(async (sql) => {
        calls.push(String(sql));
        if (String(sql).includes('FROM initiative_runs')) {
          return { rows: [{ id: RUN_ID, phase: 'gan', orchestrator_version: 'v2' }] };
        }
        if (String(sql).includes('FROM harness_attempts')) return { rows: attempts };
        if (String(sql).includes('UPDATE initiative_runs')) return { rows: [{ id: RUN_ID }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };

    await expect(terminalizeCanaryParent({
      pool,
      identity: { run_id: RUN_ID, task_id: TASK_ID },
      attempts,
    })).resolves.toBe(true);

    expect(calls).toEqual([
      'BEGIN',
      expect.stringMatching(/FROM initiative_runs[\s\S]*FOR UPDATE/),
      expect.stringMatching(/FROM harness_attempts[\s\S]*FOR UPDATE/),
      expect.stringContaining('UPDATE initiative_runs'),
      'COMMIT',
    ]);
  });

  it('rolls back parent terminalization if any attempt completed or changed lease', async () => {
    const snapshots = [activeAttempt(1), activeAttempt(2), activeAttempt(3)];
    const current = snapshots.map((attempt) => ({ ...attempt }));
    current[1].status = 'completed';
    const calls = [];
    const client = {
      query: vi.fn(async (sql) => {
        calls.push(String(sql));
        if (String(sql).includes('FROM initiative_runs')) {
          return { rows: [{ id: RUN_ID, phase: 'gan', orchestrator_version: 'v2' }] };
        }
        if (String(sql).includes('FROM harness_attempts')) return { rows: current };
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    await expect(terminalizeCanaryParent({
      pool: { connect: vi.fn(async () => client) },
      identity: { run_id: RUN_ID, task_id: TASK_ID },
      attempts: snapshots,
    })).rejects.toThrow(/attempt snapshot changed before parent terminal/);
    expect(calls).toContain('ROLLBACK');
    expect(calls.some((sql) => sql.includes('UPDATE initiative_runs'))).toBe(false);
  });

  it('requires exact outbox snapshots and canonical confirmation receipts', () => {
    const attempts = [activeAttempt(1), activeAttempt(2), activeAttempt(3)];
    const outbox = attempts.map((attempt, index) => ({
      run_id: attempt.run_id,
      attempt_id: attempt.attempt_id,
      target_machine_id: attempt.machine_id,
      execution_transport: 'fleet-worker',
      lease_owner: attempt.lease_owner,
      lease_generation: attempt.lease_generation,
      status: 'confirmed',
      receipt: {
        contract_version: 'attempt-cleanup-confirmation/v1',
        status: index === 0 ? 'already_clean' : 'cleaned',
        attempt_id: attempt.attempt_id,
        run_id: attempt.run_id,
        target_machine_id: attempt.machine_id,
        execution_transport: 'fleet-worker',
        lease_owner: attempt.lease_owner,
        lease_generation: attempt.lease_generation,
      },
    }));

    expect(validateCleanupEvidence({ attempts, outbox, decisionCount: 3 })).toBe(true);
    outbox[1].receipt.attempt_id = activeAttempt(1).attempt_id;
    expect(() => validateCleanupEvidence({ attempts, outbox, decisionCount: 3 }))
      .toThrow(/cleanup evidence identity mismatch/);
  });

  it('rejects an outbox snapshot from the wrong run', () => {
    const attempt = activeAttempt(1, { execution_transport: 'fleet-worker' });
    const row = {
      run_id: '99999999-9999-4999-8999-999999999999',
      attempt_id: attempt.attempt_id,
      target_machine_id: attempt.machine_id,
      execution_transport: attempt.execution_transport,
      lease_owner: attempt.lease_owner,
      lease_generation: attempt.lease_generation,
      status: 'confirmed',
      receipt: {
        contract_version: 'attempt-cleanup-confirmation/v1',
        status: 'cleaned',
        attempt_id: attempt.attempt_id,
        run_id: attempt.run_id,
        target_machine_id: attempt.machine_id,
        execution_transport: attempt.execution_transport,
        lease_owner: attempt.lease_owner,
        lease_generation: attempt.lease_generation,
      },
    };
    expect(() => validateCleanupEvidence({ attempts: [attempt], outbox: [row], decisionCount: 1 }))
      .toThrow(/cleanup evidence identity mismatch/);
  });

  it('rejects a receipt with the wrong execution transport', () => {
    const attempt = activeAttempt(1, { execution_transport: 'fleet-worker' });
    const row = {
      run_id: attempt.run_id,
      attempt_id: attempt.attempt_id,
      target_machine_id: attempt.machine_id,
      execution_transport: attempt.execution_transport,
      lease_owner: attempt.lease_owner,
      lease_generation: attempt.lease_generation,
      status: 'confirmed',
      receipt: {
        contract_version: 'attempt-cleanup-confirmation/v1',
        status: 'cleaned',
        attempt_id: attempt.attempt_id,
        run_id: attempt.run_id,
        target_machine_id: attempt.machine_id,
        execution_transport: 'remote-bridge',
        lease_owner: attempt.lease_owner,
        lease_generation: attempt.lease_generation,
      },
    };
    expect(() => validateCleanupEvidence({ attempts: [attempt], outbox: [row], decisionCount: 1 }))
      .toThrow(/cleanup evidence identity mismatch/);
  });

  it('scopes every canary drain claim to its generated run identity', () => {
    const source = readFileSync(
      new URL('../../scripts/smoke/kernel-parent-terminal-worker-cleanup.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/harness_attempt_cleanup_outbox[\s\S]*run_id\s*=\s*\$4/);
    expect(source).toMatch(/createAttemptCleanupWorker\(\{[\s\S]*storeFactory:/);
  });

  it('defaults to a side-effect-free dry-run with no implicit machines', () => {
    expect(parseCleanupCanaryArgs([])).toEqual({
      execute: false,
      dryRun: true,
      acknowledged: false,
      machines: [],
      timeoutMs: 120_000,
      pollMs: 1_000,
    });
  });

  it('requires execute, the exact acknowledgement, and an explicit three-machine list', () => {
    const valid = parseCleanupCanaryArgs([
      '--execute',
      '--ack-isolated-canary-cleanup',
      '--machines',
      CANARY_MACHINES.join(','),
    ]);
    expect(assertExecuteSafety(valid)).toBe(true);

    for (const args of [
      { ...valid, execute: false, dryRun: true },
      { ...valid, acknowledged: false },
      { ...valid, machines: CANARY_MACHINES.slice(0, 2) },
      { ...valid, machines: [...CANARY_MACHINES, 'unknown-machine'] },
    ]) {
      expect(() => assertExecuteSafety(args)).toThrow(/live cleanup canary refused/);
    }
  });

  it('dry-run creates isolated identities and never constructs live operations', async () => {
    const createLiveOperations = vi.fn();
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ];

    const result = await runCleanupCanary({
      args: parseCleanupCanaryArgs([]),
      randomId: () => ids.shift(),
      createLiveOperations,
    });

    expect(result).toMatchObject({
      dry_run: true,
      identity: {
        task_id: '11111111-1111-4111-8111-111111111111',
        initiative_id: '22222222-2222-4222-8222-222222222222',
        run_id: '33333333-3333-4333-8333-333333333333',
        controller_session_id: '44444444-4444-4444-8444-444444444444',
      },
    });
    expect(result.steps).toEqual(expect.arrayContaining([
      'terminalize isolated parent run',
      'wait for confirmed outbox, decision, and non-live Worker inspect',
      'run a second drain and require zero claims',
    ]));
    expect(createLiveOperations).not.toHaveBeenCalled();
  });

  it('executes the bounded sequence and finalizes only the generated identity', async () => {
    const calls = [];
    const operations = {
      createIdentity: vi.fn(async (identity) => calls.push(['create', identity])),
      launchAttempts: vi.fn(async () => {
        calls.push(['launch']);
        return [{ attempt_id: 'attempt-a' }];
      }),
      terminalizeParent: vi.fn(async () => calls.push(['terminalize'])),
      drainUntilConfirmed: vi.fn(async () => {
        calls.push(['drain']);
        return { confirmed: true, outbox_count: 3, decision_count: 3 };
      }),
      inspectWorkers: vi.fn(async () => {
        calls.push(['inspect']);
        return [{ status: 'missing' }];
      }),
      drainAgain: vi.fn(async () => {
        calls.push(['drain-again']);
        return { claimed: 0 };
      }),
      finalize: vi.fn(async (identity) => calls.push(['finalize', identity])),
    };
    const createLiveOperations = vi.fn(async () => operations);
    const args = parseCleanupCanaryArgs([
      '--execute',
      '--ack-isolated-canary-cleanup',
      '--machines',
      CANARY_MACHINES.join(','),
    ]);

    const result = await runCleanupCanary({ args, createLiveOperations });

    expect(result.dry_run).toBe(false);
    expect(calls.map(([name]) => name)).toEqual([
      'create', 'launch', 'terminalize', 'drain', 'inspect', 'drain-again', 'finalize',
    ]);
    const generatedIdentity = calls[0][1];
    expect(operations.finalize).toHaveBeenCalledWith(generatedIdentity);
    expect(operations.drainAgain).toHaveBeenCalledOnce();
    expect(result.second_drain).toEqual({ claimed: 0 });
  });
});
