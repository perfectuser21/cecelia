/**
 * memory-closure-chain.test.js
 *
 * 测试 memory_stream → learning → task 三段闭环链条
 * MC-3: recordLearning 写 source_memory_id
 * MC-4: resolveRelatedFailureMemories 回写 resolved
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock pool ───────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockPool = { query: mockQuery };

// ─── Mock deps ───────────────────────────────────────────────────────────────

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../memory-utils.js', () => ({ generateL0Summary: (s) => s.slice(0, 50) }));
vi.mock('../embedding-service.js', () => ({ generateLearningEmbeddingAsync: vi.fn() }));

// ─── Test: resolveRelatedFailureMemories ────────────────────────────────────

describe('resolveRelatedFailureMemories (MC-4)', () => {
  let resolveRelatedFailureMemories;

  beforeEach(async () => {
    vi.resetAllMocks();
    const mod = await import('../routes.js');
    resolveRelatedFailureMemories = mod.resolveRelatedFailureMemories;
  });

  it('MC-4-1: task 不存在时提前退出，不抛出错误', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // task not found
    await expect(resolveRelatedFailureMemories('no-task', mockPool)).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('MC-4-2: 找不到匹配的 failure learning 时，不更新 memory_stream', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ title: '修复 CI 路径错误' }] }) // task title
      .mockResolvedValueOnce({ rows: [] }); // no matching learnings

    await resolveRelatedFailureMemories('task-123', mockPool);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    // 第三次（UPDATE）不应被调用
  });

  it('MC-4-3: 找到匹配 learning，UPDATE memory_stream status=resolved', async () => {
    const memId = 'mem-aaa';
    mockQuery
      .mockResolvedValueOnce({ rows: [{ title: 'fix brain CI path error' }] }) // task title
      .mockResolvedValueOnce({ rows: [{ id: 'learning-1', source_memory_id: memId }] }) // matched learnings
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE memory_stream

    await resolveRelatedFailureMemories('task-fix-123', mockPool);

    // 最后一次调用应是 UPDATE memory_stream
    const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
    expect(lastCall[0]).toContain('UPDATE memory_stream');
    expect(lastCall[0]).toContain("status = 'resolved'");
    expect(lastCall[1]).toContain(memId);
  });

  it('MC-4-4: 关键词过短（全是停用词）时，不查询 learnings', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ title: 'fix the a an' }] }); // all stop words
    await resolveRelatedFailureMemories('task-999', mockPool);
    expect(mockQuery).toHaveBeenCalledTimes(1); // 只查了 task，没查 learnings
  });

  it('MC-4-5: 多个 memory 都被标记 resolved', async () => {
    const memIds = ['mem-1', 'mem-2'];
    mockQuery
      .mockResolvedValueOnce({ rows: [{ title: 'fix watchdog memory leak' }] })
      .mockResolvedValueOnce({ rows: [
        { id: 'l-1', source_memory_id: memIds[0] },
        { id: 'l-2', source_memory_id: memIds[1] },
      ]})
      .mockResolvedValueOnce({ rowCount: 2 });

    await resolveRelatedFailureMemories('task-multi', mockPool);

    const updateCall = mockQuery.mock.calls[2];
    expect(updateCall[0]).toContain('UPDATE memory_stream');
    expect(updateCall[1]).toContain(memIds[0]);
    expect(updateCall[1]).toContain(memIds[1]);
  });
});

// ─── Test: recordLearning closure chain (MC-3) ──────────────────────────────

describe('recordLearning closure chain (MC-3)', () => {
  it('MC-3-1: 新 learning 写入后，同步写 memory_stream 并更新 source_memory_id', async () => {
    vi.resetAllMocks();

    const learningId = 'learn-abc';
    const memId = 'mem-xyz';

    // pool.query mock sequence (used by recordLearning via db.js default)
    mockQuery
      .mockResolvedValueOnce({ rows: [] })           // 去重检查：无重复
      .mockResolvedValueOnce({ rows: [{ id: learningId, version: 1 }] }) // INSERT learnings
      .mockResolvedValueOnce({ rows: [{ id: memId }] }) // INSERT memory_stream
      .mockResolvedValueOnce({ rowCount: 1 });        // UPDATE learnings SET source_memory_id

    const { recordLearning } = await import('../learning.js');

    const result = await recordLearning({
      task_id: 'task-rca-1',
      analysis: { root_cause: 'watchdog killed process due to memory leak' },
      learnings: ['increase memory limit'],
      recommended_actions: [],
      confidence: 0.9,
    });

    // source_memory_id 应被设置
    expect(result.source_memory_id).toBe(memId);

    // 确认 INSERT memory_stream 被调用
    const insertMemCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO memory_stream')
    );
    expect(insertMemCall).toBeDefined();
    expect(insertMemCall[0]).toContain("source_type, status");

    // 确认 UPDATE learnings SET source_memory_id 被调用
    const updateCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE learnings SET source_memory_id')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toContain(memId);
    expect(updateCall[1]).toContain(learningId);
  });

  it('MC-3-2: memory_stream 写入失败时，recordLearning 仍然返回 learning（非阻塞）', async () => {
    vi.resetAllMocks();

    const learningId = 'learn-def';

    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: learningId, version: 1 }] }) // INSERT learnings OK
      .mockRejectedValueOnce(new Error('DB connection lost')); // INSERT memory_stream FAILS

    const { recordLearning } = await import('../learning.js');

    const result = await recordLearning({
      task_id: 'task-rca-2',
      analysis: { root_cause: 'test error' },
      learnings: [],
      recommended_actions: [],
    });

    // learning 仍然返回，不抛出错误
    expect(result.id).toBe(learningId);
  });
});
