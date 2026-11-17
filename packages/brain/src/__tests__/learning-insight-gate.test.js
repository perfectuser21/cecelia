/** RCA学习只落学习与记忆，不再按置信度自动生成开发单。 */

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

describe('recordLearning — 自主修复退役', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 按 SQL 语义兜底返回：learnings INSERT 返回新行，memory_stream INSERT 返回 id，其余 SELECT/UPDATE 返回空
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO learnings')) {
        return { rows: [{ id: 'learning-gate-1', title: 'RCA Learning: gate-test' }] };
      }
      if (typeof sql === 'string' && sql.includes('SELECT payload FROM tasks WHERE id')) {
        return { rows: [{ payload: { repo: 'cecelia', map_scope: ['F1'] } }] };
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO memory_stream')) {
        return { rows: [{ id: 'memory-gate-1' }] };
      }
      return { rows: [] };
    });
    mockCreateTask.mockResolvedValue({ success: true, task: { id: 'task-gate-1', payload: { insight_learning_id: 'learning-gate-1', repo: 'cecelia', map_scope: ['F1'] } } });
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

  it('高置信且完整仓库范围：保留 learning、记忆与 embedding，不衍生开发单', async () => {
    const learning = await recordLearning(buildAnalysis(0.99, 'high'));
    expect(learning.id).toBe('learning-gate-1');
    expect(learning.source_memory_id).toBe('memory-gate-1');
    expect(mockPool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO learnings'))).toBe(true);
    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(mockPool.query.mock.calls.some(([sql]) => sql.includes('applied = true'))).toBe(false);
  });

  it('confidence 缺失：视为 0，不建任务', async () => {
    const analysis = buildAnalysis(undefined, 'none');
    delete analysis.confidence;
    await recordLearning(analysis);

    expect(mockCreateTask).not.toHaveBeenCalled();
  });
});
