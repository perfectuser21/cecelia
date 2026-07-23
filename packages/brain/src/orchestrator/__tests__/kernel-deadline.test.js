/**
 * kernel-deadline.test.js
 *
 * [BEHAVIOR] B-03：120min 硬上限三道 deadline fence 全接线
 *
 * 先红后绿：当前代码
 * 1. harness-skill-relay.js 写 deadline_at = NOW()+8h（应改为 120min）
 * 2. loop.js 无 deadline fence（runLoop 无任何 deadline 检查）
 * 3. constants.js MAX_FIX_ROUNDS=20, MAX_HOPS=200（应改为 3 和 60）
 *
 * Sprint: 07231527-relay-50170af2
 * TASK_ID: 50170af2-fefa-41a7-b0b4-dcf1a5d7b077
 */

import { runLoop } from '../loop.js';
import { MAX_FIX_ROUNDS, MAX_HOPS } from '../constants.js';
import { deriveReviewRequired } from '../../harness-skill-relay.js';

// ---- T-05/T-06：deadline fence ----

describe('[BEHAVIOR] B-03 deadline 120min 三道 fence', () => {
  // 共用 mock pool builder
  function makeMockPool({ deadlineAt, decisionLog = [], phase = 'generate' } = {}) {
    const now = new Date();
    const deadline = deadlineAt ?? new Date(now.getTime() + 120 * 60 * 1000); // default 120min
    return {
      query: async (sql, params) => {
        if (sql.includes('initiative_runs') && sql.includes('WHERE id')) {
          return {
            rows: [{
              id: params[0] ?? 'run-1',
              phase,
              deadline_at: deadline,
              cost_usd: '0',
              pr_url: null,
              contract_id: null,
              initiative_id: 'init-1',
              orchestrator_version: 'v2',
            }],
          };
        }
        if (sql.includes('tasks') && sql.includes('WHERE id')) {
          return {
            rows: [{
              id: 'task-1',
              status: 'in_progress',
              payload: JSON.stringify({ review_required: false }),
              title: 'test task',
              ability_id: null,
            }],
          };
        }
        if (sql.includes('orchestrator_decision_log')) {
          if (sql.includes('SELECT hop')) {
            return { rows: decisionLog };
          }
          // nextHop SELECT MAX(hop) or INSERT
          if (sql.includes('MAX(hop)') || sql.includes('INSERT INTO orchestrator_decision_log')) {
            return { rows: [{ hop: decisionLog.length }] };
          }
          return { rows: decisionLog };
        }
        if (sql.includes('initiative_contracts')) return { rows: [] };
        if (sql.includes('harness_attempts')) return { rows: [] };
        if (sql.includes('account_usage_cache')) return { rows: [] };
        if (sql.includes('UPDATE initiative_runs')) return { rows: [] };
        return { rows: [] };
      },
      connect: async () => ({
        query: async () => ({ rows: [] }),
        release: () => {},
      }),
    };
  }

  /**
   * T-05：119:59 时（deadline 还差 1 秒）不触发 terminal。
   * 验证 fence 仅在真正超过 deadline 时触发。
   */
  test('T-05: deadline 前（119:59）不触发 terminal', async () => {
    const futureDeadline = new Date(Date.now() + 1000); // 1 秒后 = 还未过期
    const pool = makeMockPool({ deadlineAt: futureDeadline, phase: 'planning' });
    let loopResult = null;
    let loopCallCount = 0;

    // 仅跑一跳就返回（避免无限循环）
    const deps = {
      pool,
      collectGroundTruth: async () => ({
        run: { phase: 'planning', cost_usd: '0', deadline_at: futureDeadline },
        task: { status: 'in_progress', payload: {} },
        prdExists: false, // 触发 spawn:planner
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
        decisionLog: [],
        authCircuit: [],
        callbackResult: null,
      }),
      appendHop: async () => { loopCallCount++; },
      nextHop: async () => 1,
      writeHeartbeat: async () => {},
      dispatch: async () => {
        // 终止循环
        throw new Error('test_stop');
      },
      sleep: async () => {},
      now: () => new Date(),
      log: () => {},
    };

    try {
      await runLoop(deps, { taskId: 'task-1', runId: 'run-1' });
    } catch (e) {
      if (e.message !== 'test_stop') throw e;
    }

    // deadline 未过期时应该正常到 dispatch（不 terminal）
    expect(loopCallCount).toBeGreaterThanOrEqual(1);
  });

  /**
   * T-06：deadline 已过（NOW() > deadline_at）→ fence 1 触发 terminal。
   * 当前代码无 deadline fence，不会 terminal，测试将 FAIL（先红）。
   */
  test('T-06: deadline 过期 → fence-1 terminal(automation_deadline_exceeded)', async () => {
    const pastDeadline = new Date(Date.now() - 1000); // 1 秒前 = 已过期
    const pool = makeMockPool({ deadlineAt: pastDeadline, phase: 'generate' });
    let updateCalled = false;
    let updateReason = null;

    const deps = {
      pool: {
        ...pool,
        query: async (sql, params) => {
          if (sql.includes('UPDATE initiative_runs') && sql.includes('failure_reason')) {
            updateCalled = true;
            updateReason = params?.[1];
            return { rows: [] };
          }
          return pool.query(sql, params);
        },
      },
      collectGroundTruth: async () => ({
        run: { phase: 'generate', cost_usd: '0', deadline_at: pastDeadline },
        task: { status: 'in_progress', payload: {} },
        prdExists: true,
        contract: { approved: true, id: 'c1', row: {} },
        pr: { url: 'https://github.com/test/repo/pull/1', state: 'OPEN', merged: false, ci: 'pending', head_sha: 'sha-1' },
        inflight: { containers: [], host_pids: [] },
        lastAgentExit: { code: null, auth_failed: false },
        proposeBranchRn: 0,
        ganLatestRoundVerdict: null,
        generatorSpawned: true,
        evaluateVerdict: null,
        evaluateResult: null,
        judgeVerdict: null,
        reviewRequired: false,
        reviewApproved: false,
        decisionLog: [],
        authCircuit: [],
        callbackResult: null,
      }),
      appendHop: async () => {},
      nextHop: async () => 1,
      writeHeartbeat: async () => {},
      dispatch: async () => ({ status: 'DONE' }),
      sleep: async () => {},
      now: () => new Date(),
      log: () => {},
    };

    const result = await runLoop(deps, { taskId: 'task-1', runId: 'run-1' });

    // 实现后期望：terminal 触发
    // 当前（先红）：无 fence，runLoop 不会 terminal，可能进入 wait:poll_ci 轮询
    expect(result.exitReason).toBe('automation_deadline_exceeded');
    expect(updateCalled).toBe(true);
    expect(updateReason).toBe('automation_deadline_exceeded');
  });

  /**
   * T-07：dispatch 前 fence-2，即使 collect 时未过期，但 derive 后已过 deadline。
   * 不创建新 attempt。
   */
  test('T-07: dispatch 前 fence-2 阻止新 attempt 创建', async () => {
    let fenceHit = false;
    const nowRef = { value: Date.now() };
    // collect 时 deadline 还差 100ms，dispatch 前已过
    const deadline = new Date(nowRef.value + 100);

    const deps = {
      pool: makeMockPool({ deadlineAt: deadline, phase: 'generate' }),
      collectGroundTruth: async () => {
        // 模拟 collect 期间时间流逝，现在 deadline 已过
        nowRef.value += 200;
        return {
          run: { phase: 'generate', cost_usd: '0', deadline_at: deadline },
          task: { status: 'in_progress', payload: {} },
          prdExists: true,
          contract: { approved: true, id: 'c1', row: {} },
          pr: { url: 'https://github.com/test/repo/pull/1', state: 'OPEN', merged: false, ci: 'pass', head_sha: 'sha-1' },
          inflight: { containers: [], host_pids: [] },
          lastAgentExit: { code: null, auth_failed: false },
          proposeBranchRn: 0,
          ganLatestRoundVerdict: null,
          generatorSpawned: true,
          evaluateVerdict: null,
          evaluateResult: null,
          judgeVerdict: null,
          reviewRequired: false,
          reviewApproved: false,
          decisionLog: [],
          authCircuit: [],
          callbackResult: null,
        };
      },
      appendHop: async () => {},
      nextHop: async () => 1,
      writeHeartbeat: async () => {},
      dispatch: async (action) => {
        // dispatch 不应被调用
        fenceHit = false;
        throw new Error(`unexpected_dispatch:${action}`);
      },
      sleep: async () => {},
      now: () => new Date(nowRef.value), // 时间已经流过 deadline
      log: () => {},
    };

    let result;
    try {
      result = await runLoop(deps, { taskId: 'task-1', runId: 'run-1' });
    } catch (e) {
      if (e.message.startsWith('unexpected_dispatch')) {
        // fence-2 未实现，dispatch 被调用了 → 先红期望失败
        result = { exitReason: 'test_dispatch_called' };
      } else throw e;
    }

    expect(result.exitReason).toBe('automation_deadline_exceeded');
  });
});

