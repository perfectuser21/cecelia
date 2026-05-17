/**
 * rumination-memory-stream.test.js — Rumination 质量改进测试
 *
 * 验收标准：
 * 1. fetchMemoryStreamItems 读取高显著性对话条目（salience_score ≥ 0.7）
 * 2. runRumination 在 learnings 不足时补充 memory_stream 条目
 * 3. buildNotebookQuery 含 emotion_tag 上下文
 * 4. 消化后 memory_stream 条目 status 更新为 'ruminated'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../similarity.js', () => ({
  default: class {
    searchWithVectors() { return { matches: [] }; }
  },
}));

vi.mock('../learning.js', () => ({
  searchRelevantLearnings: vi.fn().mockResolvedValue([]),
}));

vi.mock('../user-profile.js', () => ({
  loadUserProfile: vi.fn().mockResolvedValue(null),
  formatProfileSnippet: vi.fn().mockReturnValue(''),
}));

vi.mock('../notebook-adapter.js', () => ({
  queryNotebook: vi.fn().mockResolvedValue({ ok: false, text: '' }),
  addTextSource: vi.fn().mockResolvedValue({}),
}));

vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({ text: '[反刍洞察] 测试洞察内容' }),
}));

vi.mock('../self-model.js', () => ({
  updateSelfModel: vi.fn().mockResolvedValue({}),
}));

vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({}),
  EVENT_TYPES: { RUMINATION_RESULT: 'RUMINATION_RESULT' },
}));

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { buildNotebookQuery, fetchMemoryStreamItems, _resetState } from '../rumination.js';

beforeEach(() => {
  _resetState();
});

// ── buildNotebookQuery with emotion_tag ─────────────────────

describe('buildNotebookQuery', () => {
  it('不含 emotion_tag 时正常构建查询', () => {
    const items = [
      { title: '今日学习', category: 'dev' },
      { title: '用户反馈', category: 'product' },
    ];
    const query = buildNotebookQuery(items);
    expect(query).toContain('今日学习');
    expect(query).toContain('dev');
  });

  it('含 emotion_tag 时查询包含情绪上下文', () => {
    const items = [
      { title: '会议讨论', category: 'work', emotion_tag: 'anxious' },
      { title: '项目进展', category: 'dev', emotion_tag: 'excited' },
    ];
    const query = buildNotebookQuery(items);
    expect(query).toContain('anxious');
    expect(query).toContain('excited');
  });

  it('部分含 emotion_tag 时只显示有值的', () => {
    const items = [
      { title: '普通记录', category: 'misc' },
      { title: '情绪对话', category: 'chat', emotion_tag: 'calm' },
    ];
    const query = buildNotebookQuery(items);
    expect(query).toContain('calm');
  });
});

// ── fetchMemoryStreamItems ────────────────────────────────────

describe('fetchMemoryStreamItems', () => {
  it('从 memory_stream 获取高显著性对话条目', async () => {
    const mockRows = [
      { id: 'ms-1', content: '重要对话内容', salience_score: 0.8, emotion_tag: 'focused', source_type: 'conversation_turn' },
      { id: 'ms-2', content: '另一条对话', salience_score: 0.75, emotion_tag: null, source_type: 'conversation_turn' },
    ];
    const mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('memory_stream')) {
          return Promise.resolve({ rows: mockRows });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const items = await fetchMemoryStreamItems(mockPool, 3);
    expect(items.length).toBe(2);
    expect(items[0].source).toBe('memory_stream');
  });

  it('SQL 查询包含 salience_score 过滤和 conversation_turn 条件', async () => {
    const querySpy = vi.fn().mockResolvedValue({ rows: [] });
    const mockPool = { query: querySpy };

    await fetchMemoryStreamItems(mockPool, 3);

    const calledSql = querySpy.mock.calls[0]?.[0] || '';
    expect(calledSql).toContain('memory_stream');
    expect(calledSql).toContain('conversation_turn');
    expect(calledSql).toMatch(/salience_score|0\.7/);
  });

  it('返回条目标记 source=memory_stream', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'ms-3', content: '测试', salience_score: 0.9, emotion_tag: 'happy' }],
      }),
    };

    const items = await fetchMemoryStreamItems(mockPool, 2);
    if (items.length > 0) {
      expect(items[0].source).toBe('memory_stream');
    }
  });
});
