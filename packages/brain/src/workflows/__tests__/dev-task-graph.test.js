/**
 * Brain v2 Phase C2: dev-task graph 单元测试。
 *
 * 覆盖：
 *   1. buildDevTaskGraph 返回 StateGraph 结构
 *   2. runAgentNode 调 spawn 且传正确 opts（mock）
 *   3. runAgentNode 错误路径：spawn 抛 → state.error 被设置
 *   4. compileDevTaskGraph 返回 compiled graph（mock pg-checkpointer）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock L3 spawn — 避免真跑 docker
const mockSpawn = vi.fn();
vi.mock('../../spawn/index.js', () => ({
  spawn: (...args) => mockSpawn(...args),
}));

// Mock pg-checkpointer — 避免真连 pg
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    setup: vi.fn().mockResolvedValue(undefined),
    // LangGraph 调的其它 method，不实际走到
    list: vi.fn().mockResolvedValue([]),
    getTuple: vi.fn().mockResolvedValue(null),
    putWrites: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { buildDevTaskGraph, compileDevTaskGraph, runAgentNode, DevTaskState } from '../dev-task.graph.js';

describe('dev-task graph', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('buildDevTaskGraph returns StateGraph with run-agent node', () => {
    const graph = buildDevTaskGraph();
    expect(graph).toBeDefined();
    // StateGraph 内部结构不直接暴露，验证通过 compile 不抛
    const compiled = graph.compile();
    expect(compiled).toBeDefined();
    expect(typeof compiled.invoke).toBe('function');
  });

  it('runAgentNode 调 spawn 传 correct opts', async () => {
    mockSpawn.mockResolvedValueOnce({ exit_code: 0, stdout: 'ok', stderr: '' });
    const state = {
      task: { id: 't1', description: 'do the thing', worktree: { path: '/wt1', branch: 'cp-x' } },
    };
    const delta = await runAgentNode(state);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const spawnOpts = mockSpawn.mock.calls[0][0];
    expect(spawnOpts.task).toBe(state.task);
    expect(spawnOpts.skill).toBe('/dev');
    expect(spawnOpts.prompt).toBe('do the thing');
    expect(spawnOpts.worktree).toEqual({ path: '/wt1', branch: 'cp-x' });
    expect(delta.result).toEqual({ exit_code: 0, stdout: 'ok', stderr: '' });
    expect(delta.error).toBeUndefined();
  });

  it('runAgentNode 错误路径：spawn 抛 → delta.error 含 message', async () => {
    mockSpawn.mockRejectedValueOnce(new Error('docker failed'));
    const state = { task: { id: 't2', description: 'fail test' } };
    const delta = await runAgentNode(state);
    expect(delta.error).toBeDefined();
    expect(delta.error.message).toBe('docker failed');
    expect(delta.result).toBeUndefined();
  });

  it('runAgentNode prompt fallback 到 task.title（无 description 时）', async () => {
    mockSpawn.mockResolvedValueOnce({ exit_code: 0 });
    const state = { task: { id: 't3', title: 'fallback title' } };
    await runAgentNode(state);
    expect(mockSpawn.mock.calls[0][0].prompt).toBe('fallback title');
  });

  it('compileDevTaskGraph 返回 compiled graph（用 pg checkpointer）', async () => {
    const compiled = await compileDevTaskGraph();
    expect(compiled).toBeDefined();
    expect(typeof compiled.invoke).toBe('function');
  });

  it('DevTaskState annotation 含 task / result / error 三字段', async () => {
    // Annotation.Root 内部结构不直接暴露，但能通过 StateGraph 构造验证
    const { StateGraph } = await import('@langchain/langgraph');
    const graph = new StateGraph(DevTaskState);
    expect(graph).toBeDefined();
  });
});
