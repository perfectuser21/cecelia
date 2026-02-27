/**
 * Tests for L1 middle layer in searchEpisodicMemory
 *
 * 覆盖：
 * L1-1: 向量路径有 l1_content 时 description 使用 l1_content
 * L1-2: 向量路径无 l1_content 时 description 降级到 content.slice(0,200)
 * L1-3: Jaccard 降级路径有 l1_content 时 description 使用 l1_content
 * L1-4: Jaccard 降级路径无 l1_content 时 description 降级到 content.slice(0,200)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchEpisodicMemory } from '../memory-retriever.js';

// Mock openai-client.js（向量搜索）
vi.mock('../openai-client.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
}));

// Mock memory-utils.js generateL0Summary（避免引入副作用）
vi.mock('../memory-utils.js', () => ({
  generateL0Summary: (content) => (content || '').slice(0, 100),
  generateMemoryStreamL1Async: vi.fn(),
}));

const mockQuery = vi.fn();
const mockPool = { query: mockQuery };

beforeEach(() => {
  vi.clearAllMocks();
  // 默认有 OPENAI_API_KEY（走向量路径）
  process.env.OPENAI_API_KEY = 'sk-test-key';
});

describe('L1 middle layer - vector path', () => {
  it('L1-1: 有 l1_content 时 description 使用 l1_content', async () => {
    const l1 = '**核心事实**：记忆有 L1 层\n**背景场景**：测试场景\n**关键判断**：结构化摘要有用\n**相关实体**：memory-retriever';
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 1,
        content: '这是一段很长的记忆内容，超过200字会被截断，但 l1_content 应该优先使用。',
        summary: '摘要',
        l1_content: l1,
        importance: 7,
        memory_type: 'long',
        created_at: new Date(),
        vector_score: 0.85,
      }],
    });

    const results = await searchEpisodicMemory(mockPool, '记忆 L1 层');
    expect(results).toHaveLength(1);
    expect(results[0].description).toBe(l1);
    expect(results[0].text).toBe('这是一段很长的记忆内容，超过200字会被截断，但 l1_content 应该优先使用。');
  });

  it('L1-2: 无 l1_content 时 description 降级到 content.slice(0,200)', async () => {
    const longContent = 'X'.repeat(500);
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 2,
        content: longContent,
        summary: '摘要',
        l1_content: null,
        importance: 5,
        memory_type: 'short',
        created_at: new Date(),
        vector_score: 0.72,
      }],
    });

    const results = await searchEpisodicMemory(mockPool, '测试降级');
    expect(results).toHaveLength(1);
    expect(results[0].description).toBe(longContent.slice(0, 200));
    expect(results[0].text).toBe(longContent);
  });

  it('L1-3: 向量搜索 LIMIT 参数为 20', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await searchEpisodicMemory(mockPool, '测试 limit');

    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('LIMIT 20');
  });
});

describe('L1 middle layer - Jaccard fallback path', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('L1-3: Jaccard 路径有 l1_content 时 description 使用 l1_content', async () => {
    const l1 = '**核心事实**：Jaccard 路径也支持 L1\n**相关实体**：memory-retriever';
    const content = 'Jaccard 测试 记忆 内容';
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 3,
        content,
        summary: 'Jaccard 摘要',
        l1_content: l1,
        importance: 6,
        memory_type: 'short',
        created_at: new Date(),
      }],
    });

    const results = await searchEpisodicMemory(mockPool, 'Jaccard 记忆');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].description).toBe(l1);
    expect(results[0].text).toBe(content);
  });

  it('L1-4: Jaccard 路径无 l1_content 时 description 降级到 content.slice(0,200)', async () => {
    const longContent = 'Y'.repeat(500);
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 4,
        content: longContent,
        summary: 'Y 的摘要',
        l1_content: null,
        importance: 4,
        memory_type: 'short',
        created_at: new Date(),
      }],
    });

    const results = await searchEpisodicMemory(mockPool, 'Y'.repeat(10));
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].description).toBe(longContent.slice(0, 200));
  });
});
