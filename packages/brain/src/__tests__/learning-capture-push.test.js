import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => queryMock(...a) } }));
vi.mock('../embedding-service.js', () => ({ generateLearningEmbeddingAsync: vi.fn() }));
vi.mock('../openai-client.js', () => ({ generateEmbedding: vi.fn() }));
vi.mock('../actions.js', () => ({ createTask: vi.fn().mockResolvedValue({}) }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn() }));
vi.mock('../memory-utils.js', () => ({ generateL0Summary: () => 'L0摘要' }));

const pushMock = vi.fn().mockResolvedValue('atom-1');
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: (...a) => pushMock(...a) }));

import { recordLearning } from '../learning.js';

describe('recordLearning → capture_atoms 推送（T10）', () => {
  beforeEach(() => { queryMock.mockReset(); pushMock.mockClear(); });

  it('新 learning 落库成功后推送 atom（subtype=category，来源指向 learnings/id）', async () => {
    queryMock.mockImplementation(async (sql) => {
      if (/SELECT id, version FROM learnings/.test(sql)) return { rows: [] };
      if (/INSERT INTO learnings/.test(sql)) return { rows: [{ id: 'learn-1', category: 'failure_pattern', title: 'RCA Learning: 根因', summary: 'L0摘要' }] };
      if (/INSERT INTO memory_stream/.test(sql)) return { rows: [{ id: 'mem-1' }] };
      return { rows: [] };
    });
    await recordLearning({ task_id: 't-1', analysis: { root_cause: '根因' }, learnings: [], recommended_actions: [], confidence: 0.5 });
    expect(pushMock).toHaveBeenCalledTimes(1);
    const [, fields] = pushMock.mock.calls[0];
    expect(fields.targetType).toBe('learning');
    expect(fields.targetSubtype).toBe('failure_pattern');
    expect(fields.routedToTable).toBe('learnings');
    expect(fields.routedToId).toBe('learn-1');
  });

  it('去重命中（已有同 hash）→ 不推送', async () => {
    queryMock.mockImplementation(async (sql) => {
      if (/SELECT id, version FROM learnings/.test(sql)) return { rows: [{ id: 'old-1', version: 1 }] };
      return { rows: [] };
    });
    await recordLearning({ task_id: 't-1', analysis: { root_cause: '根因' }, learnings: [], recommended_actions: [] });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
