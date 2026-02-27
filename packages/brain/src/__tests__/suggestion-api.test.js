/**
 * Tests for suggestion API endpoints
 */

import request from 'supertest';
import { jest } from '@jest/globals';

// Mock the modules since we're testing API routes
jest.unstable_mockModule('../suggestion-triage.js', () => ({
  createSuggestion: jest.fn(),
  executeTriage: jest.fn(),
  getTopPrioritySuggestions: jest.fn(),
  updateSuggestionStatus: jest.fn(),
  cleanupExpiredSuggestions: jest.fn(),
  getTriageStats: jest.fn()
}));

jest.unstable_mockModule('../db.js', () => ({
  default: {
    query: jest.fn()
  }
}));

const { default: pool } = await import('../db.js');
const {
  createSuggestion,
  executeTriage,
  getTopPrioritySuggestions,
  updateSuggestionStatus,
  cleanupExpiredSuggestions,
  getTriageStats
} = await import('../suggestion-triage.js');

// 需要在导入 routes 之前设置 mock
const { default: router } = await import('../routes.js');
import express from 'express';

const app = express();
app.use(express.json());
app.use('/api/brain', router);

describe('Suggestion API Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/brain/suggestions', () => {
    test('creates suggestion successfully', async () => {
      const mockSuggestion = {
        id: 'test-id',
        content: 'Test suggestion',
        source: 'test',
        priority_score: 0.8
      };

      createSuggestion.mockResolvedValue(mockSuggestion);

      const response = await request(app)
        .post('/api/brain/suggestions')
        .send({
          content: 'Test suggestion',
          source: 'test',
          agent_id: 'test-agent',
          suggestion_type: 'general'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.suggestion).toEqual(mockSuggestion);
      expect(createSuggestion).toHaveBeenCalledWith({
        content: 'Test suggestion',
        source: 'test',
        agent_id: 'test-agent',
        suggestion_type: 'general'
      });
    });

    test('returns 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/brain/suggestions')
        .send({
          content: 'Test suggestion'
          // missing source
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('content and source are required');
    });

    test('handles creation errors', async () => {
      createSuggestion.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/brain/suggestions')
        .send({
          content: 'Test suggestion',
          source: 'test'
        });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Failed to create suggestion');
    });
  });

  describe('GET /api/brain/suggestions', () => {
    test('returns suggestions with filters', async () => {
      const mockSuggestions = [
        { id: '1', content: 'Suggestion 1', priority_score: 0.9 },
        { id: '2', content: 'Suggestion 2', priority_score: 0.7 }
      ];

      pool.query.mockResolvedValue({ rows: mockSuggestions });

      const response = await request(app)
        .get('/api/brain/suggestions')
        .query({
          status: 'pending',
          limit: 10,
          priority_threshold: 0.5
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.suggestions).toEqual(mockSuggestions);
      expect(response.body.count).toBe(2);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE status = $1 AND priority_score >= $2'),
        ['pending', '0.5', '10']
      );
    });

    test('uses default query parameters', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .get('/api/brain/suggestions');

      expect(response.status).toBe(200);
      expect(pool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['pending', 0, 50]
      );
    });

    test('handles query errors', async () => {
      pool.query.mockRejectedValue(new Error('Query failed'));

      const response = await request(app)
        .get('/api/brain/suggestions');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Failed to get suggestions');
    });
  });

  describe('PUT /api/brain/suggestions/:id/status', () => {
    test('updates suggestion status successfully', async () => {
      updateSuggestionStatus.mockResolvedValue();

      const response = await request(app)
        .put('/api/brain/suggestions/test-id/status')
        .send({
          status: 'processed',
          metadata: { action_taken: 'task_created' }
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(updateSuggestionStatus).toHaveBeenCalledWith(
        'test-id',
        'processed',
        { action_taken: 'task_created' }
      );
    });

    test('validates status values', async () => {
      const response = await request(app)
        .put('/api/brain/suggestions/test-id/status')
        .send({
          status: 'invalid_status'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid status');
    });

    test('handles update errors', async () => {
      updateSuggestionStatus.mockRejectedValue(new Error('Update failed'));

      const response = await request(app)
        .put('/api/brain/suggestions/test-id/status')
        .send({
          status: 'processed'
        });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/brain/suggestions/triage', () => {
    test('executes triage successfully', async () => {
      const mockProcessedSuggestions = [
        { id: '1', priority_score: 0.9 },
        { id: '2', priority_score: 0.8 }
      ];

      executeTriage.mockResolvedValue(mockProcessedSuggestions);

      const response = await request(app)
        .post('/api/brain/suggestions/triage')
        .send({ limit: 20 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.processed_count).toBe(2);
      expect(executeTriage).toHaveBeenCalledWith(20);
    });

    test('uses default limit', async () => {
      executeTriage.mockResolvedValue([]);

      const response = await request(app)
        .post('/api/brain/suggestions/triage')
        .send({});

      expect(response.status).toBe(200);
      expect(executeTriage).toHaveBeenCalledWith(50);
    });

    test('handles triage errors', async () => {
      executeTriage.mockRejectedValue(new Error('Triage failed'));

      const response = await request(app)
        .post('/api/brain/suggestions/triage')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Failed to execute triage');
    });
  });

  describe('GET /api/brain/suggestions/top-priority', () => {
    test('returns top priority suggestions', async () => {
      const mockSuggestions = [
        { id: '1', priority_score: 0.95 },
        { id: '2', priority_score: 0.85 }
      ];

      getTopPrioritySuggestions.mockResolvedValue(mockSuggestions);

      const response = await request(app)
        .get('/api/brain/suggestions/top-priority')
        .query({ limit: 5 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.suggestions).toEqual(mockSuggestions);
      expect(response.body.count).toBe(2);
      expect(getTopPrioritySuggestions).toHaveBeenCalledWith(5);
    });

    test('uses default limit', async () => {
      getTopPrioritySuggestions.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/brain/suggestions/top-priority');

      expect(response.status).toBe(200);
      expect(getTopPrioritySuggestions).toHaveBeenCalledWith(10);
    });
  });

  describe('POST /api/brain/suggestions/cleanup', () => {
    test('cleans up expired suggestions', async () => {
      cleanupExpiredSuggestions.mockResolvedValue(5);

      const response = await request(app)
        .post('/api/brain/suggestions/cleanup')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.cleanup_count).toBe(5);
      expect(response.body.message).toContain('Cleaned up 5 expired suggestions');
    });

    test('handles cleanup errors', async () => {
      cleanupExpiredSuggestions.mockRejectedValue(new Error('Cleanup failed'));

      const response = await request(app)
        .post('/api/brain/suggestions/cleanup')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/brain/suggestions/stats', () => {
    test('returns triage statistics', async () => {
      const mockStats = {
        total: 100,
        by_status: {
          pending: 60,
          processed: 30,
          rejected: 10
        },
        avg_priority_by_status: {
          pending: 0.65,
          processed: 0.75,
          rejected: 0.45
        }
      };

      getTriageStats.mockResolvedValue(mockStats);

      const response = await request(app)
        .get('/api/brain/suggestions/stats');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.stats).toEqual(mockStats);
      expect(getTriageStats).toHaveBeenCalled();
    });

    test('handles stats errors', async () => {
      getTriageStats.mockRejectedValue(new Error('Stats failed'));

      const response = await request(app)
        .get('/api/brain/suggestions/stats');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });
});