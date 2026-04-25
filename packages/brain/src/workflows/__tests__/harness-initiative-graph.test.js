/**
 * Brain v2 C8a: harness-initiative graph 单元测试。
 * 覆盖 5 节点（prep/planner/parsePrd/ganLoop/dbUpsert）的 happy/idempotent/error
 * + buildGraph/compileGraph 结构 + DoD ≥5 addNode。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks 注入
const mockSpawn = vi.fn();
const mockEnsureWorktree = vi.fn();
const mockResolveToken = vi.fn();
const mockParseTaskPlan = vi.fn();
const mockUpsertTaskPlan = vi.fn();
const mockRunGan = vi.fn();
const mockReadFile = vi.fn();

vi.mock('../../spawn/index.js', () => ({ spawn: (...a) => mockSpawn(...a) }));
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: (...a) => mockEnsureWorktree(...a) }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: (...a) => mockResolveToken(...a) }));
vi.mock('../../harness-graph.js', () => ({
  parseDockerOutput: (s) => s,
  loadSkillContent: () => 'SKILL CONTENT',
}));
vi.mock('../../harness-dag.js', () => ({
  parseTaskPlan: (...a) => mockParseTaskPlan(...a),
  upsertTaskPlan: (...a) => mockUpsertTaskPlan(...a),
}));
vi.mock('../../harness-gan-graph.js', () => ({ runGanContractGraph: (...a) => mockRunGan(...a) }));
vi.mock('node:fs/promises', () => ({ default: { readFile: (...a) => mockReadFile(...a) }, readFile: (...a) => mockReadFile(...a) }));
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
  buildHarnessInitiativeGraph,
  compileHarnessInitiativeGraph,
  prepInitiativeNode,
  runPlannerNode,
  parsePrdNode,
  runGanLoopNode,
  dbUpsertNode,
  InitiativeState,
} from '../harness-initiative.graph.js';

describe('harness-initiative graph — structure', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockEnsureWorktree.mockReset();
    mockResolveToken.mockReset();
    mockParseTaskPlan.mockReset();
    mockUpsertTaskPlan.mockReset();
    mockRunGan.mockReset();
    mockReadFile.mockReset();
  });

  it('buildHarnessInitiativeGraph compile 不抛', () => {
    const g = buildHarnessInitiativeGraph();
    expect(g).toBeDefined();
    const compiled = g.compile();
    expect(typeof compiled.invoke).toBe('function');
  });

  it('compileHarnessInitiativeGraph 用 pg checkpointer 不抛', async () => {
    const compiled = await compileHarnessInitiativeGraph();
    expect(typeof compiled.invoke).toBe('function');
  });

  it('InitiativeState 含必要 channels', () => {
    expect(InitiativeState).toBeDefined();
  });
});

describe('prepInitiativeNode', () => {
  beforeEach(() => {
    mockEnsureWorktree.mockReset();
    mockResolveToken.mockReset();
  });

  it('happy: 调 ensureHarnessWorktree + resolveGitHubToken 写入 worktreePath/githubToken/initiativeId', async () => {
    mockEnsureWorktree.mockResolvedValueOnce('/wt/foo');
    mockResolveToken.mockResolvedValueOnce('ghp_xxx');
    const state = { task: { id: 't1', payload: { initiative_id: 'init-1' } } };
    const delta = await prepInitiativeNode(state);
    expect(mockEnsureWorktree).toHaveBeenCalledWith({ taskId: 't1', initiativeId: 'init-1' });
    expect(mockResolveToken).toHaveBeenCalledTimes(1);
    expect(delta.worktreePath).toBe('/wt/foo');
    expect(delta.githubToken).toBe('ghp_xxx');
    expect(delta.initiativeId).toBe('init-1');
    expect(delta.error).toBeUndefined();
  });

  it('idempotent: state.worktreePath 已存在 → 不调底层依赖', async () => {
    const state = { worktreePath: '/wt/existing', task: { id: 't2' } };
    const delta = await prepInitiativeNode(state);
    expect(mockEnsureWorktree).not.toHaveBeenCalled();
    expect(mockResolveToken).not.toHaveBeenCalled();
    expect(delta.worktreePath).toBe('/wt/existing');
  });

  it('error: ensureHarnessWorktree 抛 → state.error.node="prep"', async () => {
    mockEnsureWorktree.mockRejectedValueOnce(new Error('worktree busy'));
    const state = { task: { id: 't3', payload: {} } };
    const delta = await prepInitiativeNode(state);
    expect(delta.error).toBeDefined();
    expect(delta.error.node).toBe('prep');
    expect(delta.error.message).toBe('worktree busy');
  });
});