// ---- T：constants 值断言 ----

describe('[BEHAVIOR] B-07 MAX_FIX_ROUNDS=3, MAX_HOPS=60', () => {
  /**
   * 当前代码 MAX_FIX_ROUNDS=20, MAX_HOPS=200，测试会 FAIL（先红）。
   * 实现后改为 3 和 60。
   */
  test('MAX_FIX_ROUNDS 应为 3', () => {
    expect(MAX_FIX_ROUNDS).toBe(3);
  });

  test('MAX_HOPS 应为 60', () => {
    expect(MAX_HOPS).toBe(60);
  });
});

// ---- harness-skill-relay deadline 断言 ----

describe('[BEHAVIOR] B-03 harness-skill-relay deadline_at = 120min', () => {
  /**
   * 验证 _spawnKernelRuntime 的 deadline_at SQL 是 NOW()+120min 而非 NOW()+8h。
   * 当前代码写的是 INTERVAL '8 hours'（先红）。
   */
  test('harness-skill-relay.js 的 deadline SQL 应含 120 minutes 而非 8 hours', async () => {
    // 读取源文件，验证 SQL 字符串
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      new URL('../../harness-skill-relay.js', import.meta.url).pathname,
      'utf8',
    );

    // 实现后期望：含 '120 minutes'
    // 当前（先红）：含 '8 hours' 或 '480 minutes'
    expect(src).toMatch(/120\s*minutes/i);
    expect(src).not.toMatch(/8\s*hours/i);
  });
});
