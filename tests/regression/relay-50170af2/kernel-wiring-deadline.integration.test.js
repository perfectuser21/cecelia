import { describe, expect, test } from 'vitest';
import { runLoop } from '../../../packages/brain/src/orchestrator/loop.js';

const TASK_ID = '10000000-0000-4000-8000-000000000001';
const RUN_ID = '20000000-0000-4000-8000-000000000002';
const BASE_MS = Date.parse('2026-07-23T00:00:00.000Z');
const DEADLINE_MS = BASE_MS + 120 * 60 * 1000;

function observed({ deadlineAt = new Date(DEADLINE_MS), inflight = [] } = {}) {
  return {
    run: { phase: 'planning', cost_usd: '0', deadline_at: deadlineAt },
    task: { status: 'in_progress', payload: {} },
    prdExists: false,
    contract: { approved: false, id: null, row: null },
    pr: null,
    inflight: { containers: inflight, host_pids: [] },
    lastAgentExit: { code: null, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: false,
    evaluateVerdict: null,
    evaluateResult: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: [],
    authCircuit: [],
    callbackResult: null,
  };
}

function harness({ clock, collectGroundTruth, appendHop, dispatch, sleep } = {}) {
  const state = { failureReason: null };
  const pool = {
    async query(sql, params) {
      if (sql.includes('SELECT deadline_at') && sql.includes('initiative_runs')) {
        return { rows: [{ deadline_at: new Date(DEADLINE_MS) }] };
      }
      if (sql.includes('UPDATE initiative_runs') && sql.includes('failure_reason')) {
        state.failureReason = params[1];
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  return {
    state,
    deps: {
      pool,
      collectGroundTruth,
      appendHop: appendHop ?? (async () => {}),
      nextHop: async () => 1,
      writeHeartbeat: async () => {},
      dispatch: dispatch ?? (async () => ({ status: 'DONE' })),
      sleep: sleep ?? (async () => {}),
      now: () => new Date(clock.value),
      log: () => {},
    },
  };
}

describe('kernel wiring: deadline fences through the real runLoop', () => {
  test('119:59 may dispatch, while 120:00 terminates before collect', async () => {
    const beforeClock = { value: DEADLINE_MS - 1000 };
    let beforeDispatches = 0;
    const before = harness({
      clock: beforeClock,
      collectGroundTruth: async () => observed(),
      dispatch: async () => {
        beforeDispatches += 1;
        throw new Error('boundary-dispatched');
      },
    });

    await expect(runLoop(before.deps, { taskId: TASK_ID, runId: RUN_ID }))
      .rejects.toThrow('boundary-dispatched');
    expect(beforeDispatches).toBe(1);

    const atClock = { value: DEADLINE_MS };
    let atCollects = 0;
    const at = harness({
      clock: atClock,
      collectGroundTruth: async () => {
        atCollects += 1;
        return observed();
      },
    });

    const result = await runLoop(at.deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(result.exitReason).toBe('automation_deadline_exceeded');
    expect(atCollects).toBe(0);
    expect(at.state.failureReason).toBe('automation_deadline_exceeded');
  });

  test('derive completion cannot enter a wait branch after the deadline', async () => {
    const clock = { value: DEADLINE_MS - 1000 };
    let sleeps = 0;
    let collections = 0;
    const inflight = new Proxy([], {
      get(target, property, receiver) {
        if (property !== 'length') return Reflect.get(target, property, receiver);
        clock.value = DEADLINE_MS;
        return 1;
      },
    });
    const fixture = harness({
      clock,
      collectGroundTruth: async () => {
        collections += 1;
        return observed({ inflight });
      },
      sleep: async () => { sleeps += 1; },
    });

    const result = await runLoop(fixture.deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(result.exitReason).toBe('automation_deadline_exceeded');
    expect(collections).toBe(1);
    expect(sleeps).toBe(0);
  });

  test('deadline reached after intent persistence still blocks the actual dispatch', async () => {
    const clock = { value: DEADLINE_MS - 1000 };
    let dispatches = 0;
    const fixture = harness({
      clock,
      collectGroundTruth: async () => observed(),
      appendHop: async () => { clock.value = DEADLINE_MS; },
      dispatch: async () => {
        dispatches += 1;
        return { status: 'DONE' };
      },
    });

    const result = await runLoop(fixture.deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(result.exitReason).toBe('automation_deadline_exceeded');
    expect(dispatches).toBe(0);
  });
});
