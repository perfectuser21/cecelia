/**
 * lib/harness-thread-lookup.test.js — LangGraph 修正 Sprint Stream 5
 *
 * Stream 1 起步是 stub，Stream 5 真实化为 PG 查询。
 *
 * 这些断言守住"接口契约"（callback router 按此 mock）：
 *   - 返回 null 表示找不到（router 应 404）
 *   - 返回 { compiledGraph, threadId } 表示成功
 *   - 错误不抛（PG/compile 失败均 swallow → null）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';

// Mock db pool — 测试不能真连 PG
const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

// Mock pg-checkpointer — 用 MemorySaver 代替（compile graph 需要 checkpointer）
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue(new MemorySaver()),
}));

import { lookupHarnessThread } from '../harness-thread-lookup.js';
import { _resetCompiledForTests } from '../../workflows/walking-skeleton-1node.graph.js';

describe('lib/harness-thread-lookup (Stream 5 真实 PG 查询)', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    _resetCompiledForTests();
  });

  it('exports lookupHarnessThread 函数', () => {
    expect(typeof lookupHarnessThread).toBe('function');
  });

  it('未知 containerId — PG 返回空 → null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await lookupHarnessThread('any-container-id');
    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('空字符串 / undefined → 直接 null（不打 PG）', async () => {
    expect(await lookupHarnessThread('')).toBeNull();
    expect(await lookupHarnessThread(undefined)).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('walking-skeleton-1node graph 命中 → 返回 { compiledGraph, threadId }', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ thread_id: 'thread-xyz', graph_name: 'walking-skeleton-1node' }],
    });
    const result = await lookupHarnessThread('container-abc');
    expect(result).not.toBeNull();
    expect(result.threadId).toBe('thread-xyz');
    expect(result.compiledGraph).toBeDefined();
    expect(typeof result.compiledGraph.invoke).toBe('function');
  });

  it('B9: harness-evaluate graph 命中 → dispatch to compiledHarnessTask 同 thread_id', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ thread_id: 'harness-evaluate:init-1:ws1', graph_name: 'harness-evaluate' }],
    });
    const result = await lookupHarnessThread('harness-evaluate-ws1-r0-abc');
    expect(result).not.toBeNull();
    expect(result.threadId).toBe('harness-evaluate:init-1:ws1');
    expect(result.compiledGraph).toBeDefined();
    expect(typeof result.compiledGraph.invoke).toBe('function');
  });

  it('未知 graph_name → 返回 null（dispatch miss）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ thread_id: 'thread-xyz', graph_name: 'unknown-graph' }],
    });
    const result = await lookupHarnessThread('container-abc');
    expect(result).toBeNull();
  });

  it('PG 查询抛错 → 返回 null（不向上传播）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const result = await lookupHarnessThread('container-abc');
    expect(result).toBeNull();
  });
});
