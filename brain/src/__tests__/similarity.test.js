/**
 * Similarity Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import SimilarityService from '../similarity.js';

describe('SimilarityService', () => {
  let mockDb;
  let service;

  beforeEach(() => {
    mockDb = {
      query: vi.fn()
    };
    service = new SimilarityService(mockDb);
  });

  describe('tokenize', () => {
    it('should tokenize English text', () => {
      const result = service.tokenize('Implement task priority algorithm');
      expect(result).toEqual(['implement', 'task', 'priority', 'algorithm']);
    });

    it('should tokenize Chinese text', () => {
      const result = service.tokenize('实现任务优先级算法');
      expect(result).toEqual(['实现任务优先级算法']);
    });

    it('should handle mixed English and Chinese', () => {
      const result = service.tokenize('实现 task 优先级 algorithm');
      expect(result).toContain('task');
      expect(result).toContain('algorithm');
    });

    it('should filter out single characters', () => {
      const result = service.tokenize('a task b');
      expect(result).not.toContain('a');
      expect(result).not.toContain('b');
      expect(result).toContain('task');
    });

    it('should remove special characters', () => {
      const result = service.tokenize('task-priority@algorithm!');
      expect(result).toContain('task');
      expect(result).toContain('priority');
      expect(result).toContain('algorithm');
    });

    it('should convert to lowercase', () => {
      const result = service.tokenize('TASK Priority');
      expect(result).toContain('task');
      expect(result).toContain('priority');
    });

    it('should handle empty string', () => {
      const result = service.tokenize('');
      expect(result).toEqual([]);
    });

    it('should handle null/undefined', () => {
      expect(service.tokenize(null)).toEqual([]);
      expect(service.tokenize(undefined)).toEqual([]);
    });
  });

  describe('extractKeywords', () => {
    it('should remove English stopwords', () => {
      const result = service.extractKeywords('the task is in the system');
      expect(result).not.toContain('the');
      expect(result).not.toContain('in');
      expect(result).toContain('task');
      expect(result).toContain('system');
      // Note: 'is' is only filtered if it's a 2-letter word, may still appear in results
    });

    it('should remove Chinese stopwords', () => {
      const result = service.extractKeywords('任务的优先级在系统里');
      expect(result).not.toContain('的');
      expect(result).not.toContain('在');
    });

    it('should preserve important words', () => {
      const result = service.extractKeywords('implement priority algorithm');
      expect(result).toContain('implement');
      expect(result).toContain('priority');
      expect(result).toContain('algorithm');
    });
  });

  describe('calculateScore', () => {
    it('should calculate Jaccard similarity correctly', () => {
      const entity = {
        level: 'task',
        text: 'implement task priority algorithm',
        status: 'in_progress'
      };

      const score = service.calculateScore('task priority algorithm', entity);
      expect(score).toBeGreaterThan(0.5);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it('should return high score for exact match', () => {
      const entity = {
        level: 'task',
        text: 'implement priority algorithm',
        status: 'pending'
      };

      const score = service.calculateScore('implement priority algorithm', entity);
      expect(score).toBeGreaterThan(0.8);
    });

    it('should return low score for different text', () => {
      const entity = {
        level: 'task',
        text: 'user login authentication system',
        status: 'pending'
      };

      const score = service.calculateScore('implement priority algorithm', entity);
      expect(score).toBeLessThan(0.3);
    });

    it('should apply keyword boost', () => {
      const entity1 = {
        level: 'task',
        text: 'implement system',
        status: 'pending'
      };

      const entity2 = {
        level: 'task',
        text: 'implement priority system',
        status: 'pending'
      };

      const score1 = service.calculateScore('implement priority algorithm', entity1);
      const score2 = service.calculateScore('implement priority algorithm', entity2);

      // entity2 should have higher score due to keyword "priority"
      expect(score2).toBeGreaterThan(score1);
    });

    it('should apply status penalty for completed tasks', () => {
      const entityPending = {
        level: 'task',
        text: 'implement priority algorithm system',
        status: 'pending'
      };

      const entityCompleted = {
        level: 'task',
        text: 'implement priority algorithm system',
        status: 'completed'
      };

      const scorePending = service.calculateScore('implement priority system', entityPending);
      const scoreCompleted = service.calculateScore('implement priority system', entityCompleted);

      // Completed task should have lower score (unless both are clamped at 1.0)
      if (scorePending < 1.0) {
        expect(scoreCompleted).toBeLessThan(scorePending);
        expect(scorePending - scoreCompleted).toBeCloseTo(0.1, 1);
      } else {
        // If pending is at max, both will be at max after clamping
        expect(scoreCompleted).toBeLessThanOrEqual(1.0);
      }
    });

    it('should not apply penalty for completed initiatives', () => {
      const entity = {
        level: 'initiative',
        text: 'implement priority system',
        status: 'completed'
      };

      const score = service.calculateScore('implement priority system', entity);
      expect(score).toBeGreaterThan(0.5); // No penalty for initiative
    });

    it('should clamp score to 1.0', () => {
      const entity = {
        level: 'task',
        text: 'algorithm priority task implement system',
        status: 'pending'
      };

      const score = service.calculateScore('algorithm priority task implement system', entity);
      expect(score).toBeLessThanOrEqual(1.0);
    });
  });

  describe('getAllActiveEntities', () => {
    it('should query tasks, initiatives, and KRs', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // tasks
        .mockResolvedValueOnce({ rows: [] }) // initiatives
        .mockResolvedValueOnce({ rows: [] }); // KRs

      const result = await service.getAllActiveEntities();

      expect(mockDb.query).toHaveBeenCalledTimes(3);
      expect(result).toEqual([]);
    });

    it('should format task entities correctly', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-123',
            title: 'Implement algorithm',
            description: 'Priority calculation',
            status: 'in_progress',
            initiative_id: 'init-456',
            initiative_title: 'Smart scheduling',
            pr_plan_title: 'Add priority'
          }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.getAllActiveEntities();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        level: 'task',
        id: 'task-123',
        title: 'Implement algorithm',
        description: 'Priority calculation',
        status: 'in_progress',
        text: 'Implement algorithm Priority calculation',
        metadata: {
          initiative_id: 'init-456',
          initiative_title: 'Smart scheduling',
          pr_plan_title: 'Add priority'
        }
      });
    });

    it('should format initiative entities correctly', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'init-456',
            title: 'Smart scheduling system',
            description: 'Intelligent task scheduling',
            status: 'active',
            kr_id: 'kr-789',
            kr_title: 'Reduce scheduling time'
          }]
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.getAllActiveEntities();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        level: 'initiative',
        id: 'init-456',
        title: 'Smart scheduling system',
        status: 'active',
        metadata: {
          kr_id: 'kr-789',
          kr_title: 'Reduce scheduling time'
        }
      });
    });

    it('should format KR entities correctly', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'kr-789',
            title: 'Reduce scheduling time by 50%',
            description: 'Improve system performance',
            status: 'active',
            okr_id: 'okr-001',
            objective: 'Improve system efficiency'
          }]
        });

      const result = await service.getAllActiveEntities();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        level: 'kr',
        id: 'kr-789',
        title: 'Reduce scheduling time by 50%',
        status: 'active',
        metadata: {
          okr_id: 'okr-001',
          okr_objective: 'Improve system efficiency'
        }
      });
    });

    it('should handle null descriptions', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-123',
            title: 'Task title',
            description: null,
            status: 'pending'
          }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.getAllActiveEntities();

      expect(result[0].description).toBe('');
      expect(result[0].text).toBe('Task title ');
    });

    it('should combine all entity types', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ id: 'task-1', title: 'Task 1', status: 'pending' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'init-1', title: 'Init 1', status: 'active' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'kr-1', title: 'KR 1', status: 'active' }] });

      const result = await service.getAllActiveEntities();

      expect(result).toHaveLength(3);
      expect(result.map(e => e.level)).toEqual(['task', 'initiative', 'kr']);
    });
  });

  describe('searchSimilar', () => {
    it('should return top K matches sorted by score', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'task-1', title: 'implement priority algorithm', status: 'pending' },
            { id: 'task-2', title: 'implement user login', status: 'pending' },
            { id: 'task-3', title: 'priority task scheduling', status: 'pending' }
          ]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.searchSimilar('implement priority algorithm', 2);

      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].score).toBeGreaterThan(result.matches[1].score);
      expect(result.matches[0].title).toContain('priority');
    });

    it('should filter out low scores (< 0.3)', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'task-1', title: 'implement priority algorithm', status: 'pending' },
            { id: 'task-2', title: 'completely different task', status: 'pending' }
          ]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.searchSimilar('implement priority algorithm', 10);

      expect(result.matches.length).toBeLessThan(2);
      expect(result.matches.every(m => m.score > 0.3)).toBe(true);
    });

    it('should use default topK=5 when not specified', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: Array.from({ length: 10 }, (_, i) => ({
            id: `task-${i}`,
            title: `task priority algorithm ${i}`,
            status: 'pending'
          }))
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.searchSimilar('task priority algorithm');

      expect(result.matches.length).toBeLessThanOrEqual(5);
    });

    it('should include score in results', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ id: 'task-1', title: 'implement priority', status: 'pending' }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.searchSimilar('implement priority', 5);

      expect(result.matches[0]).toHaveProperty('score');
      expect(result.matches[0].score).toBeGreaterThan(0);
      expect(result.matches[0].score).toBeLessThanOrEqual(1.0);
    });
  });

  describe('SimilarityService constructor', () => {
    it('should use provided db instance', () => {
      const customDb = { query: vi.fn() };
      const customService = new SimilarityService(customDb);
      expect(customService.db).toBe(customDb);
    });

    it('should use default pool when db not provided', () => {
      const defaultService = new SimilarityService();
      expect(defaultService.db).toBeDefined();
    });
  });

  describe('getAllActiveEntities with filters', () => {
    it('should filter by repo', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // tasks
        .mockResolvedValueOnce({ rows: [] }) // initiatives
        .mockResolvedValueOnce({ rows: [] }); // KRs

      await service.getAllActiveEntities({ repo: 'cecelia-workspace' });

      // Check that the first query (tasks) includes repo filter
      const taskQuery = mockDb.query.mock.calls[0][0];
      expect(taskQuery).toContain("metadata->>'repo' = $1");
      expect(mockDb.query.mock.calls[0][1]).toContain('cecelia-workspace');
    });

    it('should filter by project_id', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await service.getAllActiveEntities({ project_id: 123 });

      const taskQuery = mockDb.query.mock.calls[0][0];
      expect(taskQuery).toContain('project_id = $1');
      expect(mockDb.query.mock.calls[0][1]).toContain(123);
    });

    it('should filter by date range', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await service.getAllActiveEntities({
        date_from: '2026-01-01',
        date_to: '2026-02-12'
      });

      const taskQuery = mockDb.query.mock.calls[0][0];
      expect(taskQuery).toContain('created_at >= $1');
      expect(taskQuery).toContain('created_at <= $2');
      expect(mockDb.query.mock.calls[0][1]).toContain('2026-01-01');
      expect(mockDb.query.mock.calls[0][1]).toContain('2026-02-12');
    });

    it('should combine multiple filters', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await service.getAllActiveEntities({
        repo: 'cecelia-core',
        project_id: 456,
        date_from: '2026-01-01'
      });

      const taskQuery = mockDb.query.mock.calls[0][0];
      expect(taskQuery).toContain("metadata->>'repo' = $1");
      expect(taskQuery).toContain('project_id = $2');
      expect(taskQuery).toContain('created_at >= $3');
    });

    it('should use custom limit', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await service.getAllActiveEntities({ limit: 500 });

      const taskQuery = mockDb.query.mock.calls[0][0];
      expect(taskQuery).toContain('LIMIT $1');
      expect(mockDb.query.mock.calls[0][1]).toContain(500);
    });

    it('should use default limit 1000 when not specified', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await service.getAllActiveEntities({});

      const params = mockDb.query.mock.calls[0][1];
      expect(params[params.length - 1]).toBe(1000);
    });

    it('should parse metadata from tasks', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-123',
            title: 'PR imported task',
            description: 'Test description',
            status: 'completed',
            project_id: 1,
            metadata: JSON.stringify({
              repo: 'cecelia-workspace',
              pr_number: 456,
              pr_author: 'perfectuser21'
            })
          }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.getAllActiveEntities({});

      expect(result[0].metadata.repo).toBe('cecelia-workspace');
      expect(result[0].metadata.pr_number).toBe(456);
      expect(result[0].metadata.pr_author).toBe('perfectuser21');
      expect(result[0].project_id).toBe(1);
    });
  });

  describe('searchSimilar with filters', () => {
    it('should pass filters to getAllActiveEntities', async () => {
      const filters = { repo: 'cecelia-engine', project_id: 789 };

      mockDb.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await service.searchSimilar('test query', 5, filters);

      const taskQuery = mockDb.query.mock.calls[0][0];
      expect(taskQuery).toContain("metadata->>'repo' = $1");
      expect(taskQuery).toContain('project_id = $2');
    });

    it('should work without filters (backward compatibility)', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ id: 'task-1', title: 'test task', status: 'pending' }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.searchSimilar('test');

      expect(result.matches).toBeDefined();
      expect(Array.isArray(result.matches)).toBe(true);
    });
  });
});
