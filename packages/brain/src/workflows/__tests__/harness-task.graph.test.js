/**
 * Sprint 1 Phase B/C 全图重构 — harness-task.graph 单元测试。
 * 覆盖 sub-graph 5 节点 + 端到端 happy / fix-loop / timeout / no_pr。
 *
 * Layer 3（LangGraph 修正 Sprint）：spawnGeneratorNode 重构成
 * spawnNode + awaitCallbackNode（spawn detached → interrupt → callback resume），
 * 这里 mock spawnDockerDetached + 真用 MemorySaver 跑 graph，验证 interrupt 后
 * Command(resume) 能正确续跑。e2e fix-loop 经过两次 spawn → 两次 resume 验证 fresh containerId。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSpawn = vi.fn();
const mockEnsureWorktree = vi.fn();
const mockResolveToken = vi.fn();
const mockWriteCallback = vi.fn();
const mockCheckPr = vi.fn();
const mockMerge = vi.fn();
const mockClassify = vi.fn();
const mockPoolQuery = vi.fn();
const mockSpawnDetached = vi.fn();

vi.mock('../../spawn/index.js', () => ({ spawn: (...a) => mockSpawn(...a) }));
vi.mock('../../harness-worktree.js', () => ({
  ensureHarnessWorktree: (...a) => mockEnsureWorktree(...a),
  harnessSubTaskBranchName: (initiativeId, logical) => `cp-mock-${String(initiativeId).slice(0, 8)}-${logical}`,
  harnessSubTaskWorktreePath: (initiativeId, logical) => `/mock-wt/task-${String(initiativeId).slice(0, 8)}-${logical}`,
}));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: (...a) => mockResolveToken(...a) }));
vi.mock('../../docker-executor.js', () => ({
  writeDockerCallback: (...a) => mockWriteCallback(...a),
  executeInDocker: (...a) => mockSpawn(...a),
}));
vi.mock('../../spawn/detached.js', () => ({
  spawnDockerDetached: (...a) => mockSpawnDetached(...a),
}));
vi.mock('../../shepherd.js', () => ({
  checkPrStatus: (...a) => mockCheckPr(...a),
  executeMerge: (...a) => mockMerge(...a),
  classifyFailedChecks: (...a) => mockClassify(...a),
}));
vi.mock('../../harness-graph.js', () => ({
  parseDockerOutput: (s) => s,
  extractField: (s, f) => {
    const m = (s || '').match(new RegExp(`${f}:\\s*(\\S+)`, 'i'));
    return m ? m[1] : null;
  },
}));
vi.mock('../../db.js', () => ({ default: { query: (...a) => mockPoolQuery(...a) } }));
// H15 PRD 阶段 2 收尾：E2E test 不真跑 gh pr view（真 URL 不存在 → 真 retry 35s 超时）。
// verifyGeneratorOutput stub 默认 resolve；ContractViolation 保留真类供 unit test new。
vi.mock('../../lib/contract-verify.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    verifyGeneratorOutput: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    setup: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    getTuple: vi.fn().mockResolvedValue(null),
    putWrites: vi.fn().mockResolvedValue(undefined),
  }),
}));

import {
  buildHarnessTaskGraph,
  spawnNode,
  spawnGeneratorNode,
  awaitCallbackNode,
  parseCallbackNode,
  verifyGeneratorNode,
  pollCiNode,
  mergePrNode,
  fixDispatchNode,
  TaskState,
  MAX_FIX_ROUNDS,
  MAX_POLL_COUNT,
  // C2 impl 时需在 harness-task.graph.js export routeAfterEvaluate 和 routeAfterPoll
  routeAfterEvaluate,
  routeAfterPoll,
} from '../harness-task.graph.js';
import { MemorySaver, Command } from '@langchain/langgraph';
import { ContractViolation } from '../../lib/contract-verify.js';

describe('harness-task graph — structure', () => {
  it('TaskState 定义存在', () => {
    expect(TaskState).toBeDefined();
  });
  it('buildHarnessTaskGraph compile 不抛', () => {
    const g = buildHarnessTaskGraph();
    const compiled = g.compile();
    expect(typeof compiled.invoke).toBe('function');
  });
  it('MAX_FIX_ROUNDS=3 / MAX_POLL_COUNT=20', () => {
    expect(MAX_FIX_ROUNDS).toBe(3);
    expect(MAX_POLL_COUNT).toBe(20);
  });
});

describe('spawnNode (Layer 3 spawn-and-interrupt)', () => {
  beforeEach(() => {
    mockSpawnDetached.mockReset();
    mockEnsureWorktree.mockReset();
    mockResolveToken.mockReset();
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });

  it('happy: prep + detached docker run + 写 thread_lookup + 返回 containerId', async () => {
    mockEnsureWorktree.mockResolvedValueOnce('/wt/abc');
    mockResolveToken.mockResolvedValueOnce('ghp_x');
    mockSpawnDetached.mockResolvedValueOnce({ containerId: 'abc' });

    const state = {
      task: { id: 'sub-1', title: 'T', description: 'D', payload: { parent_task_id: 'init-1' } },
      initiativeId: 'init-1',
    };
    const delta = await spawnNode(state);

    expect(mockEnsureWorktree).toHaveBeenCalledWith({
      taskId: 'sub-1',
      initiativeId: 'init-1',
      wtKey: 'init-1-sub-1',
      branch: 'cp-mock-init-1-sub-1',
    });
    expect(mockResolveToken).toHaveBeenCalled();
    expect(mockSpawnDetached).toHaveBeenCalledTimes(1);
    const spawnArg = mockSpawnDetached.mock.calls[0][0];
    expect(spawnArg.env.HARNESS_NODE).toBe('generator');
    expect(spawnArg.env.HARNESS_FIX_MODE).toBe('false');
    expect(spawnArg.env.GITHUB_TOKEN).toBe('ghp_x');
    expect(spawnArg.env.BRAIN_URL).toBe('http://host.docker.internal:5221');
    expect(spawnArg.containerId).toMatch(/^harness-task-sub-1-r0-/);
    // thread_lookup INSERT — graph_name='harness-task' 在 SQL 字面量里
    const insertCall = mockPoolQuery.mock.calls.find(
      (c) => /INSERT INTO walking_skeleton_thread_lookup/.test(c[0]) &&
             /'harness-task'/.test(c[0])
    );
    expect(insertCall).toBeDefined();
    // params: [container_id, thread_id]
    expect(insertCall[1][0]).toBe(spawnArg.containerId);
    expect(insertCall[1][1]).toBe('harness-task:init-1:sub-1');
    // delta
    expect(delta.containerId).toBe(spawnArg.containerId);
    expect(delta.worktreePath).toBe('/wt/abc');
    expect(delta.error).toBeUndefined();
    // 不应再有 generator_output（要等 callback resume）
    expect(delta.generator_output).toBeUndefined();
  });

  it('fix_round>0 → 注入 HARNESS_FIX_MODE=true 且 containerId 含 r{round}', async () => {
    mockEnsureWorktree.mockResolvedValueOnce('/wt/x');
    mockResolveToken.mockResolvedValueOnce('ghp');
    mockSpawnDetached.mockResolvedValueOnce({});
    await spawnNode({
      task: { id: 's', payload: {} }, initiativeId: 'i', fix_round: 2,
    });
    const arg = mockSpawnDetached.mock.calls[0][0];
    expect(arg.env.HARNESS_FIX_MODE).toBe('true');
    expect(arg.containerId).toMatch(/^harness-task-s-r2-/);
  });

  it('detached spawn 失败 → 写 error 不抛', async () => {
    mockEnsureWorktree.mockResolvedValueOnce('/wt');
    mockResolveToken.mockResolvedValueOnce('t');
    mockSpawnDetached.mockRejectedValueOnce(new Error('docker daemon down'));
    const delta = await spawnNode({
      task: { id: 's', payload: {} }, initiativeId: 'i',
    });
    expect(delta.error).toBeTruthy();
    expect(delta.error.node).toBe('spawn');
    expect(delta.error.message).toContain('docker daemon down');
  });

  it('idempotent: state.containerId 已有 → 跳过 spawn', async () => {
    const delta = await spawnNode({
      task: { id: 's' }, initiativeId: 'i', containerId: 'cached-cid',
    });
    expect(mockSpawnDetached).not.toHaveBeenCalled();
    expect(mockEnsureWorktree).not.toHaveBeenCalled();
    expect(delta.containerId).toBe('cached-cid');
  });

  it('thread_lookup INSERT 失败不污染成功 spawn', async () => {
    mockEnsureWorktree.mockResolvedValueOnce('/wt');
    mockResolveToken.mockResolvedValueOnce('t');
    mockSpawnDetached.mockResolvedValueOnce({});
    mockPoolQuery.mockReset();
    mockPoolQuery.mockRejectedValue(new Error('db down'));
    const delta = await spawnNode({
      task: { id: 's', payload: {} }, initiativeId: 'i',
    });
    expect(delta.containerId).toBeDefined();
    expect(delta.error).toBeUndefined();
  });
});

describe('awaitCallbackNode (Layer 3 interrupt yield)', () => {
  it('idempotent: state.generator_output 已有 → 直接返回，不 interrupt', async () => {
    const delta = await awaitCallbackNode({
      generator_output: 'cached', containerId: 'c1',
    });
    expect(delta.generator_output).toBe('cached');
  });
});

// 保留 spawnGeneratorNode 兼容性 export（给老调用方）
describe('spawnGeneratorNode (legacy compat)', () => {
  it('export 仍存在（别名 spawnNode）', () => {
    expect(typeof spawnGeneratorNode).toBe('function');
  });
});

describe('parseCallbackNode', () => {
  it('提取 pr_url + pr_branch', async () => {
    const delta = await parseCallbackNode({
      generator_output: 'foo\npr_url: https://x/pull/9\npr_branch: cp-foo\ncommit_sha: abc',
    });
    expect(delta.pr_url).toBe('https://x/pull/9');
    expect(delta.pr_branch).toBe('cp-foo');
  });
  it('无 generator_output → 不报错，无 pr_url', async () => {
    const delta = await parseCallbackNode({});
    expect(delta.pr_url).toBeFalsy();
  });
  it('idempotent: state.pr_url 已存在 → 直接返回不重抽', async () => {
    const delta = await parseCallbackNode({
      pr_url: 'https://existing/pull/1',
      pr_branch: 'cp-existing',
      generator_output: 'IGNORED',
    });
    expect(delta.pr_url).toBe('https://existing/pull/1');
  });
});

describe('verifyGeneratorNode (H15 PRD 阶段 2 收尾)', () => {
  it('happy: pr_url 通过 verify → 不抛 + 不修 state', async () => {
    const verifyFn = vi.fn().mockResolvedValue(undefined);
    const delta = await verifyGeneratorNode(
      { pr_url: 'https://github.com/x/y/pull/1' },
      { verifyGenerator: verifyFn },
    );
    expect(verifyFn).toHaveBeenCalledOnce();
    const arg = verifyFn.mock.calls[0][0];
    expect(arg.pr_url).toBe('https://github.com/x/y/pull/1');
    expect(delta).toEqual({});
  });

  it('verify throw ContractViolation → 该错误向上 propagate（让 LangGraph retryPolicy 接管）', async () => {
    const verifyFn = vi.fn().mockRejectedValue(
      new ContractViolation('generator_pr_not_found', { pr_url: 'fake' }),
    );
    await expect(
      verifyGeneratorNode(
        { pr_url: 'fake' },
        { verifyGenerator: verifyFn },
      ),
    ).rejects.toThrow(ContractViolation);
  });

  it('idempotent: state.poll_count > 0 → 跳过 verify', async () => {
    const verifyFn = vi.fn().mockResolvedValue(undefined);
    await verifyGeneratorNode(
      { pr_url: 'https://x/pull/1', poll_count: 1 },
      { verifyGenerator: verifyFn },
    );
    expect(verifyFn).not.toHaveBeenCalled();
  });

  it('opts.requiredArtifacts 透传给 verify', async () => {
    const verifyFn = vi.fn().mockResolvedValue(undefined);
    await verifyGeneratorNode(
      { pr_url: 'https://x/pull/1' },
      { verifyGenerator: verifyFn, requiredArtifacts: ['a.js', 'b.js'] },
    );
    expect(verifyFn.mock.calls[0][0].requiredArtifacts).toEqual(['a.js', 'b.js']);
  });
});

describe('harness-task graph topology (H15 verify_generator wiring)', () => {
  it('graph compile 后含 verify_generator 节点', () => {
    const g = buildHarnessTaskGraph();
    const compiled = g.compile();
    const nodes = Object.keys(compiled.nodes || {});
    expect(nodes).toContain('verify_generator');
  });
});

describe('pollCiNode', () => {
  beforeEach(() => {
    mockCheckPr.mockReset();
    mockClassify.mockReset();
  });

  it('happy: ci_passed → 写 ci_status=pass + poll_count++', async () => {
    mockCheckPr.mockReturnValueOnce({ ciStatus: 'ci_passed', state: 'OPEN', mergeable: 'MERGEABLE', failedChecks: [] });
    const delta = await pollCiNode(
      { pr_url: 'https://x/pull/1', poll_count: 0 },
      { sleepMs: 0 }
    );
    expect(delta.ci_status).toBe('pass');
    expect(delta.poll_count).toBe(1);
  });

  it('ci_failed → ci_status=fail + classifyFailedChecks', async () => {
    mockCheckPr.mockReturnValueOnce({ ciStatus: 'ci_failed', failedChecks: ['eslint'] });
    mockClassify.mockReturnValueOnce('lint');
    const delta = await pollCiNode(
      { pr_url: 'x', poll_count: 0 },
      { sleepMs: 0 }
    );
    expect(delta.ci_status).toBe('fail');
    expect(delta.ci_fail_type).toBe('lint');
    expect(delta.failed_checks).toEqual(['eslint']);
  });

  it('ci_pending → ci_status=pending + poll_count++', async () => {
    mockCheckPr.mockReturnValueOnce({ ciStatus: 'ci_pending', failedChecks: [] });
    const delta = await pollCiNode(
      { pr_url: 'x', poll_count: 5 },
      { sleepMs: 0 }
    );
    expect(delta.ci_status).toBe('pending');
    expect(delta.poll_count).toBe(6);
  });

  it('poll_count >= MAX → ci_status=timeout', async () => {
    const delta = await pollCiNode(
      { pr_url: 'x', poll_count: MAX_POLL_COUNT },
      { sleepMs: 0 }
    );
    expect(delta.ci_status).toBe('timeout');
    expect(mockCheckPr).not.toHaveBeenCalled();
  });

  it('PR closed → ci_status=fail + error', async () => {
    mockCheckPr.mockReturnValueOnce({ ciStatus: 'closed', state: 'CLOSED', failedChecks: [] });
    const delta = await pollCiNode({ pr_url: 'x', poll_count: 0 }, { sleepMs: 0 });
    expect(delta.error).toBeTruthy();
    expect(delta.ci_status).toBe('fail');
  });

  it('checkPrStatus throw → 不阻断，poll_count++ 等下次', async () => {
    mockCheckPr.mockImplementationOnce(() => { throw new Error('gh down'); });
    const delta = await pollCiNode({ pr_url: 'x', poll_count: 1 }, { sleepMs: 0 });
    expect(delta.ci_status).toBe('pending');
    expect(delta.poll_count).toBe(2);
  });
});

describe('mergePrNode', () => {
  beforeEach(() => { mockMerge.mockReset(); });
  it('happy: 调 executeMerge 写 status=merged', async () => {
    mockMerge.mockReturnValueOnce(true);
    const delta = await mergePrNode({ pr_url: 'https://x/pull/1' });
    expect(mockMerge).toHaveBeenCalledWith('https://x/pull/1');
    expect(delta.status).toBe('merged');
  });
  it('merge 失败 → error', async () => {
    mockMerge.mockImplementationOnce(() => { throw new Error('conflict'); });
    const delta = await mergePrNode({ pr_url: 'x' });
    expect(delta.error).toBeTruthy();
    expect(delta.status).toBe('failed');
  });
  it('idempotent: status 已 merged → 跳过', async () => {
    const delta = await mergePrNode({ pr_url: 'x', status: 'merged' });
    expect(mockMerge).not.toHaveBeenCalled();
    expect(delta.status).toBe('merged');
  });
});

describe('fixDispatchNode', () => {
  it('fix_round 当前=2 → 返回 3 + 清 generator_output/pr_url/poll_count/ci_status/containerId', async () => {
    const delta = await fixDispatchNode({
      fix_round: 2, generator_output: 'old', pr_url: 'p', poll_count: 7, ci_status: 'fail',
      containerId: 'old-cid',
    });
    expect(delta.fix_round).toBe(3);
    expect(delta.generator_output).toBeNull();
    expect(delta.pr_url).toBeNull();
    expect(delta.poll_count).toBe(0);
    expect(delta.ci_status).toBe('pending');
    // Layer 3：fresh spawn 必须 reset containerId，否则 spawn 幂等门 short-circuit
    expect(delta.containerId).toBeNull();
  });
  it('未指定 fix_round → 默认从 0 → 1', async () => {
    const delta = await fixDispatchNode({});
    expect(delta.fix_round).toBe(1);
  });
});

describe('harness-task graph — end-to-end (Layer 3 spawn-interrupt-resume)', () => {
  beforeEach(() => {
    process.env.HARNESS_POLL_INTERVAL_MS = '0';
    mockSpawn.mockReset();
    mockSpawnDetached.mockReset();
    mockSpawnDetached.mockResolvedValue({});
    mockEnsureWorktree.mockReset();
    mockEnsureWorktree.mockResolvedValue('/wt');
    mockResolveToken.mockReset();
    mockResolveToken.mockResolvedValue('t');
    mockWriteCallback.mockReset();
    mockWriteCallback.mockResolvedValue();
    mockCheckPr.mockReset();
    mockMerge.mockReset();
    mockClassify.mockReset();
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });
  afterEach(() => { delete process.env.HARNESS_POLL_INTERVAL_MS; });

  /**
   * 跑到 await_callback interrupt 然后用 Command(resume) 模拟 callback router；
   * 一直 resume 直到 graph 走到 END（poll_ci 节点不 interrupt，直接靠 mockCheckPr）。
   * 每次 await invoke 后 getState：
   *   next 含 'await_callback' → resume(callbackPayload)
   *   next 含 'evaluate_contract' → resume(evaluatePayload) [C2: 新增 pre-merge gate 节点 interrupt]
   *   next 为空 → 结束
   *   recursionLimit 防死循环
   */
  async function runUntilEnd(compiled, initialInput, config, callbackPayloads, evaluatePayloads = []) {
    let payloads = [...callbackPayloads];
    let evalPayloads = [...evaluatePayloads];
    await compiled.invoke(initialInput, config);
    let i = 0;
    while (i < 30) {
      const state = await compiled.getState(config);
      if (!state.next || state.next.length === 0) {
        return state.values;
      }
      if (state.next.includes('await_callback')) {
        const next = payloads.shift();
        if (!next) throw new Error('callback payloads exhausted but graph still in await_callback');
        await compiled.invoke(new Command({ resume: next }), config);
      } else if (state.next.includes('evaluate_contract')) {
        // C2: evaluate_contract 节点 interrupt() 等 evaluator callback。
        // 默认 PASS（stdout 含 verdict:PASS），可通过 evaluatePayloads 覆盖测试 FAIL 分支。
        const evalNext = evalPayloads.shift() || { stdout: 'verdict:PASS', exit_code: 0 };
        await compiled.invoke(new Command({ resume: evalNext }), config);
      } else {
        // 不该到这里 — 其它节点不该 interrupt
        throw new Error(`unexpected interrupt at ${state.next.join(',')}`);
      }
      i++;
    }
    throw new Error('runUntilEnd exceeded 30 iterations');
  }

  it('happy: spawn → interrupt → resume(stdout) → parse → ci_pass → merge → END', async () => {
    mockCheckPr.mockReturnValue({ ciStatus: 'ci_passed', state: 'OPEN', mergeable: 'MERGEABLE', failedChecks: [] });
    mockMerge.mockReturnValue(true);

    const compiled = buildHarnessTaskGraph().compile({ checkpointer: new MemorySaver() });
    const final = await runUntilEnd(
      compiled,
      { task: { id: 'sub-1', payload: {} }, initiativeId: 'i' },
      { configurable: { thread_id: 't1' }, recursionLimit: 50 },
      [{ stdout: 'pr_url: https://gh/p/1', exit_code: 0 }]
    );
    expect(final.status).toBe('merged');
    expect(final.pr_url).toBe('https://gh/p/1');
    // C2: spawnDetached 至少被调用 2 次（1 generator + 1 evaluator）
    expect(mockSpawnDetached.mock.calls.length).toBeGreaterThanOrEqual(2);
    const generatorSpawn = mockSpawnDetached.mock.calls.find(c => /harness-task-/.test(c[0].containerId));
    const evaluatorSpawn = mockSpawnDetached.mock.calls.find(c => /harness-evaluate-/.test(c[0].containerId));
    expect(generatorSpawn).toBeDefined();
    expect(evaluatorSpawn).toBeDefined();
    expect(mockMerge).toHaveBeenCalledTimes(1);
  });

  it('fix loop: spawn → resume → ci_fail → fix → fresh spawn (round 2) → resume → ci_pass → merge', async () => {
    mockCheckPr
      .mockReturnValueOnce({ ciStatus: 'ci_failed', failedChecks: ['lint'] })
      .mockReturnValueOnce({ ciStatus: 'ci_passed', failedChecks: [] });
    mockClassify.mockReturnValue('lint');
    mockMerge.mockReturnValue(true);

    const compiled = buildHarnessTaskGraph().compile({ checkpointer: new MemorySaver() });
    const final = await runUntilEnd(
      compiled,
      { task: { id: 'sub-2', payload: {} }, initiativeId: 'i' },
      { configurable: { thread_id: 't2' }, recursionLimit: 100 },
      [
        { stdout: 'pr_url: https://gh/p/1', exit_code: 0 }, // round 0 spawn
        { stdout: 'pr_url: https://gh/p/2', exit_code: 0 }, // round 1 fresh spawn
      ]
    );
    expect(final.status).toBe('merged');
    expect(final.fix_round).toBe(1);
    // C2: 2 generator spawns (round 0 + round 1) + 2 evaluator spawns = 4 total
    expect(mockSpawnDetached).toHaveBeenCalledTimes(4);
    // 验证两次 generator spawn 用了不同 containerId（round 0 vs round 1）
    const generatorCalls = mockSpawnDetached.mock.calls.filter(c => /harness-task-/.test(c[0].containerId));
    expect(generatorCalls).toHaveLength(2);
    const cid0 = generatorCalls[0][0].containerId;
    const cid1 = generatorCalls[1][0].containerId;
    expect(cid0).not.toBe(cid1);
    expect(cid0).toMatch(/-r0-/);
    expect(cid1).toMatch(/-r1-/);
  });

  it('no_pr: spawn → resume(无 pr_url) → END (no poll, no merge)', async () => {
    const compiled = buildHarnessTaskGraph().compile({ checkpointer: new MemorySaver() });
    const final = await runUntilEnd(
      compiled,
      { task: { id: 'sub-4', payload: {} }, initiativeId: 'i' },
      { configurable: { thread_id: 't4' } },
      [{ stdout: 'no pr created', exit_code: 0 }]
    );
    expect(final.pr_url).toBeNull();
    expect(mockMerge).not.toHaveBeenCalled();
    expect(mockCheckPr).not.toHaveBeenCalled();
  });

  it('container exit_code != 0 → resume 把 error 写 state，graph 走 END (no merge)', async () => {
    const compiled = buildHarnessTaskGraph().compile({ checkpointer: new MemorySaver() });
    const final = await runUntilEnd(
      compiled,
      { task: { id: 'sub-err', payload: {} }, initiativeId: 'i' },
      { configurable: { thread_id: 't-err' } },
      [{ stdout: '', error: 'docker died', exit_code: 1 }]
    );
    expect(final.error).toBeTruthy();
    expect(final.error.node).toBe('await_callback');
    expect(mockMerge).not.toHaveBeenCalled();
  });
});

