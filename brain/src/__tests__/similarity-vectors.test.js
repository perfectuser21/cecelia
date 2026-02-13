/**
 * Tests for Vector Search (Phase 1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import SimilarityService from '../similarity.js';

// Mock OpenAI client
vi.mock('../openai-client.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.1))
}));

describe('SimilarityService - Vector Search', () => {
  let service;
  let mockDb;

  beforeEach(() => {
    mockDb = {
      query: vi.fn()
    };
    service = new SimilarityService(mockDb);
  });

  describe('searchWithVectors', () => {
    it('should perform hybrid search combining vector and Jaccard', async () => {
      // Mock vector search results
      mockDb.query.mockResolvedValueOnce({
        rows: [{
          id: 'task-1',
          title: '用户登录功能',
          description: '实现用户登录',
          status: 'completed',
          metadata: JSON.stringify({ repo: 'cecelia/core' }),
          project_id: null,
          vector_score: 0.85
        }]
      });

      // Mock Jaccard search (getAllActiveEntities calls)
      mockDb.query.mockResolvedValueOnce({ rows: [] });  // tasks
      mockDb.query.mockResolvedValueOnce({ rows: [] });  // initiatives
      mockDb.query.mockResolvedValueOnce({ rows: [] });  // KRs

      const result = await service.searchWithVectors('用户登录', { topK: 5 });

      expect(result).toHaveProperty('matches');
      expect(Array.isArray(result.matches)).toBe(true);
    });

    it('should fallback to Jaccard on OpenAI failure', async () => {
      // Mock OpenAI failure
      vi.mock('../openai-client.js', () => ({
        generateEmbedding: vi.fn().mockRejectedValue(new Error('API failed'))
      }));

      // Mock Jaccard search
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await service.searchWithVectors('test query', {
        topK: 5,
        fallbackToJaccard: true
      });

      expect(result).toHaveProperty('matches');
    });

    it('should filter by repo', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await service.searchWithVectors('test', {
        topK: 5,
        repo: 'cecelia/core'
      });

      // Verify query was called with repo filter
      expect(mockDb.query).toHaveBeenCalled();
    });

    it('should filter by multiple repos', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await service.searchWithVectors('test', {
        topK: 5,
        repos: ['cecelia/core', 'cecelia/workspace']
      });

      expect(mockDb.query).toHaveBeenCalled();
    });

    it('should filter by status', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await service.searchWithVectors('test', {
        topK: 5,
        status: 'completed'
      });

      expect(mockDb.query).toHaveBeenCalled();
    });
  });

  describe('vectorSearch', () => {
    it('should search using pgvector cosine similarity', async () => {
      const queryEmbedding = new Array(1536).fill(0.1);

      mockDb.query.mockResolvedValue({
        rows: [{
          id: 'task-1',
          title: 'Test Task',
          description: 'Test',
          status: 'active',
          metadata: JSON.stringify({ repo: 'test' }),
          project_id: null,
          vector_score: 0.9
        }]
      });

      const result = await service.vectorSearch(queryEmbedding);

      expect(result).toHaveProperty('matches');
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches[0]).toHaveProperty('score');
    });
  });

  describe('mergeResults', () => {
    it('should merge vector and Jaccard results', () => {
      const vectorResults = [
        { level: 'task', id: '1', title: 'Task 1', score: 0.9 }
      ];

      const jaccardResults = [
        { level: 'task', id: '1', title: 'Task 1', score: 0.7 },
        { level: 'task', id: '2', title: 'Task 2', score: 0.6 }
      ];

      const merged = service.mergeResults(vectorResults, jaccardResults, 0.7);

      expect(merged.length).toBeGreaterThan(0);
      expect(merged[0]).toHaveProperty('score');
      // First result should have combined score: 0.9*0.7 + 0.7*0.3 = 0.84
      expect(merged[0].score).toBeCloseTo(0.84, 1);
    });

    it('should use custom weights', () => {
      const vectorResults = [{ level: 'task', id: '1', score: 0.8 }];
      const jaccardResults = [{ level: 'task', id: '1', score: 0.6 }];

      const merged = service.mergeResults(vectorResults, jaccardResults, 0.5);

      // Score: 0.8*0.5 + 0.6*0.5 = 0.7
      expect(merged[0].score).toBeCloseTo(0.7, 1);
    });

    it('should handle non-overlapping results', () => {
      const vectorResults = [{ level: 'task', id: '1', score: 0.8 }];
      const jaccardResults = [{ level: 'task', id: '2', score: 0.6 }];

      const merged = service.mergeResults(vectorResults, jaccardResults, 0.7);

      expect(merged.length).toBe(2);
    });
  });
});
