/**
 * Sprint 1 Phase B/C 全图重构 — harness-task.graph 单元测试。
 * 覆盖 sub-graph 5 节点 + 端到端 happy / fix-loop / timeout / no_pr。
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

vi.mock('../../spawn/index.js', () => ({ spawn: (...a) => mockSpawn(...a) }));
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: (...a) => mockEnsureWorktree(...a) }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: (...a) => mockResolveToken(...a) }));
vi.mock('../../docker-executor.js', () => ({
  writeDockerCallback: (...a) => mockWriteCallback(...a),
  executeInDocker: (...a) => mockSpawn(...a),
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
  spawnGeneratorNode,
  parseCallbackNode,
  pollCiNode,
  mergePrNode,
  fixDispatchNode,
  TaskState,
  MAX_FIX_ROUNDS,
  MAX_POLL_COUNT,
} from '../harness-task.graph.js';
import { MemorySaver } from '@langchain/langgraph';

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

describe('spawnGeneratorNode', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockEnsureWorktree.mockReset();
    mockResolveToken.mockReset();
    mockWriteCallback.mockReset();
  });

  it('happy: prep + spawn + writeCallback 注入 env + 返回 generator_output', async () => {
    mockEnsureWorktree.mockResolvedValueOnce('/wt/abc');
    mockResolveToken.mockResolvedValueOnce('ghp_x');
    mockSpawn.mockResolvedValueOnce({
      exit_code: 0, stdout: 'pr_url: https://github.com/o/r/pull/1\nfoo', stderr: '', cost_usd: 0.5,
    });
    mockWriteCallback.mockResolvedValueOnce();
    const state = {
      task: { id: 'sub-1', title: 'T', description: 'D', payload: { parent_task_id: 'init-1' } },
      initiativeId: 'init-1',
    };
    const delta = await spawnGeneratorNode(state);
    expect(mockEnsureWorktree).toHaveBeenCalledWith({ taskId: 'sub-1', initiativeId: 'init-1' });
    expect(mockResolveToken).toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const spawnArg = mockSpawn.mock.calls[0][0];
    expect(spawnArg.env.HARNESS_NODE).toBe('generator');
    expect(spawnArg.env.HARNESS_FIX_MODE).toBe('false');
    expect(spawnArg.env.GITHUB_TOKEN).toBe('ghp_x');
    expect(mockWriteCallback).toHaveBeenCalledTimes(1);
    expect(delta.generator_output).toContain('pr_url:');
    expect(delta.worktreePath).toBe('/wt/abc');
    expect(delta.cost_usd).toBe(0.5);
    expect(delta.error).toBeUndefined();
  });

  it('fix_round>0 → 注入 HARNESS_FIX_MODE=true', async () => {
    mockEnsureWorktree.mockResolvedValueOnce('/wt/x');
    mockResolveToken.mockResolvedValueOnce('ghp');
    mockSpawn.mockResolvedValueOnce({ exit_code: 0, stdout: 'ok', stderr: '' });
    mockWriteCallback.mockResolvedValueOnce();
    await spawnGeneratorNode({
      task: { id: 's', payload: {} }, initiativeId: 'i', fix_round: 2,
    });
    expect(mockSpawn.mock.calls[0][0].env.HARNESS_FIX_MODE).toBe('true');
  });

  it('container 失败 → 写 error 不抛', async () => {
    mockEnsureWorktree.mockResolvedValueOnce('/wt');
    mockResolveToken.mockResolvedValueOnce('t');
    mockSpawn.mockResolvedValueOnce({ exit_code: 1, stderr: 'boom', stdout: '' });
    const delta = await spawnGeneratorNode({
      task: { id: 's', payload: {} }, initiativeId: 'i',
    });
    expect(delta.error).toBeTruthy();
    expect(delta.error.node).toBe('spawn_generator');
  });

  it('idempotent: state.generator_output 已有 → 跳过 spawn', async () => {
    const delta = await spawnGeneratorNode({
      task: { id: 's' }, initiativeId: 'i', generator_output: 'cached',
    });
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(delta.generator_output).toBe('cached');
  });

  it('writeCallback 失败不污染成功状态', async () => {
    mockEnsureWorktree.mockResolvedValueOnce('/wt');
    mockResolveToken.mockResolvedValueOnce('t');
    mockSpawn.mockResolvedValueOnce({ exit_code: 0, stdout: 'ok', stderr: '' });
    mockWriteCallback.mockRejectedValueOnce(new Error('db down'));
    const delta = await spawnGeneratorNode({
      task: { id: 's', payload: {} }, initiativeId: 'i',
    });
    expect(delta.generator_output).toBe('ok');
    expect(delta.error).toBeUndefined();
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
  it('fix_round 当前=2 → 返回 3 + 清 generator_output/pr_url/poll_count/ci_status', async () => {
    const delta = await fixDispatchNode({
      fix_round: 2, generator_output: 'old', pr_url: 'p', poll_count: 7, ci_status: 'fail',
    });
    expect(delta.fix_round).toBe(3);
    expect(delta.generator_output).toBeNull();
    expect(delta.pr_url).toBeNull();
    expect(delta.poll_count).toBe(0);
    expect(delta.ci_status).toBe('pending');
  });
  it('未指定 fix_round → 默认从 0 → 1', async () => {
    const delta = await fixDispatchNode({});
    expect(delta.fix_round).toBe(1);
  });
});

describe('harness-task graph — end-to-end', () => {
  beforeEach(() => {
    process.env.HARNESS_POLL_INTERVAL_MS = '0';
    mockSpawn.mockReset();
    mockEnsureWorktree.mockReset();
    mockResolveToken.mockReset();
    mockWriteCallback.mockReset();
    mockCheckPr.mockReset();
    mockMerge.mockReset();
    mockClassify.mockReset();
  });
  afterEach(() => { delete process.env.HARNESS_POLL_INTERVAL_MS; });

  it('happy: spawn → pr_url → ci_pass → merge → END status=merged', async () => {
    mockEnsureWorktree.mockResolvedValue('/wt');
    mockResolveToken.mockResolvedValue('t');
    mockSpawn.mockResolvedValue({ exit_code: 0, stdout: 'pr_url: https://gh/p/1', stderr: '' });
    mockWriteCallback.mockResolvedValue();
    mockCheckPr.mockReturnValue({ ciStatus: 'ci_passed', state: 'OPEN', mergeable: 'MERGEABLE', failedChecks: [] });
    mockMerge.mockReturnValue(true);

    const compiled = buildHarnessTaskGraph().compile({ checkpointer: new MemorySaver() });
    const final = await compiled.invoke(
      { task: { id: 'sub-1', payload: {} }, initiativeId: 'i' },
      { configurable: { thread_id: 't1' } }
    );
    expect(final.status).toBe('merged');
    expect(final.pr_url).toBe('https://gh/p/1');
    expect(mockMerge).toHaveBeenCalledTimes(1);
  });

  it('fix loop: spawn → ci_fail → fix → spawn (round 2) → ci_pass → merge → END', async () => {
    mockEnsureWorktree.mockResolvedValue('/wt');
    mockResolveToken.mockResolvedValue('t');
    mockSpawn
      .mockResolvedValueOnce({ exit_code: 0, stdout: 'pr_url: https://gh/p/1', stderr: '' })
      .mockResolvedValueOnce({ exit_code: 0, stdout: 'pr_url: https://gh/p/1', stderr: '' });
    mockWriteCallback.mockResolvedValue();
    mockCheckPr
      .mockReturnValueOnce({ ciStatus: 'ci_failed', failedChecks: ['lint'] })
      .mockReturnValueOnce({ ciStatus: 'ci_passed', failedChecks: [] });
    mockClassify.mockReturnValue('lint');
    mockMerge.mockReturnValue(true);

    const compiled = buildHarnessTaskGraph().compile({ checkpointer: new MemorySaver() });
    const final = await compiled.invoke(
      { task: { id: 'sub-2', payload: {} }, initiativeId: 'i' },
      { configurable: { thread_id: 't2' }, recursionLimit: 50 }
    );
    expect(final.status).toBe('merged');
    expect(final.fix_round).toBe(1);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it('max fix rounds: ci_fail × N → END status=failed (no merge)', async () => {
    mockEnsureWorktree.mockResolvedValue('/wt');
    mockResolveToken.mockResolvedValue('t');
    mockSpawn.mockResolvedValue({ exit_code: 0, stdout: 'pr_url: https://gh/p/1', stderr: '' });
    mockWriteCallback.mockResolvedValue();
    mockCheckPr.mockReturnValue({ ciStatus: 'ci_failed', failedChecks: ['test'] });
    mockClassify.mockReturnValue('test');

    const compiled = buildHarnessTaskGraph().compile({ checkpointer: new MemorySaver() });
    const final = await compiled.invoke(
      { task: { id: 'sub-3', payload: {} }, initiativeId: 'i' },
      { configurable: { thread_id: 't3' }, recursionLimit: 100 }
    );
    expect(final.fix_round).toBeGreaterThan(MAX_FIX_ROUNDS);
    expect(mockMerge).not.toHaveBeenCalled();
  });

  it('no_pr: spawn → 无 pr_url → END (no poll, no merge)', async () => {
    mockEnsureWorktree.mockResolvedValue('/wt');
    mockResolveToken.mockResolvedValue('t');
    mockSpawn.mockResolvedValue({ exit_code: 0, stdout: 'no pr created', stderr: '' });
    mockWriteCallback.mockResolvedValue();
    const compiled = buildHarnessTaskGraph().compile({ checkpointer: new MemorySaver() });
    const final = await compiled.invoke(
      { task: { id: 'sub-4', payload: {} }, initiativeId: 'i' },
      { configurable: { thread_id: 't4' } }
    );
    expect(final.pr_url).toBeNull();
    expect(mockMerge).not.toHaveBeenCalled();
    expect(mockCheckPr).not.toHaveBeenCalled();
  });
});
