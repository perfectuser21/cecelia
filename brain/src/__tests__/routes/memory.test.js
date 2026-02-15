/**
 * Memory API Integration Tests
 */

// Set required env vars before importing server
process.env.ENV_REGION = 'us';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

// Mock process.exit to prevent server.js from exiting during import
// This is needed because server.js runs selfcheck at module level
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {});

import app from '../../../server.js';
import pool from '../../db.js';

describe('Memory API Routes', () => {
  let testTaskId;

  beforeAll(async () => {
    // Create a test task for testing
    const result = await pool.query(
      `INSERT INTO tasks (title, description, status)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [
        'Test Memory API Task',
        'This is a test task for memory API integration tests',
        'completed'
      ]
    );
    testTaskId = result.rows[0].id;
  });

  afterAll(async () => {
    // Clean up test task
    if (testTaskId) {
      await pool.query('DELETE FROM tasks WHERE id = $1', [testTaskId]);
    }

    // Restore process.exit mock
    mockExit.mockRestore();
  });

  describe('POST /api/brain/memory/search', () => {
    it('正常工作，返回 summary 格式', async () => {
      // Act
      const response = await request(app)
        .post('/api/brain/memory/search')
        .send({
          query: 'test memory',
          topK: 5,
          mode: 'summary'
        });

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('matches');
      expect(Array.isArray(response.body.matches)).toBe(true);

      if (response.body.matches.length > 0) {
        const match = response.body.matches[0];
        expect(match).toHaveProperty('id');
        expect(match).toHaveProperty('level');
        expect(match).toHaveProperty('title');
        expect(match).toHaveProperty('similarity');
        expect(match).toHaveProperty('preview');
      }
    });

    it('缺少 query 参数时返回 400', async () => {
      const response = await request(app)
        .post('/api/brain/memory/search')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('query 不是字符串时返回 400', async () => {
      const response = await request(app)
        .post('/api/brain/memory/search')
        .send({ query: 123 });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/brain/memory/detail/:id', () => {
    it('返回完整的任务信息', async () => {
      // Act
      const response = await request(app)
        .get(`/api/brain/memory/detail/${testTaskId}`);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', testTaskId);
      expect(response.body).toHaveProperty('level', 'task');
      expect(response.body).toHaveProperty('title', 'Test Memory API Task');
      expect(response.body).toHaveProperty('description');
      expect(response.body).toHaveProperty('status', 'completed');
      expect(response.body).toHaveProperty('metadata');
      expect(response.body).toHaveProperty('created_at');
    });

    it('不存在的 ID 返回 404', async () => {
      const response = await request(app)
        .get('/api/brain/memory/detail/00000000-0000-0000-0000-000000000000');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Not found');
    });

    it('无效的 ID 格式返回 400', async () => {
      const response = await request(app)
        .get('/api/brain/memory/detail/invalid-uuid');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Invalid request');
    });
  });

  describe('POST /api/brain/memory/search-related', () => {
    it('正常工作，排除自身', async () => {
      // Act
      const response = await request(app)
        .post('/api/brain/memory/search-related')
        .send({
          base_id: testTaskId,
          topK: 5,
          exclude_self: true
        });

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('matches');
      expect(Array.isArray(response.body.matches)).toBe(true);

      // 确保返回的结果中不包含自身
      const selfIncluded = response.body.matches.some(m => m.id === testTaskId);
      expect(selfIncluded).toBe(false);
    });

    it('缺少 base_id 参数时返回 400', async () => {
      const response = await request(app)
        .post('/api/brain/memory/search-related')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('base_id 不是字符串时返回 400', async () => {
      const response = await request(app)
        .post('/api/brain/memory/search-related')
        .send({ base_id: 123 });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('无效的 UUID 格式返回 400', async () => {
      const response = await request(app)
        .post('/api/brain/memory/search-related')
        .send({ base_id: 'invalid-uuid' });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('不存在的 base_id 返回 404', async () => {
      const response = await request(app)
        .post('/api/brain/memory/search-related')
        .send({ base_id: '00000000-0000-0000-0000-000000000000' });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Not found');
    });
  });

  describe('Error handling', () => {
    it('OpenAI API 失败时降级到 Jaccard（已在 similarity.js 实现）', async () => {
      // This is tested in similarity.js tests
      // Here we just verify the API still works even if OpenAI fails
      const response = await request(app)
        .post('/api/brain/memory/search')
        .send({ query: 'test', mode: 'summary' });

      expect(response.status).toBe(200);
      // Should not throw error even if OpenAI fails (fallback to Jaccard)
    });
  });
});
