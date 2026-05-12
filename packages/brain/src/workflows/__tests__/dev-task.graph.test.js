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

// Mock writeDockerCallback — runAgentNode 必须在 spawn 返回后写 callback_queue
// 让下游 callback-worker → callback-processor 标 tasks.status，否则 task 永卡 in_progress
const mockWriteDockerCallback = vi.fn();
vi.mock('../../docker-executor.js', () => ({
  writeDockerCallback: (...args) => mockWriteDockerCallback(...args),
}));

import { buildDevTaskGraph, compileDevTaskGraph, runAgentNode, DevTaskState } from '../dev-task.graph.js';

describe('dev-task graph', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockPreparePrompt.mockReset();
    mockWriteDockerCallback.mockReset();
    mockWriteDockerCallback.mockResolvedValue(undefined);
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

  // ─── tasks.status 回写（Walking Skeleton P1 — 闭合 dev pipeline 0% 成功率 hole）─────────
  // 历史 hole：graph 跑完 spawn 后 result/error 只存在 state，tasks.status 无人回写。
  // dispatcher 是 fire-and-forget，spawn 完成后 task 永卡 in_progress 直到 zombie-reaper 30min 后标 failed。
  // 修：runAgentNode 在 spawn 返回 / throw 后必须调 writeDockerCallback，让 callback-worker
  // → callback-processor 走标准链路把 tasks.status 写完整（含 pr_url 提取 / failure_class 分类）。

  it('runAgentNode spawn 成功 → 调 writeDockerCallback 入队 callback_queue (status=success)', async () => {
    mockPreparePrompt.mockResolvedValueOnce('/dev\n\nPRD');
    const spawnResult = { exit_code: 0, stdout: '{"type":"result","result":"pr_url: https://x/y/pull/1"}', stderr: '', timed_out: false, duration_ms: 1000 };
    mockSpawn.mockResolvedValueOnce(spawnResult);
    const state = { task: { id: '11111111-1111-1111-1111-111111111111', task_type: 'dev', description: 'PRD' } };

    await runAgentNode(state);

    expect(mockWriteDockerCallback).toHaveBeenCalledTimes(1);
    const [task, runId, checkpointId, result] = mockWriteDockerCallback.mock.calls[0];
    expect(task.id).toBe(state.task.id);
    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);
    expect(checkpointId).toBeNull();
    expect(result).toEqual(spawnResult);
  });

  it('runAgentNode spawn 非零退出 → writeDockerCallback 透传 exit_code（status=failed 由 callback 决定）', async () => {
    mockPreparePrompt.mockResolvedValueOnce('/dev\n\nPRD');
    const spawnResult = { exit_code: 1, stdout: '', stderr: 'boom', timed_out: false, duration_ms: 500 };
    mockSpawn.mockResolvedValueOnce(spawnResult);
    const state = { task: { id: '22222222-2222-2222-2222-222222222222', task_type: 'dev' } };

    await runAgentNode(state);

    expect(mockWriteDockerCallback).toHaveBeenCalledTimes(1);
    expect(mockWriteDockerCallback.mock.calls[0][3]).toEqual(spawnResult);
  });

  it('runAgentNode spawn throw → 构造合成 result 调 writeDockerCallback (exit_code=1 + stderr=err.message)', async () => {
    mockPreparePrompt.mockResolvedValueOnce('/dev\n\nPRD');
    mockSpawn.mockRejectedValueOnce(new Error('docker daemon unreachable'));
    const state = { task: { id: '33333333-3333-3333-3333-333333333333', task_type: 'dev' } };

    const delta = await runAgentNode(state);

    expect(mockWriteDockerCallback).toHaveBeenCalledTimes(1);
    const [, , , synthResult] = mockWriteDockerCallback.mock.calls[0];
    expect(synthResult.exit_code).not.toBe(0);
    expect(synthResult.stderr || synthResult.stdout || '').toMatch(/docker daemon unreachable/);
    expect(synthResult.timed_out).toBe(false);
    // delta 仍要返回 error 让 graph state 可见
    expect(delta.error?.message).toBe('docker daemon unreachable');
  });

  it('runAgentNode writeDockerCallback 抛错不阻断 — 只 warn 不重抛', async () => {
    mockPreparePrompt.mockResolvedValueOnce('/dev\n\nPRD');
    mockSpawn.mockResolvedValueOnce({ exit_code: 0 });
    mockWriteDockerCallback.mockRejectedValueOnce(new Error('callback_queue INSERT failed'));
    const state = { task: { id: '44444444-4444-4444-4444-444444444444', task_type: 'dev' } };

    // 不应 throw — 即使 writeback 失败也要让 graph 正常结束
    const delta = await runAgentNode(state);
    expect(delta.result).toBeDefined();
  });

  it('runAgentNode state.task 无 id → skip writeDockerCallback（防御性，不应崩）', async () => {
    mockPreparePrompt.mockResolvedValueOnce('/dev\n\nPRD');
    mockSpawn.mockResolvedValueOnce({ exit_code: 0 });
    const state = { task: { description: 'no id task' } };

    await runAgentNode(state);
    expect(mockWriteDockerCallback).not.toHaveBeenCalled();
  });
});
