/** 现役analyzeEvent的Memory query字段提取；旧HTTP helper测试已移除。 */
import { describe, it, expect, vi } from 'vitest';
import { extractMemoryQuery } from '../thalamus.js';

vi.mock('../llm-caller.js', () => ({ callLLM: () => { throw Error('external LLM forbidden'); } }));
vi.mock('../actions.js', () => ({ createTask: () => { throw Error('task write forbidden'); } }));
vi.mock('../memory-retriever.js', () => ({ buildMemoryContext: () => { throw Error('memory retrieval forbidden'); } }));
vi.mock('../embedding-service.js', () => ({ generateTaskEmbeddingAsync: () => { throw Error('embedding forbidden'); } }));

// Mock database pool
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: {
    query: (...args) => mockQuery(...args),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  }
}));

// Mock learning.js
vi.mock('../learning.js', () => ({
  searchRelevantLearnings: vi.fn().mockResolvedValue([]),
  getRecentLearnings: vi.fn().mockResolvedValue([]),
}));

describe('extractMemoryQuery', () => {
  it('应从 task.title 提取 query', () => {
    const event = { type: 'task_completed', task: { title: '实现登录功能', task_type: 'dev' } };
    expect(extractMemoryQuery(event)).toBe('实现登录功能');
  });

  it('应从 payload.title 提取 query（task.title 不存在时）', () => {
    const event = { type: 'task_completed', payload: { title: '数据库迁移' } };
    expect(extractMemoryQuery(event)).toBe('数据库迁移');
  });

  it('应从 payload.description 提取 query（title 不存在时）', () => {
    const event = { type: 'task_completed', payload: { description: '修复 bug' } };
    expect(extractMemoryQuery(event)).toBe('修复 bug');
  });

  it('应从 event.type 提取 query（所有 payload 字段都不存在时）', () => {
    const event = { type: 'tick' };
    expect(extractMemoryQuery(event)).toBe('tick');
  });

  it('event 为空时应返回空字符串', () => {
    expect(extractMemoryQuery({})).toBe('');
  });
});
