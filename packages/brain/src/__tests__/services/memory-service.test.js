/**
 * Memory Service Unit Tests
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
let pool;
let MemoryService;
let SimilarityService;

// Mock SimilarityService
vi.mock('../../similarity.js', () => ({ default: vi.fn() }));

beforeAll(async () => {
  vi.resetModules();
  pool = { query: vi.fn() };
  MemoryService = (await import('../../services/memory-service.js')).default;
  SimilarityService = (await import('../../similarity.js')).default;
});

describe('MemoryService', () => {
  let service;
  let mockSimilarity;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    pool.query.mockReset().mockResolvedValue({ rows: [] });

    // Create mock similarity instance
    mockSimilarity = {
      searchWithVectors: vi.fn()
    };

    // Mock SimilarityService constructor
    SimilarityService.mockImplementation(() => mockSimilarity);

    // Create service instance
    service = new MemoryService(pool);
  });

  describe('search', () => {
    it('返回 summary 格式（id, level, title, similarity, preview）', async () => {
      // Arrange
      const mockResults = {
        matches: [
          {
            id: 'abc-123',
            level: 'task',
            title: 'feat(auth): cross-subdomain cookie auth',
            score: 0.32,
            description: '## Summary\n- 用 cookie 替代 localStorage'
          }
        ]
      };

      mockSimilarity.searchWithVectors.mockResolvedValue(mockResults);

      // Act
      const result = await service.search('用户登录', { topK: 5, mode: 'summary' });

      // Assert
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]).toHaveProperty('id', 'abc-123');
      expect(result.matches[0]).toHaveProperty('level', 'task');
      expect(result.matches[0]).toHaveProperty('title');
      expect(result.matches[0]).toHaveProperty('similarity', 0.32);
      expect(result.matches[0]).toHaveProperty('preview');
      expect(result.matches[0].preview).toContain('cookie');
    });

    it('返回 full 格式（完整信息）', async () => {
      // Arrange
      const mockResults = {
        matches: [
          {
            id: 'abc-123',
            level: 'task',
            title: 'Test',
            score: 0.8,
            description: 'Full description'
          }
        ]
      };

      mockSimilarity.searchWithVectors.mockResolvedValue(mockResults);

      // Act
      const result = await service.search('test', { mode: 'full' });

      // Assert
      expect(result).toEqual(mockResults);
    });

    it('正确调用 similarity.searchWithVectors', async () => {
      // Arrange
      mockSimilarity.searchWithVectors.mockResolvedValue({ matches: [] });

      // Act
      await service.search('test query', { topK: 10 });

      // Assert
      expect(mockSimilarity.searchWithVectors).toHaveBeenCalledWith('test query', { topK: 10 });
    });
  });

  describe('getDetail', () => {
    it('从 tasks 表查询并返回完整信息', async () => {
      const row = { id: 'task-1', level: 'task', title: '真实详情', description: '详情',
        status: 'completed', metadata: null, created_at: '2026-01-01' };
      pool.query.mockResolvedValueOnce({ rows: [row] });
      expect(await service.getDetail('task-1')).toEqual({ ...row, metadata: {} });
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query.mock.calls[0][1]).toEqual(['task-1']);
    });

    it('Entity not found 时抛出错误', async () => {
      // Act & Assert
      await expect(service.getDetail('00000000-0000-0000-0000-000000000000'))
        .rejects.toThrow('Entity not found');
    });
  });

  describe('searchRelated', () => {
    it('正确排除 base_id 自身', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'base', level: 'task', title: '基准' }] });
      mockSimilarity.searchWithVectors.mockResolvedValue({ matches: [
        { id: 'base', title: '基准', score: 1 },
        { id: 'other', title: '相关', score: 0.8, description: '**内容**' },
        { id: 'extra', title: '额外', score: 0.5 },
      ] });
      const result = await service.searchRelated('base', { topK: 1 });
      expect(result.matches).toEqual([{ id: 'other', title: '相关', level: undefined,
        similarity: 0.8, preview: '内容' }]);
      expect(mockSimilarity.searchWithVectors).toHaveBeenCalledWith('基准', { topK: 2 });
    });
  });

  describe('_generatePreview', () => {
    it('生成正确的预览文本（前 100 字符）', () => {
      // Act
      const preview = service._generatePreview('## Title\n\nThis is a **long** description that should be truncated.');

      // Assert
      expect(preview).toContain('Title');
      expect(preview).toContain('long');
      expect(preview).not.toContain('**'); // Markdown removed
      expect(preview).not.toContain('\n'); // Newlines removed
    });

    it('处理空描述', () => {
      expect(service._generatePreview(null)).toBe('');
      expect(service._generatePreview('')).toBe('');
    });

    it('截取超过 100 字符的文本', () => {
      const longText = 'a'.repeat(150);
      const preview = service._generatePreview(longText);
      expect(preview).toBe('a'.repeat(100) + '...');
    });
  });
});
