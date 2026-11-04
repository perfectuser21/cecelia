import './execution-directory-fixture.js';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockPool, mockRaise } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
  mockRaise: vi.fn(),
}));

vi.mock('../../db.js', () => ({ default: { query: (...args) => { boundary.db(...args); throw Error('禁止默认DB'); } } }));

vi.mock('../../notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(true) }));

vi.mock('../../alerting.js', () => ({ raise: mockRaise }));

const boundary = vi.hoisted(() => ({ db: vi.fn(), process: vi.fn(), network: vi.fn() }));

const store = vi.hoisted(() => ({ patch: vi.fn() }));

vi.mock('node:child_process', () => Object.fromEntries(['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync'].map(name => [name, (...args) => { boundary.process(name, ...args); throw Error('禁止宿主进程'); }])));

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', (...args) => { boundary.network(...args); throw Error('禁止外联'); }); });

afterEach(() => {
  expect(boundary.db).not.toHaveBeenCalled();
  expect(boundary.process).not.toHaveBeenCalled();
  expect(boundary.network).not.toHaveBeenCalled();
  // 模拟store只允许记录委托，不得自己制造目标SQL并让断言检验副本。
  for (const [db] of store.patch.mock.calls) {
    const copiedWrites = db.query.mock.calls.filter(([sql]) => /UPDATE\s+initiative_runs\s+SET\s+phase|UPDATE\s+tasks\s+SET\s+status/i.test(String(sql)));
    expect(copiedWrites).toEqual([]);
  }
  vi.unstubAllGlobals();
});

vi.mock('../../orchestrator/kernel-run-store.js', () => ({
  patchKernelRunById: store.patch.mockImplementation(async (db, input) => {
    await db.query(
      `UPDATE initiative_runs SET phase='${input.phase}',
         ${input.failureReason ? `failure_reason=COALESCE(failure_reason, '${input.failureReason}'),` : ''}
         pr_url=COALESCE(pr_url, $2) WHERE id=$1`,
      [input.runId, input.prUrl],
    );
    await db.query(
      `UPDATE tasks SET status='${input.phase === 'done' ? 'completed' : 'failed'}'`,
    );
    return { id: input.runId, phase: input.phase };
  }),
}));

import { resumeStalledRelayRuns, MAX_RELAY_ATTEMPTS, scanStuckHarness } from '../../harness-relay-watchdog.js';

import { sendBark } from '../../notifier.js';

import { createAttemptStore } from '../../orchestrator/attempt-store.js';

const TASK_ID = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

const CONTROLLER_SESSION_ID = '99999999-9999-4999-8999-999999999999';

const SHORT = 'aaaabbbb';

const PR_URL = 'https://github.com/org/repo/pull/42';

function makeDeps({
  taskStatus = 'in_progress',
  attempts = 2,
  containerRunning = false,
  orchestrator = 'skill-relay',
  prUrl = null,
  prState = null,   // 'MERGED' | 'OPEN' | 'CLOSED' | null（execFn 返回的 gh pr view JSON）
  orchestratorHost = 'skill-relay-session',
  evaluatorGate = true, // initiative_run_events 是否存在 node='evaluator' AND status='done'
  mergeStateStatus = undefined, // 'BEHIND' | 'CLEAN' | undefined（gh pr view mergeStateStatus）
  ciChecks = undefined,         // CheckRow[] | undefined（gh pr checks --json state）
  harnessRuntime = null,
  latestAttempt = null,
  orchestratorHeartbeatAt = null,
  startedAt = null,
} = {}) {
  latestAttempt = latestAttempt ? {
    run_id: RUN_ID, hop: 1, phase: 'evaluate', role: 'evaluator', machine_id: 'us-mac-m4',
    lease_owner: 'dispatcher-parent', lease_generation: 0, ...latestAttempt,
  } : null;
  const pool = { query: vi.fn() };
  pool.connect = async () => ({ query: (...args) => pool.query(...args), release: vi.fn() });
  pool.query.mockImplementation(async (sql, params = []) => {
    if (/FROM initiative_runs r(?:\s|$)/.test(sql)) {
      return { rows: [{ id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID, phase: 'planning', attempts: String(attempts), deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: prUrl, orchestrator_host: orchestratorHost, orchestrator_heartbeat_at: orchestratorHeartbeatAt, started_at: startedAt, controller_session_id: CONTROLLER_SESSION_ID, controller_generation: '1' }] };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: [{ id: TASK_ID, status: taskStatus, title: 't', payload: { orchestrator, ...(harnessRuntime ? { harness_runtime: harnessRuntime } : {}) } }] };
    }
    if (/SELECT GREATEST\(/.test(sql)) {
      return { rows: [{ next_hop: Number(latestAttempt?.hop ?? 1) + 1 }] };
    }
    if (/INSERT INTO orchestrator_decision_log/.test(sql)) {
      return { rows: [{ hop: params[1] }] };
    }
    if (
      /guarded_run AS MATERIALIZED \([\s\S]*inserted AS \(\s*INSERT INTO harness_attempts/.test(sql)
    ) {
      return {
        rows: [{
          attempt: {
            id: params[0],
            run_id: params[1],
            hop: params[2],
            status: 'queued',
            local_container_naming: params[9],
            task_bundle: params[13],
            callback_secret_hash: params[14],
            logical_cycle_id: params[15],
            attempt_kind: params[16],
            retry_of_attempt_id: params[17],
          },
          machine_capacity_contended: false,
        }],
      };
    }
    if (/UPDATE harness_attempts\s+SET callback_secret_hash/.test(sql)) {
      return {
        rows: [{
          ...latestAttempt,
          status: 'starting',
          lease_owner: params[1],
          lease_generation: params[3],
          callback_secret_hash: params[2],
        }],
      };
    }
    if (/UPDATE harness_attempts\s+SET status = 'starting'/.test(sql)) {
      if (/lease_generation = lease_generation \+ 1/.test(sql)) {
        return {
          rows: [{
            ...latestAttempt,
            status: 'starting',
            lease_owner: params[1],
            lease_generation: Number(latestAttempt?.lease_generation ?? 0) + 1,
          }],
        };
      }
      return {
        rows: [{
          id: params[0],
          status: 'starting',
          lease_owner: params[1],
          lease_generation: 0,
        }],
      };
    }
    if (/UPDATE harness_attempts\s+SET status = \$2/.test(sql)) {
      return {
        rows: [{
          ...latestAttempt,
          status: params[1],
          error_code: params[2],
        }],
      };
    }
    if (/FROM harness_attempts/.test(sql)) {
      return { rows: latestAttempt ? [latestAttempt] : [] };
    }
    if (/FROM initiative_run_events/.test(sql)) {
      return { rows: evaluatorGate ? [{ x: 1 }] : [] };
    }
    return { rows: [] };
  });
  const execFn = vi.fn().mockImplementation((cmd) => {
    if (/docker ps/.test(cmd)) return containerRunning ? 'abc123\n' : '';
    if (/gh pr view/.test(cmd) && prState) {
      // 若命令含 mergeStateStatus 字段请求，则回传 mergeStateStatus（如提供）
      if (/mergeStateStatus/.test(cmd) && mergeStateStatus !== undefined) {
        return JSON.stringify({ state: prState, mergeStateStatus });
      }
      return JSON.stringify({ state: prState });
    }
    if (/gh pr checks/.test(cmd)) {
      if (ciChecks !== undefined) return JSON.stringify(ciChecks);
      return JSON.stringify([]);
    }
    return '';
  });
  return {
    pool,
    attemptStore: createAttemptStore(pool, { queryOnlyTestAdapter: true }),
    collectCapacitySnapshot: async ({ machineId }) => ({ verified: true, machine: machineId, expires_at: Date.now() + 30_000,
      capacity: { ok: true, physical_base_slots: 7, effective_base_slots: 7 } }),
    launcher: { cancel: vi.fn(async ({ attempt }) => ({ status: 'cleaned', attempt_id: attempt.id })) },
    execFn,
    spawnFn: vi.fn().mockResolvedValue({ ok: true, containerId: 'cecelia-relay-x' }),
  };
}

beforeEach(() => {
  mockPool.query.mockReset();
  mockRaise.mockReset();
  mockRaise.mockResolvedValue(undefined);
  sendBark.mockClear();
});

import { _hasEvaluatorGate, _raiseUngatedMergeAlert, _finalizeMergedRun } from '../../harness-relay-watchdog.js';

import { _parseBaseRepo } from '../../harness-relay-watchdog.js';
export { makeDeps, TASK_ID, RUN_ID, CONTROLLER_SESSION_ID, SHORT, PR_URL, store, resumeStalledRelayRuns, MAX_RELAY_ATTEMPTS, scanStuckHarness, sendBark, _hasEvaluatorGate, _raiseUngatedMergeAlert, _finalizeMergedRun, _parseBaseRepo };
