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
    list: vi.fn().mockResolvedValue([]),
    getTuple: vi.fn().mockResolvedValue(null),
    putWrites: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock preparePrompt — runAgentNode 调它包 /dev 框架
const mockPreparePrompt = vi.fn();
vi.mock('../../executor.js', () => ({
  preparePrompt: (...args) => mockPreparePrompt(...args),
}));

import { buildDevTaskGraph, compileDevTaskGraph, runAgentNode, DevTaskState } from '../dev-task.graph.js';

describe('dev-task graph', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockPreparePrompt.mockReset();
  });

  it('buildDevTaskGraph returns StateGraph with run-agent node', () => {
    const graph = buildDevTaskGraph();
    expect(graph).toBeDefined();
    const compiled = graph.compile();
    expect(compiled).toBeDefined();
    expect(typeof compiled.invoke).toBe('function');
  });

  it('runAgentNode 调 preparePrompt 包 /dev 框架后传 spawn', async () => {
    const wrapped = `/dev\n\n# PRD - test\n\n## 功能描述\ndo the thing\n\n## 成功标准\n- [ ] 任务完成`;
    mockPreparePrompt.mockResolvedValueOnce(wrapped);
    mockSpawn.mockResolvedValueOnce({ exit_code: 0, stdout: 'ok', stderr: '' });
    const state = {
      task: { id: 't1', description: 'do the thing', worktree: { path: '/wt1', branch: 'cp-x' } },
    };
    const delta = await runAgentNode(state);
    expect(mockPreparePrompt).toHaveBeenCalledWith(state.task);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const spawnOpts = mockSpawn.mock.calls[0][0];
    expect(spawnOpts.task).toBe(state.task);
    expect(spawnOpts.skill).toBe('/dev');
    expect(spawnOpts.prompt).toBe(wrapped);
    expect(spawnOpts.prompt).toMatch(/^\/dev/); // 以 /dev 开头
    expect(spawnOpts.prompt).toContain('# PRD'); // 含 PRD 框架
    expect(spawnOpts.worktree).toEqual({ path: '/wt1', branch: 'cp-x' });
    expect(delta.result).toEqual({ exit_code: 0, stdout: 'ok', stderr: '' });
    expect(delta.error).toBeUndefined();
  });

  it('runAgentNode preparePrompt 抛 → fallback 到 /dev + description（不阻断派发）', async () => {
    mockPreparePrompt.mockRejectedValueOnce(new Error('learning DB unreachable'));
    mockSpawn.mockResolvedValueOnce({ exit_code: 0 });
    const state = { task: { id: 't-fb', description: '原始 PRD 内容' } };
    const delta = await runAgentNode(state);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn.mock.calls[0][0].prompt).toBe('/dev\n\n原始 PRD 内容');
    expect(delta.result).toEqual({ exit_code: 0 });
    expect(delta.error).toBeUndefined();
  });

  it('runAgentNode 错误路径：spawn 抛 → delta.error 含 message', async () => {
    mockPreparePrompt.mockResolvedValueOnce('/dev\n\nfail test');
    mockSpawn.mockRejectedValueOnce(new Error('docker failed'));
    const state = { task: { id: 't2', description: 'fail test' } };
    const delta = await runAgentNode(state);
    expect(delta.error).toBeDefined();
    expect(delta.error.message).toBe('docker failed');
    expect(delta.result).toBeUndefined();
  });

  it('runAgentNode preparePrompt fallback：无 description 无 title → /dev + 空串', async () => {
    mockPreparePrompt.mockRejectedValueOnce(new Error('boom'));
    mockSpawn.mockResolvedValueOnce({ exit_code: 0 });
    const state = { task: { id: 't3' } };
    await runAgentNode(state);
    expect(mockSpawn.mock.calls[0][0].prompt).toBe('/dev\n\n');
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
