import { describe, expect, test } from 'vitest';
import { runLoop } from '../../../packages/brain/src/orchestrator/loop.js';

const TASK_ID = '30000000-0000-4000-8000-000000000003';
const RUN_ID = '40000000-0000-4000-8000-000000000004';

function groundTruth(decisionLog) {
  return {
    run: {
      phase: 'planning',
      cost_usd: '0',
      deadline_at: new Date(Date.now() + 120 * 60 * 1000),
    },
    task: { id: TASK_ID, status: 'in_progress', payload: {} },
    prdExists: false,
    contract: { approved: false, id: null, row: null },
    pr: null,
    inflight: { containers: [], host_pids: [] },
    lastAgentExit: { code: null, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: false,
    evaluateVerdict: null,
    evaluateResult: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: decisionLog.map((row) => structuredClone(row)),
    authCircuit: [],
    callbackResult: null,
  };
}

function sharedHarness(rows) {
  const state = { failureReason: null };
  const pool = {
    async query(sql, params) {
      if (sql.includes('SELECT deadline_at')) {
        return { rows: [{ deadline_at: new Date(Date.now() + 120 * 60 * 1000) }] };
      }
      if (sql.includes('UPDATE initiative_runs') && sql.includes('failure_reason')) {
        state.failureReason = params[1];
      }
      return { rows: [] };
    },
  };
  return {
    state,
    baseDeps: {
      pool,
      nextHop: async () => rows.reduce((max, row) => Math.max(max, row.hop), 0) + 1,
      appendHop: async (row) => {
        rows.push({
          hop: row.hop,
          action: row.action,
          observed: structuredClone(row.observed),
          gate_verdict: row.gateVerdict,
          detail: structuredClone(row.detail),
        });
      },
      writeHeartbeat: async () => {},
      sleep: async () => {},
      now: () => new Date(),
      log: () => {},
    },
  };
}

describe('kernel wiring: blocked streak survives a loop restart', () => {
  test('BLOCKED result is authoritative in decision log for the next loop instance', async () => {
    const rows = [];
    const harness = sharedHarness(rows);
    let firstCollections = 0;
    const firstDeps = {
      ...harness.baseDeps,
      collectGroundTruth: async () => {
        firstCollections += 1;
        if (firstCollections > 1) throw new Error('simulated_restart');
        return groundTruth(rows);
      },
      dispatch: async () => ({ status: 'BLOCKED', detail: 'missing durable input' }),
    };

    await expect(runLoop(firstDeps, { taskId: TASK_ID, runId: RUN_ID }))
      .rejects.toThrow('simulated_restart');

    let secondCollections = 0;
    const secondDeps = {
      ...harness.baseDeps,
      collectGroundTruth: async () => {
        secondCollections += 1;
        if (secondCollections > 1) throw new Error('blocked_streak_was_reset');
        return groundTruth(rows);
      },
      dispatch: async () => ({ status: 'BLOCKED', detail: 'missing durable input' }),
    };

    let result;
    try {
      result = await runLoop(secondDeps, { taskId: TASK_ID, runId: RUN_ID });
    } catch (error) {
      result = { exitReason: error.message };
    }

    expect(result.exitReason).toBe('blocked_same_state');
    expect(harness.state.failureReason).toBe('blocked_same_state:BLOCKED');
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'spawn:planner', gate_verdict: 'allow' }),
      expect.objectContaining({ action: 'result:dispatch', gate_verdict: 'deny:BLOCKED' }),
    ]));
  });
});
