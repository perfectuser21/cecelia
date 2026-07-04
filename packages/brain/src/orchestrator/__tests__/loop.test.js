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
function makeEnv({ observedSeq, dispatch }) {
  let i = 0;
  let hopCounter = 0;
  const appended = [];
  const heartbeats = [];
  const sqls = [];
  const sleeps = [];
  const deps = {
    pool: {
      query: vi.fn(async (sql, params) => {
        sqls.push([sql, params]);
        return { rows: [] };
      }),
    },
    collectGroundTruth: vi.fn(async () => {
      const o = observedSeq[Math.min(i, observedSeq.length - 1)];
      i++;
      return typeof o === 'function' ? o() : o;
    }),
    nextHop: vi.fn(async () => {
      hopCounter++;
      return hopCounter;
    }),
    appendHop: vi.fn(async (pool, entry) => {
      appended.push(entry);
    }),
    writeHeartbeat: vi.fn(async (pool, entry) => {
      heartbeats.push(entry);
    }),
    dispatch: vi.fn(dispatch ?? (async () => ({ status: 'DONE', detail: 'ok' }))),
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
    const prMeta = { url: 'u', state: 'OPEN', merged: false, head_sha: 'sha-1' };
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
    // 每个派发跳恰一条日志（intent-before-dispatch）
    expect(appended).toHaveLength(8);
    expect(result.hops).toBe(8);
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
});

describe('runLoop：四态返回控制流', () => {
  it('BLOCKED×2（连续同态）→ run 置 failed + exitReason=blocked_same_state', async () => {
    const observedSeq = [obs({ generatorSpawned: false })];
    const { deps, sqls } = makeEnv({
      observedSeq,
      dispatch: async () => ({ status: 'BLOCKED', detail: 'cannot proceed' }),
    });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('blocked_same_state');
    expect(deps.dispatch).toHaveBeenCalledTimes(2);
    const failSql = sqls.find(([sql]) => sql.includes('initiative_runs') && sql.includes("'failed'"));
    expect(failSql).toBeTruthy();
    expect(failSql[1]).toContain(RUN_ID);
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
  it('mark_failed（如 hop cap）→ UPDATE initiative_runs phase=failed + 退出，不派发', async () => {
    const bigLog = Array.from({ length: 200 }, (_, k) => ({ hop: k + 1, action: 'wait_marker', observed: {}, detail: null }));
    const observedSeq = [obs({ decisionLog: bigLog })];
    const { deps, sqls } = makeEnv({ observedSeq });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('hop_cap');
    expect(deps.dispatch).not.toHaveBeenCalled();
    const failSql = sqls.find(([sql]) => sql.includes('initiative_runs') && sql.includes("'failed'"));
    expect(failSql).toBeTruthy();
    expect(failSql[1]).toEqual(expect.arrayContaining([RUN_ID, 'hop_cap']));
  });

  it('persist_contract_approval 但 contract 行缺失（id=null）→ failed(approved_but_no_contract_row)，不死转热循环', async () => {
    const observedSeq = [
      obs({ contract: { approved: false, id: null }, proposeBranchRn: 1, ganLatestRoundVerdict: 'APPROVED' }),
    ];
    const { deps, sqls, sleeps } = makeEnv({ observedSeq });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('approved_but_no_contract_row');
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(sleeps).toHaveLength(0);
    const failSql = sqls.find(([sql]) => sql.includes('initiative_runs') && sql.includes("'failed'"));
    expect(failSql).toBeTruthy();
    expect(failSql[1]).toEqual(expect.arrayContaining([RUN_ID, 'approved_but_no_contract_row']));
    // 没有打向 initiative_contracts 的 0 行 UPDATE
    expect(sqls.some(([sql]) => sql.includes('initiative_contracts'))).toBe(false);
  });

  it('exit（terminal）→ 直接退出，无任何写入', async () => {
    const observedSeq = [obs({ task: { status: 'aborted' } })];
    const { deps, appended, sqls } = makeEnv({ observedSeq });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(result.exitReason).toBe('task_aborted');
    expect(appended).toHaveLength(0);
    expect(sqls).toHaveLength(0);
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
    expect(sqls).toHaveLength(0);
    expect(deps.log).toHaveBeenCalled();
    // 推导结果对外可见
    expect(result.decision.action).toBe('spawn:generator');
  });
});

describe('runLoop：wait:* 不灌水', () => {
  it('wait:poll_ci → 不派 dispatcher、不 append hop，只心跳+sleep', async () => {
    const pr = { url: 'u', state: 'OPEN', ci: 'pending', merged: false, head_sha: 's' };
    const observedSeq = [
      obs({ generatorSpawned: true, pr }),
      obs({ generatorSpawned: true, pr }),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended, heartbeats, sleeps } = makeEnv({ observedSeq });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(appended).toHaveLength(0);
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

  it('连续 wait:poll_ci 累积 pollCount → 超限时 derive 判 ci_timeout（mark_failed）', async () => {
    const pr = { url: 'u', state: 'OPEN', ci: 'pending', merged: false, head_sha: 's' };
    // 一直 pending：20 次 poll 后（pollCount>=MAX_POLL_COUNT）→ ci_timeout
    const observedSeq = [obs({ generatorSpawned: true, pr })];
    const { deps, sleeps, sqls } = makeEnv({ observedSeq });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(result.exitReason).toBe('ci_timeout');
    expect(sleeps).toHaveLength(20);
    expect(sqls.some(([sql]) => sql.includes("'failed'"))).toBe(true);
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
