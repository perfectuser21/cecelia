/**
 * Brain v2 Phase C1: graph-runtime 单元测试。
 *
 * 覆盖：
 *   1. thread_id 格式正确（"${taskId}:${attemptN}"）
 *   2. 非法参数 throws（空 workflowName / 空 taskId / attemptN 非正整数）
 *   3. 未注册 workflow 抛 'workflow not found'
 *   4. 有 checkpoint → resume（传 null input）；无 checkpoint → fresh（传 input）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @langchain/langgraph-checkpoint-postgres 避免真连 pg
let mockCheckpointState = null; // default: no checkpoint
const mockPostgresSaverGet = vi.fn();
const mockPostgresSaverSetup = vi.fn().mockResolvedValue(undefined);

vi.mock('@langchain/langgraph-checkpoint-postgres', () => ({
  PostgresSaver: {
    fromConnString: () => ({
      get: (...args) => mockPostgresSaverGet(...args),
      setup: () => mockPostgresSaverSetup(),
    }),
  },
}));

import { runWorkflow } from '../graph-runtime.js';
import {
  registerWorkflow,
  _clearRegistryForTests,
} from '../workflow-registry.js';
import { _resetPgCheckpointerForTests } from '../pg-checkpointer.js';

function makeStubGraph() {
  const invoke = vi.fn().mockResolvedValue({ ok: true });
  return { invoke, graph: { invoke } };
}

describe('runWorkflow()', () => {
  beforeEach(() => {
    _clearRegistryForTests();
    _resetPgCheckpointerForTests();
    mockPostgresSaverGet.mockReset();
    mockPostgresSaverSetup.mockClear();
    mockCheckpointState = null;
    mockPostgresSaverGet.mockImplementation(async () => mockCheckpointState);
  });

  it('case 1: thread_id 格式为 {taskId}:{attemptN}', async () => {
    const { invoke, graph } = makeStubGraph();
    registerWorkflow('demo', graph);
    await runWorkflow('demo', 'abc-123', 2, { hello: 'world' });
    // invoke 第 2 参数 config 必须含正确 thread_id
    const callArgs = invoke.mock.calls[0];
    expect(callArgs[1]).toEqual({ configurable: { thread_id: 'abc-123:2' } });
  });

  it('case 2a: 空 workflowName throws TypeError', async () => {
    await expect(runWorkflow('', 'abc', 1, null)).rejects.toThrow(TypeError);
    await expect(runWorkflow(null, 'abc', 1, null)).rejects.toThrow(TypeError);
  });

  it('case 2b: 空 taskId throws TypeError', async () => {
    const { graph } = makeStubGraph();
    registerWorkflow('demo', graph);
    await expect(runWorkflow('demo', '', 1, null)).rejects.toThrow(TypeError);
    await expect(runWorkflow('demo', null, 1, null)).rejects.toThrow(TypeError);
  });

  it('case 2c: attemptN 非正整数 throws TypeError', async () => {
    const { graph } = makeStubGraph();
    registerWorkflow('demo', graph);
    await expect(runWorkflow('demo', 'abc', 0, null)).rejects.toThrow(TypeError);
    await expect(runWorkflow('demo', 'abc', -1, null)).rejects.toThrow(TypeError);
    await expect(runWorkflow('demo', 'abc', 1.5, null)).rejects.toThrow(TypeError);
    await expect(runWorkflow('demo', 'abc', '2', null)).rejects.toThrow(TypeError);
  });

  it('case 3: 未注册 workflow 抛 "workflow not found"', async () => {
    await expect(runWorkflow('nonexistent', 'abc', 1, null)).rejects.toThrow(/workflow not found: nonexistent/);
  });

  it('case 4a: 无 checkpoint → graph.invoke 收到传入的 input（fresh start）', async () => {
    const { invoke, graph } = makeStubGraph();
    registerWorkflow('demo', graph);
    mockCheckpointState = null; // no checkpoint
    const inputObj = { seed: 'fresh' };
    await runWorkflow('demo', 'abc', 1, inputObj);
    expect(invoke.mock.calls[0][0]).toBe(inputObj); // identity check: 原样传
  });

  it('case 4b: 有 checkpoint → graph.invoke 收到 null（resume）', async () => {
    const { invoke, graph } = makeStubGraph();
    registerWorkflow('demo', graph);
    mockCheckpointState = { some: 'saved', state: 42 }; // has checkpoint
    await runWorkflow('demo', 'abc', 3, { ignored: 'yes' });
    expect(invoke.mock.calls[0][0]).toBeNull();
  });

  it('case 5: retry 递增 attemptN → 新 thread_id', async () => {
    const { invoke, graph } = makeStubGraph();
    registerWorkflow('demo', graph);
    await runWorkflow('demo', 'abc', 1, {});
    await runWorkflow('demo', 'abc', 2, {});
    expect(invoke.mock.calls[0][1].configurable.thread_id).toBe('abc:1');
    expect(invoke.mock.calls[1][1].configurable.thread_id).toBe('abc:2');
  });
});
