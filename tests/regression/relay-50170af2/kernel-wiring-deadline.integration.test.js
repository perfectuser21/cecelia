import { describe, expect, test } from 'vitest';
import { runLoop } from '../../../packages/brain/src/orchestrator/loop.js';

const TASK_ID = '10000000-0000-4000-8000-000000000001';
const RUN_ID = '20000000-0000-4000-8000-000000000002';
const BASE_MS = Date.parse('2026-07-23T00:00:00.000Z');
const DEADLINE_MS = BASE_MS + 8 * 60 * 60 * 1000;

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
      finalizeRun: async (_pool, input) => {
        state.failureReason = input.reason;
        expect(input).toMatchObject({
          runId: RUN_ID,
          expectedTaskId: TASK_ID,
          outcome: 'failed',
        });
      },
    },
  };
}

describe('kernel wiring: deadline fences through the real runLoop', () => {
  test('the instant before the activity deadline may dispatch; the boundary terminates before collect', async () => {
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

  test('an open current-SHA human review pauses an already-expired deadline in the real loop', async () => {
    const headSha = 'a'.repeat(40);
    const expired = new Date(BASE_MS - 1000);
    const reviewRequest = {
      hop: 9,
      action: 'effect:human_review_requested',
      observed: { pr: { head_sha: headSha } },
      detail: { dispatch_hop: 8 },
      created_at: new Date(BASE_MS - 60_000),
    };
    const state = { failedWrites: 0, collects: 0, reviewQueries: [] };
    const pool = {
      async query(sql) {
        const normalized = String(sql);
        if (/UPDATE initiative_runs/i.test(normalized) && /failure_reason/i.test(normalized)) {
          state.failedWrites += 1;
          return { rows: [], rowCount: 1 };
        }
        if (/orchestrator_decision_log/i.test(normalized)) {
          state.reviewQueries.push(normalized);
          return {
            rows: [{
              ...reviewRequest,
              review_request_hop: reviewRequest.hop,
              review_head_sha: headSha,
            }],
            rowCount: 1,
          };
        }
        if (/initiative_runs/i.test(normalized)) {
          return {
            rows: [{
              deadline_at: expired,
              phase: 'review',
              open_human_review: true,
              review_request_hop: reviewRequest.hop,
              review_head_sha: headSha,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    const stop = new Error('open-review-sleep-sentinel');
    const deps = {
      pool,
      collectGroundTruth: async () => {
        state.collects += 1;
        return {
          run: { phase: 'review', cost_usd: '0', deadline_at: expired },
          task: { status: 'in_progress', payload: {} },
          prdExists: true,
          contract: { approved: true, id: 'contract-1', row: {} },
          pr: {
            url: 'https://github.com/example/repo/pull/1',
            state: 'OPEN',
            merged: false,
            ci: 'pass',
            head_sha: headSha,
          },
          inflight: { containers: [], host_pids: [] },
          lastAgentExit: { code: null, auth_failed: false },
          proposeBranchRn: 0,
          ganLatestRoundVerdict: null,
          generatorSpawned: true,
          evaluateVerdict: { verdict: 'PASS', pr_head_sha: headSha },
          evaluateResult: null,
          judgeVerdict: { verdict: 'PASS', pr_head_sha: headSha },
          reviewRequired: true,
          reviewApproved: false,
          decisionLog: [reviewRequest],
          authCircuit: [],
          callbackResult: null,
        };
      },
      appendHop: async () => {},
      nextHop: async () => 10,
      writeHeartbeat: async () => {},
      dispatch: async () => {
        throw new Error('open review must not redispatch');
      },
      sleep: async () => { throw stop; },
      now: () => new Date(BASE_MS),
      log: () => {},
    };

    await expect(runLoop(deps, { taskId: TASK_ID, runId: RUN_ID }))
      .rejects.toThrow('open-review-sleep-sentinel');
    expect(state.collects).toBe(1);
    expect(state.failedWrites).toBe(0);
  });

  test('a stale open request cannot pause deadline when current derive is not human review', async () => {
    const headSha = 'a'.repeat(40);
    const expired = new Date(BASE_MS - 1000);
    const reviewRequest = {
      hop: 9,
      action: 'effect:human_review_requested',
      observed: { pr: { head_sha: headSha } },
      detail: { review_reason: 'failure_set_repeated' },
      created_at: new Date(BASE_MS - 60_000),
    };
    const state = { failedWrites: 0, collects: 0, dispatches: 0 };
    const pool = {
      async query(sql) {
        const normalized = String(sql);
        if (/UPDATE initiative_runs/i.test(normalized) && /failure_reason/i.test(normalized)) {
          state.failedWrites += 1;
          return { rows: [], rowCount: 1 };
        }
        if (/orchestrator_decision_log/i.test(normalized)) {
          return {
            rows: [{
              ...reviewRequest,
              review_request_hop: reviewRequest.hop,
              review_head_sha: headSha,
            }],
            rowCount: 1,
          };
        }
        if (/initiative_runs/i.test(normalized)) {
          return { rows: [{ deadline_at: expired }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const result = await runLoop({
      pool,
      collectGroundTruth: async () => {
        state.collects += 1;
        return {
          run: { phase: 'review', cost_usd: '0', deadline_at: expired },
          task: { status: 'in_progress', payload: {} },
          prdExists: true,
          contract: { approved: true, id: 'contract-1', row: {} },
          pr: {
            url: 'https://github.com/example/repo/pull/1',
            state: 'OPEN',
            merged: false,
            ci: 'pass',
            head_sha: headSha,
          },
          inflight: { containers: [], host_pids: [] },
          lastAgentExit: { code: null, auth_failed: false },
          proposeBranchRn: 0,
          ganLatestRoundVerdict: null,
          generatorSpawned: true,
          evaluateVerdict: { verdict: 'PASS', pr_head_sha: headSha },
          evaluateResult: null,
          judgeVerdict: { verdict: 'PASS', pr_head_sha: headSha },
          reviewRequired: false,
          reviewApproved: false,
          decisionLog: [
            reviewRequest,
            {
              hop: 10,
              action: 'verdict:human_review',
              detail: {
                approved: true,
                pr_head_sha: headSha,
                review_request_hop: 9,
              },
            },
          ],
          authCircuit: [],
          callbackResult: null,
        };
      },
      nextHop: async () => 11,
      appendHop: async () => {},
      dispatch: async () => {
        state.dispatches += 1;
        throw new Error('stale-review-dispatched');
      },
      finalizeRun: async (_pool, input) => {
        state.failedWrites += 1;
        expect(input).toMatchObject({
          runId: RUN_ID,
          expectedTaskId: TASK_ID,
          outcome: 'failed',
          reason: 'automation_deadline_exceeded',
        });
      },
      now: () => new Date(BASE_MS),
      log: () => {},
    }, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('automation_deadline_exceeded');
    expect(state.collects).toBe(1);
    expect(state.dispatches).toBe(0);
    expect(state.failedWrites).toBe(1);
  });

  test('an unrelated decision-log row cannot masquerade as an open human review', async () => {
    const expired = new Date(BASE_MS - 1000);
    const state = { failedWrites: 0, collects: 0 };
    const pool = {
      async query(sql) {
        const normalized = String(sql);
        if (/UPDATE initiative_runs/i.test(normalized) && /failure_reason/i.test(normalized)) {
          state.failedWrites += 1;
          return { rows: [], rowCount: 1 };
        }
        if (/orchestrator_decision_log/i.test(normalized)) {
          return {
            rows: [{
              hop: 88,
              action: 'wait:poll_ci',
              observed: { pr: { head_sha: 'a'.repeat(40) } },
            }],
            rowCount: 1,
          };
        }
        if (/SELECT\s+deadline_at/i.test(normalized)) {
          return { rows: [{ deadline_at: expired }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const result = await runLoop({
      pool,
      collectGroundTruth: async () => {
        state.collects += 1;
        throw new Error('expired run must not collect');
      },
      finalizeRun: async (_pool, input) => {
        state.failedWrites += 1;
        expect(input).toMatchObject({
          runId: RUN_ID,
          expectedTaskId: TASK_ID,
          outcome: 'failed',
          reason: 'automation_deadline_exceeded',
        });
      },
      now: () => new Date(BASE_MS),
      log: () => {},
    }, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('automation_deadline_exceeded');
    expect(state.collects).toBe(0);
    expect(state.failedWrites).toBe(1);
  });

  test.each([
    ['done', 'already-complete'],
    ['failed', 'original-failure'],
  ])('deadline failure write cannot overwrite terminal phase=%s', async (phase, failureReason) => {
    const state = { phase, failureReason };
    const expired = new Date(BASE_MS - 1000);
    const pool = {
      async query(sql, params = []) {
        const normalized = String(sql);
        if (/SELECT\s+deadline_at/i.test(normalized)) {
          return { rows: [{ deadline_at: expired }], rowCount: 1 };
        }
        if (/UPDATE initiative_runs/i.test(normalized) && /failure_reason/i.test(normalized)) {
          const guarded = /phase\s+NOT\s+IN\s*\(\s*'done'\s*,\s*'failed'\s*\)/i.test(normalized);
          if (!guarded || !['done', 'failed'].includes(state.phase)) {
            state.phase = 'failed';
            state.failureReason = params[1];
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const result = await runLoop({
      pool,
      collectGroundTruth: async () => {
        throw new Error('expired terminal run must stop before collect');
      },
      finalizeRun: async (_pool, input) => {
        expect(input).toMatchObject({
          runId: RUN_ID,
          expectedTaskId: TASK_ID,
          outcome: 'failed',
          reason: 'automation_deadline_exceeded',
        });
        // 旧回归场景只验证终态不可覆盖；真实冲突语义由
        // kernel-run-store 的 unit + PostgreSQL integration 覆盖。
      },
      now: () => new Date(BASE_MS),
      log: () => {},
    }, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('automation_deadline_exceeded');
    expect(state).toEqual({ phase, failureReason });
  });
});
