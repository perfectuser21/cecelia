/**
 * loop.test.js —— runLoop 轻集成（fake ground-truth 序列 + fake dispatcher），spec §测试策略 §4 全场景：
 * - fake 全链 planning→done（逐跳喂 observed 序列）
 * - 崩溃在 log 与 dispatch 之间（intent 有记录、无容器无产物 → 重派新 hop）
 * - BLOCKED×2 → failed；每跳恰一条日志一次心跳；singleton 冲突退出；dry-run 不派发；wait 不 append
 */
import { describe, it, expect, vi } from 'vitest';
import { activateContextResume, runLoop } from '../loop.js';
import { SingletonConflictError } from '../decision-log.js';
import { POLL_INTERVAL_MS } from '../constants.js';

const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TASK_ID = '11111111-2222-3333-4444-555555555555';
const CONTRACT_ID = '99999999-8888-7777-6666-555555555555';
const HYBRID_TASK = Object.freeze({
  status: 'in_progress',
  payload: {
    commander: {
      primary: {
        provider: 'codex',
        account: 'team4',
        machine: 'us-mac-m4',
      },
      fallbacks: [],
    },
    routing: {
      preferred_machine: 'us-mac-m4',
      fallback_machines: [],
      strict_affinity: true,
    },
  },
});

/** 造一份完整 observed（derive 契约字段全齐），供逐跳喂给 fake collectGroundTruth */
function obs(overrides = {}) {
  return {
    run: { id: RUN_ID, phase: 'generate', cost_usd: 0 },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true, id: CONTRACT_ID },
    pr: null,
    inflight: { containers: [], host_pids: [] },
    lastAgentExit: { code: null, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: false,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: [],
    authCircuit: [],
    callbackResult: null,
    ...overrides,
  };
}

/** fake 全套 deps：observed 队列 + 可编程 dispatch，记录 append/heartbeat/sql/sleep */
function makeEnv({ observedSeq, dispatch, finalizeRun } = {}) {
  let i = 0;
  let hopCounter = 0;
  const appended = [];
  const persistedRows = [];
  const heartbeats = [];
  const sqls = [];
  const sleeps = [];
  const deps = {
    pool: {
      query: vi.fn(async (sql, params) => {
        sqls.push([sql, params]);
        if (sql.includes('INSERT INTO initiative_contracts')) {
          return {
            rows: [{ id: CONTRACT_ID, version: params[1], status: 'approved', branch: params[2] }],
          };
        }
        return { rows: [] };
      }),
    },
    collectGroundTruth: vi.fn(async () => {
      const o = observedSeq[Math.min(i, observedSeq.length - 1)];
      i++;
      const value = typeof o === 'function' ? o() : o;
      return {
        ...value,
        decisionLog: [...(value.decisionLog ?? []), ...persistedRows],
      };
    }),
    nextHop: vi.fn(async () => {
      hopCounter++;
      return hopCounter;
    }),
    appendHop: vi.fn(async (entry) => {
      appended.push(entry);
      persistedRows.push({
        hop: entry.hop,
        action: entry.action,
        observed: entry.observed,
        gate_verdict: entry.gateVerdict,
        detail: entry.detail,
      });
    }),
    writeHeartbeat: vi.fn(async (pool, entry) => {
      heartbeats.push(entry);
    }),
    dispatch: vi.fn(dispatch ?? (async () => ({ status: 'DONE', detail: 'ok' }))),
    finalizeRun: vi.fn(finalizeRun ?? (async () => ({
      changed: true,
      outcome: 'failed',
      runId: RUN_ID,
      taskId: TASK_ID,
    }))),
    sleep: vi.fn(async (ms) => {
      sleeps.push(ms);
    }),
    now: () => new Date('2026-07-04T12:00:00Z'),
    host: 'test-host',
    pid: 4242,
    log: vi.fn(),
  };
  return { deps, appended, heartbeats, sqls, sleeps, setHopBase: (n) => { hopCounter = n; } };
}

