/**
 * loop.test.js —— runLoop 轻集成（fake ground-truth 序列 + fake dispatcher），spec §测试策略 §4 全场景：
 * - fake 全链 planning→done（逐跳喂 observed 序列）
 * - 崩溃在 log 与 dispatch 之间（intent 有记录、无容器无产物 → 重派新 hop）
 * - BLOCKED×2 → failed；每跳恰一条日志一次心跳；singleton 冲突退出；dry-run 不派发；wait 不 append
 */
import { describe, it, expect, vi } from 'vitest';
import { runLoop } from '../loop.js';
import { SingletonConflictError } from '../decision-log.js';

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
    const { deps, appended } = makeEnv({
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

  it('capability BLOCKED persists structured evidence before the convergence fence', async () => {
    const evidence = {
      capability_snapshot_id: 'snapshot-blocked',
      from_target: { provider: 'codex', account: 'team4', machine: 'us-mac-m4' },
      to_target: null,
      fallback_reason: 'postgres_unreachable',
      failure_class: 'infrastructure_blocked',
    };
    const observedSeq = [obs({ generatorSpawned: false })];
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

    expect(result.exitReason).toBe('blocked_same_state');
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
      [approvedSha, 'sprints/kernel-contract/sprint-prd.md'],
      [approvedSha, 'sprints/kernel-contract/contract-draft.md'],
      [approvedSha, 'sprints/kernel-contract/contract-dod.md'],
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
