/**
 * Orchestrator Queue Management API Tests
 *
 * Note: These tests focus on API endpoint validation and error handling.
 * Full business logic testing (queue operations, slot management) requires
 * integration with the Executor service, which is not yet implemented.
 *
 * According to QA-DECISION.md, this feature primarily uses manual testing
 * for voice interaction scenarios. Automated tests cover:
 * - API endpoint structure and responses
 * - Error handling and edge cases
 * - Data structure validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import orchestratorQueueRoutes from '../orchestrator-queue.js';

// Create a test Express app
const app = express();
app.use(express.json());
app.use('/api/orchestrator', orchestratorQueueRoutes);

describe('Orchestrator Queue Management API', () => {
  beforeEach(async () => {
    // Reset queue state before each test
    // Note: Full state management requires Executor service integration
    const clearResponse = await request(app).get('/api/orchestrator/queue');
    // Store initial state for reference
  });

  describe('GET /api/orchestrator/queue', () => {
    it('should return empty queue initially', async () => {
      const response = await request(app)
        .get('/api/orchestrator/queue')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.queued).toEqual([]);
      expect(response.body.data.running).toEqual([]);
      expect(response.body.data.stats).toBeDefined();
      expect(response.body.data.stats.queued_count).toBe(0);
      expect(response.body.data.stats.running_count).toBe(0);
      expect(response.body.data.stats.available_slots).toBe(8);
    });

    it('should return queue data structure', async () => {
      const response = await request(app)
        .get('/api/orchestrator/queue')
        .expect(200);

      const { data } = response.body;
      expect(data).toHaveProperty('queued');
      expect(data).toHaveProperty('running');
      expect(data).toHaveProperty('stats');
      expect(data.stats).toHaveProperty('queued_count');
      expect(data.stats).toHaveProperty('running_count');
      expect(data.stats).toHaveProperty('available_slots');
    });
  });

  describe('POST /api/orchestrator/execute-now/:id', () => {
    it('should return 404 with specific error for non-existent task', async () => {
      const taskId = 'non-existent-id';
      const response = await request(app)
        .post(`/api/orchestrator/execute-now/${taskId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe(`Task not found in queue: ${taskId}`);
    });

    it('should handle empty task ID gracefully', async () => {
      const response = await request(app)
        .post('/api/orchestrator/execute-now/');

      // Empty ID results in route not found
      expect(response.status).toBe(404);
    });

    it('should return data structure with success field', async () => {
      const response = await request(app)
        .post('/api/orchestrator/execute-now/test-id-123');

      expect(response.body).toHaveProperty('success');
      if (!response.body.success) {
        expect(response.body).toHaveProperty('error');
      } else {
        expect(response.body).toHaveProperty('data');
      }
    });
  });

  describe('POST /api/orchestrator/pause/:id', () => {
    it('should return 404 with specific error for non-running task', async () => {
      const taskId = 'non-running-id';
      const response = await request(app)
        .post(`/api/orchestrator/pause/${taskId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe(`Task not running: ${taskId}`);
    });

    it('should handle empty task ID gracefully', async () => {
      const response = await request(app)
        .post('/api/orchestrator/pause/');

      // Empty ID results in route not found
      expect(response.status).toBe(404);
    });

    it('should return data structure with success field', async () => {
      const response = await request(app)
        .post('/api/orchestrator/pause/test-id-456');

      expect(response.body).toHaveProperty('success');
      if (!response.body.success) {
        expect(response.body).toHaveProperty('error');
      } else {
        expect(response.body).toHaveProperty('data');
        expect(response.body.data).toHaveProperty('task_id');
        expect(response.body.data).toHaveProperty('released_slot');
        expect(response.body.data).toHaveProperty('message');
      }
    });
  });

  describe('Error handling', () => {
    it('should handle invalid routes gracefully', async () => {
      const response = await request(app)
        .get('/api/orchestrator/invalid-route')
        .expect(404);
    });

    it('should return JSON error responses with proper structure', async () => {
      const response = await request(app)
        .post('/api/orchestrator/execute-now/non-existent');

      expect(response.body).toHaveProperty('success');
      expect(response.body.success).toBe(false);
      expect(response.body).toHaveProperty('error');
      expect(typeof response.body.error).toBe('string');
    });

    it('should handle very long task IDs without crashing', async () => {
      const longId = 'x'.repeat(1000);
      const response = await request(app)
        .post(`/api/orchestrator/execute-now/${longId}`);

      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.body).toHaveProperty('success');
    });

    it('should handle special characters in task ID', async () => {
      const specialId = 'task-with-特殊字符-!@#$';
      const response = await request(app)
        .post(`/api/orchestrator/execute-now/${specialId}`);

      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.body).toHaveProperty('success');
    });
  });

  describe('Data structure validation', () => {
    it('should return consistent queue data structure', async () => {
      const response = await request(app)
        .get('/api/orchestrator/queue')
        .expect(200);

      // Verify exact structure
      expect(response.body).toEqual({
        success: true,
        data: {
          queued: expect.any(Array),
          running: expect.any(Array),
          stats: {
            queued_count: expect.any(Number),
            running_count: expect.any(Number),
            available_slots: expect.any(Number)
          }
        }
      });
    });

    it('should ensure stats values are non-negative', async () => {
      const response = await request(app)
        .get('/api/orchestrator/queue')
        .expect(200);

      const { stats } = response.body.data;
      expect(stats.queued_count).toBeGreaterThanOrEqual(0);
      expect(stats.running_count).toBeGreaterThanOrEqual(0);
      expect(stats.available_slots).toBeGreaterThanOrEqual(0);
    });

    it('should ensure available_slots equals MAX_SLOTS minus running_count', async () => {
      const response = await request(app)
        .get('/api/orchestrator/queue')
        .expect(200);

      const { stats } = response.body.data;
      const maxSlots = parseInt(process.env.MAX_CONCURRENT || '8', 10);
      expect(stats.available_slots).toBe(maxSlots - stats.running_count);
    });
  });
});
