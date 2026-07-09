/**
 * 刀4阶段3收尾 — harness-thread-lookup.js 覆盖回补
 *
 * 原测试文件（B44）只测已废弃的 harness-initiative graph_name 分支，随死图一并删除
 * （见 2026-07-09 commit 8d7dd799f）。但 harness-thread-lookup.js 本体仍是活代码
 * （walking-skeleton-1node 分支仍被 dispatch 用），删测试不能连活代码覆盖一起删——
 * lint-test-pairing CI 门禁正确拦下了这个空洞，本文件补回对当前实现的覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockGetPgCheckpointer = vi.fn();
const mockGetCompiledWalkingSkeleton = vi.fn();

vi.mock('../../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: () => mockGetPgCheckpointer(),
}));
vi.mock('../../workflows/walking-skeleton-1node.graph.js', () => ({
  getCompiledWalkingSkeleton: (checkpointer) => mockGetCompiledWalkingSkeleton(checkpointer),
}));

import { lookupHarnessThread, updateHarnessThreadStatus } from '../harness-thread-lookup.js';

describe('lookupHarnessThread [BEHAVIOR]', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetPgCheckpointer.mockReset();
    mockGetCompiledWalkingSkeleton.mockReset();
  });

  it('containerId 为空 → 直接返回 null，不查库', async () => {
    const result = await lookupHarnessThread(null);
    expect(result).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('查无此 containerId → 返回 null', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await lookupHarnessThread('container-missing');
    expect(result).toBeNull();
  });

  it('查库失败（PG 异常）→ 捕获并返回 null，不抛出', async () => {
    mockQuery.mockRejectedValue(new Error('connection refused'));
    const result = await lookupHarnessThread('container-x');
    expect(result).toBeNull();
  });

  it('graph_name=walking-skeleton-1node → 编译并返回 {compiledGraph, threadId}（唯一仍活跃分支）', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ thread_id: 'thread-ws-1', graph_name: 'walking-skeleton-1node' }],
    });
    const fakeCheckpointer = { id: 'checkpointer' };
    const fakeCompiledGraph = { invoke: vi.fn() };
    mockGetPgCheckpointer.mockResolvedValue(fakeCheckpointer);
    mockGetCompiledWalkingSkeleton.mockResolvedValue(fakeCompiledGraph);

    const result = await lookupHarnessThread('container-ws');

    expect(result).toEqual({ compiledGraph: fakeCompiledGraph, threadId: 'thread-ws-1' });
    expect(mockGetCompiledWalkingSkeleton).toHaveBeenCalledWith(fakeCheckpointer);
  });

  it('walking-skeleton 编译失败 → 捕获并返回 null', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ thread_id: 'thread-ws-2', graph_name: 'walking-skeleton-1node' }],
    });
    mockGetPgCheckpointer.mockResolvedValue({});
    mockGetCompiledWalkingSkeleton.mockRejectedValue(new Error('compile boom'));

    const result = await lookupHarnessThread('container-ws-fail');
    expect(result).toBeNull();
  });

  it('未知 graph_name（含已删除的 harness-task/harness-initiative）→ 返回 null，不尝试 dispatch', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ thread_id: 'thread-old', graph_name: 'harness-initiative' }],
    });

    const result = await lookupHarnessThread('container-legacy');

    expect(result).toBeNull();
    expect(mockGetCompiledWalkingSkeleton).not.toHaveBeenCalled();
  });
});

describe('updateHarnessThreadStatus [BEHAVIOR]', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('更新 walking_skeleton_thread_lookup 的 status 字段', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await updateHarnessThreadStatus('container-1', 'completed');

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE walking_skeleton_thread_lookup'),
      ['container-1', 'completed']
    );
  });
});