describe('runLoop：全链 planning→done', () => {
  it('逐跳推进 planner→proposer→reviewer→persist→generator→poll→evaluator→judge→merge→report→exit', async () => {
    const prMeta = {
      url: 'u', state: 'OPEN', mergeStateStatus: 'CLEAN', merged: false, head_sha: 'sha-1',
    };
    const observedSeq = [
      // 1. 无 prd → spawn:planner
      obs({ prdExists: false, contract: { approved: false, id: CONTRACT_ID } }),
      // 2. GAN：无合同 → spawn:proposer
      obs({ contract: { approved: false, id: CONTRACT_ID } }),
      // 3. r1 合同已 push，无本轮 verdict → spawn:reviewer
      obs({ contract: { approved: false, id: CONTRACT_ID }, proposeBranchRn: 1 }),
      // 4. APPROVED 已出但未落库 → persist_contract_approval（控制 action，不派发）
      obs({ contract: { approved: false, id: CONTRACT_ID }, proposeBranchRn: 1, ganLatestRoundVerdict: 'APPROVED' }),
      // 5. contract approved，无 PR，generator 未派过 → spawn:generator
      obs({ generatorSpawned: false }),
      // 6. PR 出现，ci pending → wait:poll_ci（不派发不 append）
      obs({ generatorSpawned: true, pr: { ...prMeta, ci: 'pending' } }),
      // 7. ci pass，无 evaluate verdict → spawn:evaluator
      obs({ generatorSpawned: true, pr: { ...prMeta, ci: 'pass' } }),
      // 8. evaluate PASS → spawn:judge
      obs({
        generatorSpawned: true,
        pr: { ...prMeta, ci: 'pass' },
        evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-1' },
      }),
      // 9. 双 PASS → merge_pr
      obs({
        generatorSpawned: true,
        pr: { ...prMeta, ci: 'pass' },
        evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-1' },
        judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-1' },
      }),
      // 10. merged → report
      obs({ generatorSpawned: true, pr: { ...prMeta, ci: 'pass', merged: true } }),
      // 11. run.phase=done → exit
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended, heartbeats, sqls, sleeps } = makeEnv({ observedSeq });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(deps.dispatch.mock.calls.map(([action]) => action)).toEqual([
      'spawn:planner',
      'spawn:proposer',
      'spawn:reviewer',
      'spawn:generator',
      'spawn:evaluator',
      'spawn:judge',
      'merge_pr',
      'report',
    ]);
    // 每个派发跳恰一条 intent；poll 另有一条持久计数日志。
    expect(appended).toHaveLength(9);
    expect(result.hops).toBe(9);
    // persist 控制跳 + wait 跳也要心跳：8 派发 + 1 persist + 1 wait = 10
    expect(heartbeats).toHaveLength(10);
    // persist_contract_approval 落库 initiative_contracts
    const persistSql = sqls.find(([sql]) => sql.includes('initiative_contracts'));
    expect(persistSql[0]).toMatch(/status\s*=\s*'approved'/);
    expect(persistSql[1]).toContain(CONTRACT_ID);
    // wait:poll_ci 只睡一次，不 append 不 dispatch
    expect(sleeps).toHaveLength(1);
    // merge_pr 跳带 gateVerdict=allow
    const mergeEntry = appended.find((e) => e.action === 'merge_pr');
    expect(mergeEntry.gateVerdict).toBe('allow');
    expect(mergeEntry.observed.pr.mergeStateStatus).toBe('CLEAN');
  });

  it('每个派发 hop：先 appendHop 再 dispatch（intent-before-dispatch 顺序）', async () => {
    const order = [];
    const observedSeq = [
      obs({ prdExists: false, contract: { approved: false, id: CONTRACT_ID } }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps } = makeEnv({ observedSeq });
    deps.appendHop = vi.fn(async () => order.push('append'));
    deps.dispatch = vi.fn(async () => {
      order.push('dispatch');
      return { status: 'DONE', detail: null };
    });

    await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(order).toEqual(['append', 'dispatch']);
  });

  it('把服务端 PRD evidence 写入 append-only snapshot 供重启后安全回放', async () => {
    const prdEvidence = {
      source: 'brain_file_observation',
      path: '/workspace/sprint-prd.md',
    };
    const observedSeq = [
      obs({
        prdEvidence,
        contract: { approved: false, id: CONTRACT_ID },
      }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended } = makeEnv({ observedSeq });

    await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(appended[0]).toMatchObject({
      action: 'spawn:proposer',
      observed: {
        prdExists: true,
        prdEvidence,
      },
    });
  });
});

describe('runLoop：hybrid Commander boundary', () => {
  it('inserts one Commander Attempt before the existing default dispatch', async () => {
    const current = obs({
      run: {
        id: RUN_ID,
        phase: 'planning',
        cost_usd: 0,
        commander_mode: 'hybrid',
      },
      task: HYBRID_TASK,
      prdExists: false,
      contract: { approved: false, id: CONTRACT_ID },
    });
    const { deps } = makeEnv({
      observedSeq: [
        current,
        current,
        obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
      ],
    });
    deps.commanderCoordinator = {
      reconcile: vi.fn()
        .mockResolvedValueOnce({
          kind: 'dispatch',
          action: 'spawn:commander',
          context: {
            target: {
              role: 'commander',
              provider: 'codex',
              account: 'team4',
              machine: 'us-mac-m4',
            },
            bundle: { commander_attempt_id: 'commander-attempt' },
          },
        })
        .mockResolvedValueOnce({ kind: 'continue', decision: {
          phase: 'planning',
          action: 'spawn:planner',
          reason: 'no_prd',
        } })
        .mockResolvedValue({ kind: 'bypass' }),
    };

    await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(deps.dispatch.mock.calls.map(([action]) => action)).toEqual([
      'spawn:commander',
      'spawn:planner',
    ]);
    expect(deps.dispatch.mock.calls[0][1]).toMatchObject({
      commander: {
        target: expect.objectContaining({ role: 'commander' }),
        bundle: { commander_attempt_id: 'commander-attempt' },
      },
    });
  });

  it('wakes Commander before merge and does not execute merge in the same pass', async () => {
    const pr = {
      url: 'u',
      state: 'OPEN',
      mergeStateStatus: 'CLEAN',
      ci: 'pass',
      merged: false,
      head_sha: 'sha-1',
    };
    const mergeReady = obs({
      run: {
        id: RUN_ID,
        phase: 'evaluate',
        cost_usd: 0,
        commander_mode: 'hybrid',
      },
      task: HYBRID_TASK,
      generatorSpawned: true,
      pr,
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-1' },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-1' },
    });
    const { deps } = makeEnv({
      observedSeq: [
        mergeReady,
        mergeReady,
        obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
      ],
    });
    deps.commanderCoordinator = {
      reconcile: vi.fn()
        .mockResolvedValueOnce({
          kind: 'dispatch',
          action: 'spawn:commander',
          context: {
            target: {
              role: 'commander',
              provider: 'codex',
              account: 'team4',
              machine: 'us-mac-m4',
            },
            bundle: { commander_attempt_id: 'commander-attempt' },
          },
        })
        .mockResolvedValueOnce({ kind: 'continue', decision: {
          phase: 'merge',
          action: 'merge_pr',
          reason: 'all_gates_passed',
        } })
        .mockResolvedValue({ kind: 'bypass' }),
    };

    await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(deps.dispatch.mock.calls.map(([action]) => action)).toEqual([
      'spawn:commander',
      'merge_pr',
    ]);
  });

  it('records a rejected Directive and reuses current Kernel truth', async () => {
    const current = obs({
      run: {
        id: RUN_ID,
        phase: 'planning',
        cost_usd: 0,
        commander_mode: 'hybrid',
      },
      task: HYBRID_TASK,
      prdExists: false,
      contract: { approved: false, id: CONTRACT_ID },
    });
    const { deps, appended, sleeps } = makeEnv({
      observedSeq: [
        current,
        obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
      ],
    });
    const rawDirective = {
      schema: 'commander-directive/v1',
      run_id: RUN_ID,
      event_cursor: 9,
      action: 'switch_machine',
      reason: 'Move the role.',
      route: { machine: 'xian-mac-m4' },
      evidence_refs: ['event:9'],
    };
    deps.commanderCoordinator = {
      reconcile: vi.fn()
        .mockResolvedValueOnce({ kind: 'control', decision: rawDirective })
        .mockResolvedValue({ kind: 'bypass' }),
    };
    deps.commanderDirectiveExecutor = {
      execute: vi.fn().mockResolvedValue({
        accepted: false,
        reason_code: 'phase2_route_mutation_deferred',
        decision: null,
      }),
    };

    await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(appended).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'commander.directive_rejected',
        gateVerdict: 'deny:phase2_route_mutation_deferred',
      }),
      expect.objectContaining({ action: 'spawn:planner' }),
    ]));
    expect(deps.dispatch).toHaveBeenCalledWith('spawn:planner', expect.any(Object));
    expect(deps.commanderDirectiveExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        validation: expect.objectContaining({
          strictMachine: 'us-mac-m4',
        }),
      }),
    );
  });

  it('loud-fails hybrid mode without an explicit Commander primary', async () => {
    const { deps } = makeEnv({
      observedSeq: [
        obs({
          run: {
            id: RUN_ID,
            phase: 'planning',
            cost_usd: 0,
            commander_mode: 'hybrid',
          },
          prdExists: false,
          contract: { approved: false, id: CONTRACT_ID },
        }),
      ],
    });
    deps.commanderCoordinator = {
      reconcile: vi.fn().mockResolvedValue({ kind: 'bypass' }),
    };

    await expect(
      runLoop(deps, { taskId: TASK_ID, runId: RUN_ID }),
    ).rejects.toThrow();
    expect(deps.commanderCoordinator.reconcile).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('keeps non-hybrid dispatch behavior byte-for-byte when coordinator bypasses', async () => {
    const { deps } = makeEnv({
      observedSeq: [
        obs({ prdExists: false, contract: { approved: false, id: CONTRACT_ID } }),
        obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
      ],
    });
    deps.commanderCoordinator = {
      reconcile: vi.fn().mockResolvedValue({ kind: 'bypass' }),
    };

    await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(deps.dispatch.mock.calls.map(([action]) => action)).toEqual(['spawn:planner']);
  });
});

