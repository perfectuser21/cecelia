/**
 * T9: recordLearning Insight 任务 confidence 门槛 — CI 可跑的 mock 单测
 *
 * 背景：learning.test.js（真库集成）在 vitest.config.js exclude 列表中被 CI 断源，
 * confidence 门槛行为在 CI 里零覆盖。本文件用 mock pool + mock createTask 回填守卫，
 * 与集成测试两边并存。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockPool, mockCreateTask } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
  mockCreateTask: vi.fn(),
}));

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../actions.js', () => ({ createTask: mockCreateTask }));
vi.mock('../embedding-service.js', () => ({ generateLearningEmbeddingAsync: vi.fn() }));
vi.mock('../openai-client.js', () => ({ generateEmbedding: vi.fn() }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn() }));

import { recordLearning } from '../learning.js';

function buildAnalysis(confidence, tag) {
  return {
    task_id: '00000000-0000-4000-8000-0000000000a1',
    analysis: { root_cause: `gate-test root cause ${tag}`, contributing_factors: [] },
    recommended_actions: [],
    learnings: [`gate-test learning ${tag}`],
    confidence,
  };
}

describe('recordLearning — Insight 任务 confidence 门槛（CI mock 守卫）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 按 SQL 语义兜底返回：learnings INSERT 返回新行，memory_stream INSERT 返回 id，其余 SELECT/UPDATE 返回空
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO learnings')) {
        return { rows: [{ id: 'learning-gate-1', title: 'RCA Learning: gate-test' }] };
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO memory_stream')) {
        return { rows: [{ id: 'memory-gate-1' }] };
      }
      return { rows: [] };
    });
    mockCreateTask.mockResolvedValue({ id: 'task-gate-1' });
  });

  it('confidence < 0.7：落 learning（INSERT learnings 发生）但不建 [Insight修复] 任务', async () => {
    const learning = await recordLearning(buildAnalysis(0.5, 'low'));

    expect(learning).toBeDefined();
    const insertLearningCalls = mockPool.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO learnings')
    );
    expect(insertLearningCalls).toHaveLength(1);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('confidence >= 0.7：建 [Insight修复] 任务（createTask 被调用）', async () => {
    const learning = await recordLearning(buildAnalysis(0.8, 'high'));

    expect(learning).toBeDefined();
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    expect(mockCreateTask.mock.calls[0][0].title).toContain('[Insight修复]');
    expect(mockCreateTask.mock.calls[0][0].payload.insight_learning_id).toBe('learning-gate-1');
  });

  it('confidence 缺失：视为 0，不建任务', async () => {
    const analysis = buildAnalysis(undefined, 'none');
    delete analysis.confidence;
    await recordLearning(analysis);

    expect(mockCreateTask).not.toHaveBeenCalled();
  });
});