// C1 RED: routeAfterEvaluate + routeAfterPoll (evaluate branch) 测试
// C2 impl 时需在 harness-task.graph.js export routeAfterEvaluate（新增）和 routeAfterPoll（现存但未 export）
describe('evaluate_contract pre-merge gate', () => {
  it('routeAfterEvaluate: PASS verdict routes to merge', () => {
    const state = { evaluate_verdict: 'PASS' };
    expect(routeAfterEvaluate(state)).toBe('merge');
  });

  it('routeAfterEvaluate: FAIL verdict routes to fix', () => {
    const state = { evaluate_verdict: 'FAIL', evaluate_error: 'schema mismatch on /increment' };
    expect(routeAfterEvaluate(state)).toBe('fix');
  });

  it('routeAfterPoll: ci_status=pass now routes to evaluate (not merge)', () => {
    const state = { ci_status: 'pass' };
    expect(routeAfterPoll(state)).toBe('evaluate');
  });

  // B10 (Walking Skeleton P1 cascade): evaluator spawn 写 thread_lookup 必须用
  // task graph thread_id (harness-task: prefix)，不发明 harness-evaluate: prefix。
  // W31 实证：harness-evaluate: thread_id 让 callback resume 打到空 thread，真正
  // interrupt 等待的 harness-task thread 永久卡。
  // 静态 source-level invariant（避免 runtime fixture 重布）。
  it('B10: evaluateContractNode 源码 threadId 用 harness-task: 不用 harness-evaluate:', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'harness-task.graph.js'), 'utf8');
    const evalFnMatch = src.match(/async function evaluateContractNode[\s\S]*?\n}\n/);
    expect(evalFnMatch).not.toBeNull();
    const body = evalFnMatch[0];
    // 必须有 const threadId = `harness-task:${initiativeId}:${task.id}`
    expect(body).toMatch(/const\s+threadId\s*=\s*`harness-task:\$\{/);
    // 不能再有 const threadId = `harness-evaluate:${...}`
    expect(body).not.toMatch(/const\s+threadId\s*=\s*`harness-evaluate:\$\{/);
    // INSERT walking_skeleton_thread_lookup 用 graph_name='harness-task'
    expect(body).toMatch(/INSERT INTO walking_skeleton_thread_lookup[\s\S]*'harness-task'/);
    expect(body).not.toMatch(/INSERT INTO walking_skeleton_thread_lookup[\s\S]*'harness-evaluate'/);
  });
});