describe('runLoop：崩溃在 log 与 dispatch 之间（hop 协议）', () => {
  it('intent 有记录、无容器无产物 → 视为未遂，重派为新 hop（nextHop = MAX+1）', async () => {
    // 上一进程在 hop=4 记了 spawn:generator intent 后崩溃：无 inflight、无 PR
    const staleLog = [
      { hop: 4, action: 'spawn:generator', observed: {}, detail: null },
    ];
    const observedSeq = [
      obs({ generatorSpawned: true, decisionLog: staleLog }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended, setHopBase } = makeEnv({ observedSeq });
    setHopBase(4); // DB MAX(hop)=4 → nextHop 给 5

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    // 重派为新 hop=5（不复用 hop=4），action 走 generator-fix（intent 已计入，≤1 过计偏安全方向）
    expect(appended).toHaveLength(1);
    expect(appended[0].hop).toBe(5);
    expect(appended[0].action).toBe('spawn:generator-fix');
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
  });

  it('callback 在慢观测窗口追加 verdict → 丢弃旧快照，不重复派 evaluator', async () => {
    const pr = {
      url: 'u', state: 'OPEN', mergeStateStatus: 'CLEAN', ci: 'pass', merged: false, head_sha: 'sha-1',
    };
    const evaluatorIntent = {
      hop: 44, action: 'spawn:evaluator', observed: {}, detail: null,
    };
    const evaluatePass = {
      hop: 45,
      action: 'verdict:evaluate',
      observed: {},
      detail: { verdict: 'PASS', pr_head_sha: 'sha-1' },
    };
    const observedSeq = [
      // collect 先读到 hop 44；慢速 gh/git/docker 期间 callback 追加 hop 45。
      obs({ generatorSpawned: true, pr, decisionLog: [evaluatorIntent] }),
      // 重新观测后才能看见 PASS，并正确进入 judge。
      obs({
        generatorSpawned: true,
        pr,
        decisionLog: [evaluatorIntent, evaluatePass],
        evaluateVerdict: evaluatePass.detail,
      }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended } = makeEnv({ observedSeq });
    // 第一次 next 已看见 callback 的 hop 45，所以返回 46；第二次仍返回 46。
    deps.nextHop = vi.fn().mockResolvedValueOnce(46).mockResolvedValueOnce(46);

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(deps.dispatch.mock.calls.map(([action]) => action)).toEqual(['spawn:judge']);
    expect(appended.map((entry) => entry.action)).toEqual(['spawn:judge']);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('stale observation'));
  });
});

describe('runLoop：四态返回控制流', () => {
  it('BLOCKED×2（连续同态）→ run 置 failed + exitReason=blocked_same_state', async () => {
    const observedSeq = [obs({ generatorSpawned: false })];
    const { deps } = makeEnv({
      observedSeq,
      dispatch: async () => ({ status: 'BLOCKED', detail: 'cannot proceed' }),
    });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('blocked_same_state');
    expect(deps.dispatch).toHaveBeenCalledTimes(2);
    expect(deps.finalizeRun).toHaveBeenCalledWith(deps.pool, {
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      outcome: 'failed',
      reason: 'blocked_same_state:BLOCKED',
    });
  });

  it('capability BLOCKED persists structured evidence before infrastructure retry backoff', async () => {
    const evidence = {
      capability_snapshot_id: 'snapshot-blocked',
      from_target: { provider: 'codex', account: 'team4', machine: 'us-mac-m4' },
      to_target: null,
      fallback_reason: 'postgres_unreachable',
      failure_class: 'infrastructure_blocked',
    };
    const observedSeq = [
      obs({ generatorSpawned: false }),
      obs({ generatorSpawned: false }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended } = makeEnv({
      observedSeq,
      dispatch: async () => ({
        status: 'DONE_WITH_CONCERNS',
        control_status: 'BLOCKED',
        detail: 'dispatch preflight blocked: postgres_unreachable',
        action: 'wait:human_review',
        failure_class: 'infrastructure_blocked',
        fallback_reason: 'postgres_unreachable',
        should_create_attempt: false,
        should_enter_generator_fix: false,
        evidence,
      }),
    });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    const dispatchResults = appended.filter((entry) => entry.action === 'result:dispatch');
    expect(dispatchResults).toHaveLength(2);
    for (const row of dispatchResults) {
      expect(row.detail).toMatchObject({
        dispatch_action: 'spawn:generator',
        status: 'BLOCKED',
        transport_status: 'DONE_WITH_CONCERNS',
        redirect_action: 'wait:human_review',
        failure_class: 'infrastructure_blocked',
        fallback_reason: 'postgres_unreachable',
        should_create_attempt: false,
        should_enter_generator_fix: false,
        evidence,
      });
    }
  });

  it('transient infrastructure BLOCKED backs off and re-probes instead of terminalizing the run', async () => {
    const observedSeq = [
      obs({ generatorSpawned: false }),
      obs({ generatorSpawned: false }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended, sleeps } = makeEnv({
      observedSeq,
      dispatch: async () => ({
        status: 'DONE_WITH_CONCERNS',
        control_status: 'BLOCKED',
        detail: 'dispatch preflight blocked: node_not_base_admitted',
        action: 'wait:human_review',
        failure_class: 'infrastructure_blocked',
        fallback_reason: 'node_not_base_admitted',
        should_create_attempt: false,
        should_enter_generator_fix: false,
      }),
    });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(deps.dispatch).toHaveBeenCalledTimes(2);
    expect(deps.finalizeRun).not.toHaveBeenCalled();
    expect(sleeps).toEqual([POLL_INTERVAL_MS, POLL_INTERVAL_MS]);
    expect(appended.filter((entry) => entry.action === 'result:dispatch')).toHaveLength(2);
  });

  it('an infrastructure BLOCKED streak does not consume the semantic BLOCKED fence', async () => {
    const responses = [
      {
        status: 'DONE_WITH_CONCERNS',
        control_status: 'BLOCKED',
        detail: 'dispatch preflight blocked: node_not_base_admitted',
        failure_class: 'infrastructure_blocked',
        fallback_reason: 'node_not_base_admitted',
      },
      { status: 'BLOCKED', detail: 'semantic refusal' },
      { status: 'BLOCKED', detail: 'semantic refusal' },
    ];
    let index = 0;
    const { deps } = makeEnv({
      observedSeq: [obs({ generatorSpawned: false })],
      dispatch: async () => responses[index++],
    });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('blocked_same_state');
    expect(deps.dispatch).toHaveBeenCalledTimes(3);
    expect(deps.finalizeRun).toHaveBeenCalledWith(deps.pool, {
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      outcome: 'failed',
      reason: 'blocked_same_state:BLOCKED',
    });
  });

  it('NEEDS_CONTEXT 后 DONE → 同态 streak 清零，不 failed', async () => {
    const observedSeq = [
      obs({ generatorSpawned: false }),
      obs({ prdExists: true, generatorSpawned: false }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    let n = 0;
    const { deps } = makeEnv({
      observedSeq,
      dispatch: async () => {
        n++;
        return n === 1 ? { status: 'NEEDS_CONTEXT', detail: 'more ctx' } : { status: 'DONE', detail: 'ok' };
      },
    });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(result.exitReason).toBe('run_done');
    expect(deps.dispatch).toHaveBeenCalledTimes(2);
  });

  it('NEEDS_CONTEXT → BLOCKED（不同态交替）→ 不立即 failed，各自计数', async () => {
    const statuses = ['NEEDS_CONTEXT', 'BLOCKED', 'BLOCKED'];
    let n = 0;
    const observedSeq = [obs({ generatorSpawned: false })];
    const { deps } = makeEnv({
      observedSeq,
      dispatch: async () => ({ status: statuses[n++], detail: 'x' }),
    });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });
    // 第 2/3 次 BLOCKED 连续同态 → failed；共 3 次派发
    expect(result.exitReason).toBe('blocked_same_state');
    expect(deps.dispatch).toHaveBeenCalledTimes(3);
  });
});

describe('runLoop：控制 action 自消费', () => {
  it('mark_failed（宽 hop 兜底）→ 事务终结 run/task + 退出，不派发', async () => {
    const bigLog = Array.from({ length: 4096 }, (_, k) => ({
      hop: k + 1,
      action: 'wait_marker',
      observed: {},
      detail: null,
    }));
    const observedSeq = [obs({ decisionLog: bigLog })];
    const { deps } = makeEnv({ observedSeq });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('hop_cap');
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(deps.finalizeRun).toHaveBeenCalledWith(deps.pool, {
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      outcome: 'failed',
      reason: 'hop_cap',
    });
  });

  it('persist_contract_approval 在 contract 行缺失时从冻结分支物化并继续 generator', async () => {
    const approvedSha = 'a'.repeat(40);
    const observedSeq = [
      obs({
        run: { id: RUN_ID, initiative_id: TASK_ID, phase: 'gan', cost_usd: 0 },
        task: { status: 'in_progress', payload: { sprint_dir: 'sprints/kernel-contract' } },
        contract: { approved: false, id: null },
        proposeBranch: 'cp-harness-propose-r1-11111111-a3',
        proposeBranchSha: approvedSha,
        proposeBranchRn: 1,
        ganLatestRoundVerdict: 'APPROVED',
        ganLatestRoundContractSha: approvedSha,
      }),
      obs({ contract: { approved: true, id: CONTRACT_ID }, generatorSpawned: false }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, sqls, sleeps } = makeEnv({ observedSeq });
    const files = {
      'sprints/kernel-contract/sprint-prd.md': '# PRD',
      'sprints/kernel-contract/contract-draft.md': '# Contract',
      'sprints/kernel-contract/contract-dod.md': '# DoD',
    };
    deps.fileExists = vi.fn(() => false);
    deps.readGitFile = vi.fn((sha, filePath) => {
      expect(sha).toBe(approvedSha);
      if (!Object.hasOwn(files, filePath)) throw new Error(`missing ${filePath}`);
      return files[filePath];
    });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(deps.dispatch).toHaveBeenCalledWith('spawn:generator', expect.any(Object));
    expect(sleeps).toHaveLength(0);
    expect(deps.readGitFile.mock.calls).toEqual([
      [approvedSha, 'sprints/kernel-contract/sprint-prd.md', { repo: null }],
      [approvedSha, 'sprints/kernel-contract/contract-draft.md', { repo: null }],
      [approvedSha, 'sprints/kernel-contract/contract-dod.md', { repo: null }],
    ]);
    const materializeSql = sqls.find(([sql]) => sql.includes('INSERT INTO initiative_contracts'));
    expect(materializeSql).toBeTruthy();
    expect(materializeSql[1]).toEqual(expect.arrayContaining([
      RUN_ID,
      1,
      'cp-harness-propose-r1-11111111-a3',
      '# PRD',
    ]));
    expect(materializeSql[1].join('\n')).toContain('# Contract');
    expect(materializeSql[1].join('\n')).toContain('# DoD');
  });

  it('批准落库前把硬编码 GAN attempt/snapshot 改判 REVISION，不进入 Generator', async () => {
    const approvedSha = 'b'.repeat(40);
    const observedSeq = [
      obs({
        run: { id: RUN_ID, initiative_id: TASK_ID, phase: 'gan', cost_usd: 0 },
        task: { status: 'in_progress', payload: { sprint_dir: 'sprints/kernel-contract' } },
        contract: { approved: false, id: null },
        proposeBranch: 'cp-harness-propose-r1-11111111-a3',
        proposeBranchSha: approvedSha,
        proposeBranchRn: 1,
        ganLatestRoundVerdict: 'APPROVED',
        ganLatestRoundContractSha: approvedSha,
      }),
      obs({
        run: { id: RUN_ID, initiative_id: TASK_ID, phase: 'gan', cost_usd: 0 },
        contract: { approved: false, id: null },
        proposeBranch: 'cp-harness-propose-r1-11111111-a3',
        proposeBranchSha: approvedSha,
        proposeBranchRn: 1,
        ganLatestRoundVerdict: 'REVISION',
      }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended, sqls } = makeEnv({ observedSeq });
    deps.readGitFile = vi.fn((_sha, filePath) => ({
      'sprints/kernel-contract/sprint-prd.md': '# PRD',
      'sprints/kernel-contract/contract-draft.md': [
        '# Contract',
        'ATTEMPT_ID="1884647e-b67a-4bfd-a44c-3d2e84509526"',
      ].join('\n'),
      'sprints/kernel-contract/contract-dod.md': [
        '# DoD',
        'capability_snapshot_id=13eb5828-b09a-4e76-ba5e-14309f842263',
      ].join('\n'),
    })[filePath]);

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(appended[0]).toMatchObject({
      action: 'verdict:reviewer',
      gateVerdict: 'deny:premature_validation_identity_binding',
      detail: {
        rn: 1,
        contract_sha: approvedSha,
        verdict: 'REVISION',
      },
    });
    expect(deps.dispatch).toHaveBeenCalledWith('spawn:proposer', expect.any(Object));
    expect(deps.dispatch).not.toHaveBeenCalledWith('spawn:generator', expect.any(Object));
    expect(sqls.some(([sql]) => sql.includes('INSERT INTO initiative_contracts'))).toBe(false);
  });

  it('persist_contract_approval 按 payload.base_repo 从跨仓库权威仓库读取批准产物', async () => {
    // 生产实弹 run 4925488b：base_repo=zenithjoy-workspace，批准 SHA 只在该仓库存在
    const approvedSha = 'c'.repeat(40);
    const observedSeq = [
      obs({
        run: { id: RUN_ID, initiative_id: TASK_ID, phase: 'gan', cost_usd: 0 },
        task: {
          status: 'in_progress',
          payload: {
            sprint_dir: 'sprints/kernel-contract',
            base_repo: 'https://github.com/perfectuser21/zenithjoy-workspace.git',
          },
        },
        contract: { approved: false, id: null },
        proposeBranch: 'cp-harness-propose-r8-7194e308-a137',
        proposeBranchSha: approvedSha,
        proposeBranchRn: 8,
        ganLatestRoundVerdict: 'APPROVED',
        ganLatestRoundContractSha: approvedSha,
      }),
      obs({ contract: { approved: true, id: CONTRACT_ID }, generatorSpawned: false }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps } = makeEnv({ observedSeq });
    deps.fileExists = vi.fn(() => false);
    deps.readGitFile = vi.fn(() => '# frozen artifact');

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    for (const call of deps.readGitFile.mock.calls) {
      expect(call[2]).toEqual({ repo: 'perfectuser21/zenithjoy-workspace' });
    }
    expect(deps.readGitFile).toHaveBeenCalledTimes(3);
  });

  it('persist_contract_approval 显式 base_repo 无法解析时 fail closed，不回退本仓 origin', async () => {
    const approvedSha = 'd'.repeat(40);
    const observedSeq = [
      obs({
        run: { id: RUN_ID, initiative_id: TASK_ID, phase: 'gan', cost_usd: 0 },
        task: {
          status: 'in_progress',
          payload: {
            sprint_dir: 'sprints/kernel-contract',
            base_repo: 'not-an-authoritative-repository',
          },
        },
        contract: { approved: false, id: null },
        proposeBranch: 'cp-harness-propose-r1-11111111-a3',
        proposeBranchSha: approvedSha,
        proposeBranchRn: 1,
        ganLatestRoundVerdict: 'APPROVED',
        ganLatestRoundContractSha: approvedSha,
      }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps } = makeEnv({ observedSeq });
    deps.readGitFile = vi.fn(() => '# must not read from origin');

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('approved_but_contract_artifacts_missing');
    expect(deps.readGitFile).not.toHaveBeenCalled();
  });

  it('APPROVED 没有不可变合同 SHA 时 fail closed，不读取可变 branch', async () => {
    const observedSeq = [obs({
      run: { id: RUN_ID, initiative_id: TASK_ID, phase: 'gan', cost_usd: 0 },
      task: { status: 'in_progress', payload: { sprint_dir: 'sprints/kernel-contract' } },
      contract: { approved: false, id: null },
      proposeBranch: 'cp-harness-propose-r1-11111111-a3',
      proposeBranchRn: 1,
      ganLatestRoundVerdict: 'APPROVED',
      ganLatestRoundContractSha: null,
    })];
    const { deps } = makeEnv({ observedSeq });
    deps.readGitFile = vi.fn(() => { throw new Error('missing immutable SHA'); });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('approved_but_no_contract_sha');
    expect(deps.readGitFile).not.toHaveBeenCalled();
  });

  it('exit（terminal）→ 直接退出，无任何写入', async () => {
    const observedSeq = [obs({ task: { status: 'aborted' } })];
    const { deps, appended, sqls } = makeEnv({ observedSeq });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(result.exitReason).toBe('task_aborted');
    expect(appended).toHaveLength(0);
    expect(sqls.some(([sql]) => /\b(?:INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
  });
});

describe('runLoop：singleton 守卫', () => {
  it('appendHop 抛 SingletonConflictError → 立即退出 exitReason=singleton_conflict，不派发', async () => {
    const observedSeq = [obs({ generatorSpawned: false })];
    const { deps } = makeEnv({ observedSeq });
    deps.appendHop = vi.fn(async () => {
      throw new SingletonConflictError(RUN_ID, 1);
    });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(result.exitReason).toBe('singleton_conflict');
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('appendHop 抛非 Singleton 错误 → 原样上抛不吞', async () => {
    const observedSeq = [obs({ generatorSpawned: false })];
    const { deps } = makeEnv({ observedSeq });
    deps.appendHop = vi.fn(async () => {
      throw new Error('connection refused');
    });

    await expect(runLoop(deps, { taskId: TASK_ID, runId: RUN_ID })).rejects.toThrow('connection refused');
  });
});

describe('runLoop：dry-run（F5 前台雏形）', () => {
  it('只观测+推导+打印：不 dispatch、不 appendHop、不写 DB、单跳即返回', async () => {
    const observedSeq = [obs({ generatorSpawned: false })];
    const { deps, appended, heartbeats, sqls } = makeEnv({ observedSeq });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID, dryRun: true });

    expect(result.exitReason).toBe('dry_run');
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
    expect(heartbeats).toHaveLength(0);
    expect(sqls.some(([sql]) => /\b(?:INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
    expect(deps.log).toHaveBeenCalled();
    // 推导结果对外可见
    expect(result.decision.action).toBe('spawn:generator');
  });
});

describe('runLoop：wait:* 不灌水', () => {
  it('Run B sees Run A failure set and requests review without dispatching generator-fix', async () => {
    const pr = {
      url: 'u',
      state: 'OPEN',
      ci: 'fail',
      merged: false,
      head_sha: 'sha-run-b',
      failed_checks: ['test:b', 'lint'],
    };
    const current = obs({
      generatorSpawned: true,
      pr,
      historicalFailureSets: [['lint', 'test:b']],
    });
    const observedSeq = [
      current,
      current,
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended } = makeEnv({ observedSeq });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.dispatch).toHaveBeenCalledWith(
      'wait:human_review',
      expect.any(Object),
    );
    expect(deps.dispatch).not.toHaveBeenCalledWith(
      'spawn:generator-fix',
      expect.any(Object),
    );
    expect(appended.map((entry) => entry.action)).toEqual([
      'wait:human_review',
      'effect:human_review_requested',
    ]);
    expect(appended[0].detail).toMatchObject({
      review_reason: 'failure_set_repeated_across_runs',
      failure_set: ['lint', 'test:b'],
    });
  });

  it('wait:human_review 首次派发预览/通知，随后同 SHA 只心跳等待', async () => {
    const pr = { url: 'u', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha-review' };
    const verdicts = {
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-review' },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-review' },
    };
    const requested = {
      hop: 2,
      action: 'effect:human_review_requested',
      observed: { pr: { head_sha: 'sha-review' } },
      detail: null,
    };
    const observedSeq = [
      obs({ generatorSpawned: true, pr, reviewRequired: true, ...verdicts }),
      obs({ generatorSpawned: true, pr, reviewRequired: true, decisionLog: [requested], ...verdicts }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended, sleeps, heartbeats } = makeEnv({ observedSeq });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.dispatch).toHaveBeenCalledWith('wait:human_review', expect.any(Object));
    expect(appended.map((entry) => entry.action)).toEqual([
      'wait:human_review',
      'effect:human_review_requested',
    ]);
    expect(sleeps).toHaveLength(1);
    expect(heartbeats).toHaveLength(2);
  });

  it('human review 首次派发失败只有 intent 时会重试，成功后才写 effect marker', async () => {
    const pr = { url: 'u', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha-review' };
    const verdicts = {
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-review' },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-review' },
    };
    const failedIntent = {
      hop: 1,
      action: 'wait:human_review',
      observed: { pr: { head_sha: 'sha-review' } },
    };
    const observedSeq = [
      obs({ generatorSpawned: true, pr, reviewRequired: true, ...verdicts }),
      obs({
        generatorSpawned: true,
        pr,
        reviewRequired: true,
        decisionLog: [failedIntent],
        ...verdicts,
      }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const dispatch = vi.fn()
      .mockResolvedValueOnce({ status: 'BLOCKED', detail: 'preview failed' })
      .mockResolvedValueOnce({ status: 'DONE', detail: 'preview ready' });
    const { deps, appended } = makeEnv({ observedSeq, dispatch });

    await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(deps.dispatch).toHaveBeenCalledTimes(2);
    expect(appended.map((entry) => entry.action)).toEqual([
      'wait:human_review',
      'result:dispatch',
      'wait:human_review',
      'effect:human_review_requested',
    ]);
  });

  it('wait:poll_ci → 不派 dispatcher，持久化 poll hop 后心跳+sleep', async () => {
    const pr = { url: 'u', state: 'OPEN', ci: 'pending', merged: false, head_sha: 's' };
    const observedSeq = [
      obs({ generatorSpawned: true, pr }),
      obs({ generatorSpawned: true, pr }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended, heartbeats, sleeps } = makeEnv({ observedSeq });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(appended.map((entry) => entry.action)).toEqual(['wait:poll_ci', 'wait:poll_ci']);
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(sleeps).toHaveLength(2);
    expect(heartbeats).toHaveLength(2);
  });

  it('wait:running（在途容器）→ 同样只心跳+sleep 不 append', async () => {
    const observedSeq = [
      obs({ inflight: { containers: [{ ID: 'c1' }], host_pids: [] } }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended, sleeps } = makeEnv({ observedSeq });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(result.exitReason).toBe('run_done');
    expect(appended).toHaveLength(0);
    expect(sleeps).toHaveLength(1);
  });

  it('expired missing reviewer 先收敛，保留历史 intent 后可在 GAN 上限内重派 reviewer', async () => {
    const expired = {
      id: '863fdc22-ad3e-4e89-a8ce-6323cf9b9917',
      run_id: RUN_ID,
      hop: 49,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'controller-old:6328',
      lease_generation: 0,
      lease_expires_at: '2026-07-04T11:59:00.000Z',
      requested_machine_id: 'us-mac-m4',
      actual_machine_id: null,
      task_bundle: { inputs: { execution_surface: 'fleet-worker' } },
    };
    const priorIntent = {
      hop: 49,
      action: 'spawn:reviewer',
      observed: { proposeBranchRn: 1 },
      detail: { reason: 'contract_round_pending_review' },
    };
    const reconciliationEvidence = {
      hop: 50,
      action: 'effect:expired_attempt_reconciled',
      observed: { attempt_id: expired.id, role: 'reviewer' },
      detail: {
        attempt_id: expired.id,
        signature: 'worker_attempt_missing_after_lease',
      },
    };
    const observedSeq = [
      obs({
        contract: { approved: false, id: CONTRACT_ID },
        proposeBranchRn: 1,
        decisionLog: [priorIntent],
        inflight: { containers: [], host_pids: [], attempts: [expired] },
      }),
      obs({
        contract: { approved: false, id: CONTRACT_ID },
        proposeBranchRn: 1,
        decisionLog: [priorIntent, reconciliationEvidence],
        inflight: { containers: [], host_pids: [], attempts: [] },
      }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended, sleeps, setHopBase } = makeEnv({ observedSeq });
    setHopBase(50);
    deps.reconcileExpiredAttempt = vi.fn(async ({ attempt }) => ({
      status: 'missing_terminalized',
      attempt_id: attempt.id,
      hop: 50,
    }));

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(deps.reconcileExpiredAttempt).toHaveBeenCalledOnce();
    expect(deps.reconcileExpiredAttempt).toHaveBeenCalledWith(expect.objectContaining({
      attempt: expired,
    }));
    expect(deps.dispatch).toHaveBeenCalledOnce();
    expect(deps.dispatch).toHaveBeenCalledWith('spawn:reviewer', expect.any(Object));
    expect(appended.some((entry) => entry.action === 'wait:running')).toBe(false);
    expect(sleeps).toHaveLength(0);
  });

  it('expired missing generator 以 callback-equivalent infrastructure 终态重派同角色', async () => {
    const expired = {
      id: '863fdc22-ad3e-4e89-a8ce-6323cf9b9917',
      run_id: RUN_ID,
      hop: 49,
      phase: 'generate',
      role: 'generator',
      status: 'running',
      lease_owner: 'controller-old:6328',
      lease_generation: 0,
      lease_expires_at: '2026-07-04T11:59:00.000Z',
      requested_machine_id: 'us-mac-m4',
      actual_machine_id: null,
      task_bundle: { inputs: { execution_surface: 'fleet-worker' } },
    };
    const priorIntent = {
      hop: 49,
      action: 'spawn:generator',
      observed: { contractApproved: true },
      detail: { reason: 'contract_approved' },
    };
    const reconciliationEvidence = {
      hop: 50,
      action: 'effect:expired_attempt_reconciled',
      observed: { attempt_id: expired.id, role: 'generator', status: 'failed' },
      detail: {
        attempt_id: expired.id,
        role: 'generator',
        status: 'failed',
        failure_class: 'infrastructure_blocked',
        signature: 'worker_attempt_missing_after_lease',
      },
    };
    const observedSeq = [
      obs({
        generatorSpawned: true,
        decisionLog: [priorIntent],
        inflight: { containers: [], host_pids: [], attempts: [expired] },
      }),
      obs({
        generatorSpawned: true,
        lastAgentExit: { code: 1, auth_failed: false, action: 'spawn:generator' },
        decisionLog: [priorIntent, reconciliationEvidence],
        inflight: { containers: [], host_pids: [], attempts: [] },
      }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended, setHopBase } = makeEnv({ observedSeq });
    setHopBase(50);
    deps.reconcileExpiredAttempt = vi.fn(async ({ attempt }) => ({
      status: 'missing_terminalized',
      attempt_id: attempt.id,
      hop: 50,
    }));

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(deps.dispatch).toHaveBeenCalledOnce();
    expect(deps.dispatch).toHaveBeenCalledWith(
      'spawn:generator-fix',
      expect.objectContaining({
        decision: {
          phase: 'generate',
          action: 'spawn:generator-fix',
          reason: 'callback_infrastructure_blocked',
        },
      }),
    );
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      action: 'spawn:generator-fix',
      detail: { reason: 'callback_infrastructure_blocked' },
      observed: { failure_class: 'infrastructure_blocked' },
    });
    expect(appended[0].observed).not.toHaveProperty('crash_signature');
  });

  it('expired Worker 基础设施不可达只写退避证据并 sleep，不进入产品修复', async () => {
    const expired = {
      id: '863fdc22-ad3e-4e89-a8ce-6323cf9b9917',
      run_id: RUN_ID,
      hop: 49,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'controller-old:6328',
      lease_generation: 0,
      lease_expires_at: '2026-07-04T11:59:00.000Z',
      requested_machine_id: 'us-mac-m4',
      task_bundle: { inputs: { execution_surface: 'fleet-worker' } },
    };
    const waiting = obs({
      contract: { approved: false, id: CONTRACT_ID },
      proposeBranchRn: 1,
      decisionLog: [{ hop: 49, action: 'spawn:reviewer', observed: {} }],
      inflight: { containers: [], host_pids: [], attempts: [expired] },
    });
    const { deps, appended, sleeps, setHopBase } = makeEnv({
      observedSeq: [waiting, obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } })],
    });
    setHopBase(49);
    deps.reconcileExpiredAttempt = vi.fn(async () => ({
      status: 'infrastructure_blocked',
      failure_class: 'infrastructure_blocked',
      signature: 'worker_attempt_inspect_unavailable',
    }));

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      action: 'result:expired_attempt_reconcile',
      gateVerdict: 'deny:infrastructure_blocked',
      detail: {
        attempt_id: expired.id,
        signature: 'worker_attempt_inspect_unavailable',
        failure_class: 'infrastructure_blocked',
      },
    });
    expect(sleeps).toEqual([POLL_INTERVAL_MS]);
  });

  it('expired authority 发现 parent run 已终态时只重采集，不写 blocked 证据', async () => {
    const expired = {
      id: '863fdc22-ad3e-4e89-a8ce-6323cf9b9917',
      run_id: RUN_ID,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'old-owner',
      lease_generation: 0,
      lease_expires_at: '2026-07-04T11:59:00.000Z',
      requested_machine_id: 'us-mac-m4',
      task_bundle: { inputs: { execution_surface: 'fleet-worker' } },
    };
    const { deps, appended, sleeps } = makeEnv({
      observedSeq: [
        obs({ inflight: { containers: [], host_pids: [], attempts: [expired] } }),
        obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
      ],
    });
    deps.reconcileExpiredAttempt = vi.fn(async () => ({
      status: 'parent_terminal',
      conflict: 'parent_run_terminal',
    }));

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(appended).toHaveLength(0);
    expect(sleeps).toHaveLength(0);
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('expired authority 丢失 lease/identity 所有权时立即让位，不追加伪基础设施证据', async () => {
    const expired = {
      id: '863fdc22-ad3e-4e89-a8ce-6323cf9b9917',
      run_id: RUN_ID,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'old-owner',
      lease_generation: 0,
      lease_expires_at: '2026-07-04T11:59:00.000Z',
      requested_machine_id: 'us-mac-m4',
      task_bundle: { inputs: { execution_surface: 'fleet-worker' } },
    };
    const { deps, appended, sleeps } = makeEnv({
      observedSeq: [
        obs({ inflight: { containers: [], host_pids: [], attempts: [expired] } }),
        obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
      ],
    });
    deps.reconcileExpiredAttempt = vi.fn(async () => ({
      status: 'ownership_lost',
      conflict: 'lease_generation_mismatch',
    }));

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result).toEqual({ exitReason: 'singleton_conflict', hops: 0 });
    expect(appended).toHaveLength(0);
    expect(sleeps).toHaveLength(0);
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('R7: LAUNCHED 只记录 attempt launch effect，不能当角色 DONE 或派下一棒', async () => {
    const observedSeq = [
      obs({ generatorSpawned: false }),
      obs({ inflight: { containers: [{ ID: 'attempt-container' }], host_pids: [] } }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const dispatch = vi.fn(async () => ({
      status: 'LAUNCHED',
      run_id: RUN_ID,
      attempt_id: '22222222-2222-4222-8222-222222222222',
      lease_generation: 4,
      provider: 'codex',
    }));
    const { deps, appended, heartbeats, sleeps } = makeEnv({ observedSeq, dispatch });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.dispatch).toHaveBeenCalledWith('spawn:generator', expect.any(Object));
    expect(appended.map((entry) => entry.action)).toEqual([
      'spawn:generator',
      'effect:attempt_launched',
    ]);
    expect(appended[1].detail).toEqual({
      dispatch_hop: 1,
      dispatch_action: 'spawn:generator',
      run_id: RUN_ID,
      attempt_id: '22222222-2222-4222-8222-222222222222',
      lease_generation: 4,
      provider: 'codex',
    });
    expect(heartbeats).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
  });

  it('R9: async needs_context 原子暂停 run，不要求 PR 也不进入 generator fix', async () => {
    const callback = {
      hop: 3,
      action: 'verdict:attempt_callback',
      detail: {
        attempt_id: '22222222-2222-4222-8222-222222222222',
        lease_generation: 0,
        role: 'generator',
        hop: 1,
        status: 'needs_context',
        failure_class: 'needs_context',
        artifacts: [],
      },
    };
    const waiting = obs({
      pr: null,
      generatorSpawned: true,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        callback,
      ],
    });
    const { deps, appended, sleeps, setHopBase, sqls } = makeEnv({
      observedSeq: [waiting],
    });
    setHopBase(3);

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('callback_needs_context');
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
    const pauseWrite = sqls.find(([sql]) => /SET phase = 'paused'/i.test(sql));
    expect(pauseWrite?.[0]).toMatch(/effect:context_requested/i);
    expect(pauseWrite?.[1]).toContain(3);
    expect(deps.dispatch).not.toHaveBeenCalledWith(
      'spawn:generator-fix',
      expect.anything(),
    );
    expect(sleeps).toHaveLength(0);
  });

  it('LAUNCHED callback 抢占 effect hop 时按 singleton conflict 正常让位', async () => {
    const { deps, appended } = makeEnv({
      observedSeq: [obs({ generatorSpawned: false })],
      dispatch: async () => ({
        status: 'LAUNCHED',
        run_id: RUN_ID,
        attempt_id: '22222222-2222-4222-8222-222222222222',
        lease_generation: 4,
        provider: 'codex',
      }),
    });
    deps.appendHop.mockImplementationOnce(async (entry) => {
      appended.push(entry);
    }).mockRejectedValueOnce(new SingletonConflictError(RUN_ID, 2));

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result).toEqual({ exitReason: 'singleton_conflict', hops: 1 });
    expect(deps.dispatch).toHaveBeenCalledOnce();
  });

  it('R10: second identical unknown_no_pr callback terminalizes without a third dispatch', async () => {
    const callback = (hop) => ({
      hop,
      action: 'verdict:attempt_callback',
      detail: {
        attempt_id: `22222222-2222-4222-8222-${String(hop).padStart(12, '0')}`,
        lease_generation: 0,
        role: 'generator',
        hop: hop - 1,
        status: 'completed',
        failure_class: null,
        artifacts: [],
      },
    });
    const observedSeq = [obs({
      pr: null,
      generatorSpawned: true,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        callback(3),
        { hop: 4, action: 'spawn:generator-fix', observed: {} },
        callback(6),
      ],
    })];
    const { deps } = makeEnv({ observedSeq });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('repeated_unknown_no_pr');
    expect(deps.finalizeRun).toHaveBeenCalledOnce();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('连续 wait:poll_ci 累积 pollCount → 超限时 derive 判 ci_timeout（mark_failed）', async () => {
    const pr = { url: 'u', state: 'OPEN', ci: 'pending', merged: false, head_sha: 's' };
    // 一直 pending：20 次 poll 后（pollCount>=MAX_POLL_COUNT）→ ci_timeout
    const observedSeq = [obs({ generatorSpawned: true, pr })];
    const { deps, sleeps } = makeEnv({ observedSeq });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(result.exitReason).toBe('ci_timeout');
    expect(sleeps).toHaveLength(20);
    expect(deps.finalizeRun).toHaveBeenCalledWith(deps.pool, {
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      outcome: 'failed',
      reason: 'ci_timeout',
    });
  });
});

describe('runLoop：appendHop detail 携带 crossCheckMismatch（Task B Minor ①）', () => {
  it('proposer intent COUNT 与分支 rN 不一致 → detail.crossCheckMismatch=true', async () => {
    const staleLog = [{ hop: 1, action: 'spawn:proposer', observed: {}, detail: null }];
    const observedSeq = [
      // COUNT(spawn:proposer)=1 但分支 rN=3（崩溃窗口漏记）→ mismatch
      obs({ contract: { approved: false, id: CONTRACT_ID }, decisionLog: staleLog, proposeBranchRn: 3 }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended, setHopBase } = makeEnv({ observedSeq });
    setHopBase(1);

    await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(appended[0].detail.crossCheckMismatch).toBe(true);
  });
});

describe('runLoop：runId 缺省解析', () => {
  it('未传 runId → 由 current_task_id 查 initiative_runs 最新一条，且带 orchestrator_version=v2 过滤（双轨期不误伤 v1）', async () => {
    const observedSeq = [obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } })];
    const { deps } = makeEnv({ observedSeq });
    deps.pool.query = vi.fn(async (sql, params) => {
      if (sql.includes('FROM initiative_runs') && sql.includes('current_task_id')) {
        expect(params).toEqual([TASK_ID]);
        expect(sql).toContain("orchestrator_version = 'v2'");
        return { rows: [{ id: RUN_ID }] };
      }
      return { rows: [] };
    });

    const result = await runLoop(deps, { taskId: TASK_ID });
    expect(result.exitReason).toBe('run_done');
    expect(deps.collectGroundTruth).toHaveBeenCalledWith(deps, expect.objectContaining({ runId: RUN_ID }));
  });

  it('未传 runId 且查不到 run 行 → throw', async () => {
    const observedSeq = [obs()];
    const { deps } = makeEnv({ observedSeq });
    await expect(runLoop(deps, { taskId: TASK_ID })).rejects.toThrow(/run/i);
  });
});

describe('runLoop：context resume 启动屏障', () => {
  it('resume token 丢失时在 collect/derive/dispatch 前退出', async () => {
    const { deps } = makeEnv({ observedSeq: [obs()] });
    deps.activateContextResume = vi.fn(async () => null);

    const result = await runLoop(deps, {
      taskId: TASK_ID,
      runId: RUN_ID,
      resumeToken: 'lost-token',
    });

    expect(result).toEqual({ exitReason: 'context_resume_claim_lost', hops: 0 });
    expect(deps.collectGroundTruth).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('child 以唯一 token 原子发布最新 request 的 resume phase 与真实 heartbeat', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ id: RUN_ID, phase: 'generate' }],
        rowCount: 1,
      })),
    };

    const activated = await activateContextResume(pool, {
      runId: RUN_ID,
      resumeToken: 'resume-token-1',
      host: 'child-host',
      pid: 43210,
      now: new Date('2026-07-30T19:05:00.000Z'),
    });

    expect(activated).toMatchObject({ id: RUN_ID, phase: 'generate' });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(
      /effect:context_requested[\s\S]*ORDER BY request\.hop DESC[\s\S]*LIMIT 1[\s\S]*verdict:context_answer/,
    );
    expect(sql).toMatch(/orchestrator_host=\$4[\s\S]*orchestrator_pid=\$5/);
    expect(sql).toMatch(/orchestrator_host=\$6/);
    expect(params).toContain('context-resume:resume-token-1');
    expect(params).toContain(43210);
  });
});
