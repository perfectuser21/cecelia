/**
 * Attachment Decision API Routes Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock the similarity service before importing routes
vi.mock('../similarity.js', () => {
  return {
    default: class MockSimilarityService {
      async searchSimilar(query, topK) {
        // Return mock data based on query
        if (query.includes('priority')) {
          return {
            matches: [
              {
                level: 'task',
                id: 'task-123',
                title: 'Implement priority algorithm',
                score: 0.88,
                status: 'completed',
                text: 'implement priority algorithm',
                metadata: { initiative_id: 'init-456' }
              },
              {
                level: 'initiative',
                id: 'init-456',
                title: 'Smart scheduling system',
                score: 0.71,
                status: 'in_progress',
                text: 'smart scheduling system',
                metadata: { kr_id: 'kr-789' }
              }
            ]
          };
        }
        return { matches: [] };
      }
    }
  };
});

describe('Attachment Decision API Routes', () => {
  let app;
  let router;

  beforeEach(async () => {
    // Create a fresh Express app for each test
    app = express();
    app.use(express.json());

    // Import routes after mocks are set up
    const routesModule = await import('../routes.js');
    router = routesModule.default;
    app.use('/api/brain', router);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/brain/search-similar', () => {
    it('should return similar entities', async () => {
      const response = await request(app)
        .post('/api/brain/search-similar')
        .send({
          query: 'implement priority algorithm',
          top_k: 5
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.matches).toBeDefined();
      expect(Array.isArray(response.body.matches)).toBe(true);
    });

    it('should require query parameter', async () => {
      const response = await request(app)
        .post('/api/brain/search-similar')
        .send({
          top_k: 5
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('query');
    });

    it('should use default top_k=5 when not provided', async () => {
      const response = await request(app)
        .post('/api/brain/search-similar')
        .send({
          query: 'implement task'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.matches).toBeDefined();
    });

    it('should handle empty query gracefully', async () => {
      const response = await request(app)
        .post('/api/brain/search-similar')
        .send({
          query: '',
          top_k: 5
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should return matches with correct structure', async () => {
      const response = await request(app)
        .post('/api/brain/search-similar')
        .send({
          query: 'priority algorithm',
          top_k: 3
        })
        .expect(200);

      expect(response.body.matches).toBeDefined();
      if (response.body.matches.length > 0) {
        const match = response.body.matches[0];
        expect(match).toHaveProperty('level');
        expect(match).toHaveProperty('id');
        expect(match).toHaveProperty('title');
        expect(match).toHaveProperty('score');
      }
    });
  });

  describe('POST /api/brain/attach-decision', () => {
    it('should return duplicate_task decision for high similarity task', async () => {
      const response = await request(app)
        .post('/api/brain/attach-decision')
        .send({
          input: 'implement priority algorithm',
          matches: [
            {
              level: 'task',
              id: 'task-123',
              title: 'Implement priority algorithm',
              score: 0.88,
              status: 'completed'
            }
          ]
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.attach.action).toBe('duplicate_task');
      expect(response.body.attach.target.id).toBe('task-123');
      expect(response.body.attach.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('should return extend_initiative decision for related initiative', async () => {
      const response = await request(app)
        .post('/api/brain/attach-decision')
        .send({
          input: 'add dynamic priority adjustment',
          matches: [
            {
              level: 'task',
              id: 'task-100',
              title: 'Different task',
              score: 0.3,
              status: 'pending'
            },
            {
              level: 'initiative',
              id: 'init-456',
              title: 'Smart scheduling system',
              score: 0.71,
              status: 'in_progress'
            }
          ]
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.attach.action).toBe('extend_initiative');
      expect(response.body.attach.target.level).toBe('initiative');
      expect(response.body.attach.target.id).toBe('init-456');
    });

    it('should return create_initiative_under_kr decision for related KR', async () => {
      const response = await request(app)
        .post('/api/brain/attach-decision')
        .send({
          input: 'new feature for performance',
          matches: [
            {
              level: 'kr',
              id: 'kr-789',
              title: 'Improve system performance',
              score: 0.65,
              status: 'active'
            }
          ]
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.attach.action).toBe('create_initiative_under_kr');
      expect(response.body.attach.target.level).toBe('kr');
    });

    it('should return create_new_okr_kr decision when no matches', async () => {
      const response = await request(app)
        .post('/api/brain/attach-decision')
        .send({
          input: 'completely new feature area',
          matches: []
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.attach.action).toBe('create_new_okr_kr');
      expect(response.body.attach.target.level).toBe('okr');
      expect(response.body.attach.target.id).toBeNull();
    });

    it('should require input parameter', async () => {
      const response = await request(app)
        .post('/api/brain/attach-decision')
        .send({
          matches: []
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('input');
    });

    it('should handle missing matches parameter', async () => {
      const response = await request(app)
        .post('/api/brain/attach-decision')
        .send({
          input: 'some task'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      // Should default to create_new_okr_kr when no matches
      expect(response.body.attach.action).toBe('create_new_okr_kr');
    });

    it('should include route decision in response', async () => {
      const response = await request(app)
        .post('/api/brain/attach-decision')
        .send({
          input: 'implement feature',
          matches: []
        })
        .expect(200);

      expect(response.body.route).toBeDefined();
      expect(response.body.route.path).toBeDefined();
      expect(response.body.route.why).toBeDefined();
      expect(Array.isArray(response.body.route.why)).toBe(true);
      expect(response.body.route.confidence).toBeGreaterThan(0);
    });

    it('should include next_call in response', async () => {
      const response = await request(app)
        .post('/api/brain/attach-decision')
        .send({
          input: 'implement feature',
          matches: []
        })
        .expect(200);

      expect(response.body.next_call).toBeDefined();
      expect(response.body.next_call.skill).toBeDefined();
      expect(['/dev', '/exploratory', '/okr']).toContain(response.body.next_call.skill);
      expect(response.body.next_call.args).toBeDefined();
    });

    it('should short-circuit on task with score >= 0.85', async () => {
      const response = await request(app)
        .post('/api/brain/attach-decision')
        .send({
          input: 'task description',
          matches: [
            {
              level: 'task',
              id: 'task-high',
              title: 'High similarity task',
              score: 0.90,
              status: 'pending'
            },
            {
              level: 'initiative',
              id: 'init-999',
              title: 'Some initiative',
              score: 0.95,
              status: 'active'
            }
          ]
        })
        .expect(200);

      // Should return duplicate_task even though initiative has higher score
      expect(response.body.attach.action).toBe('duplicate_task');
      expect(response.body.attach.target.id).toBe('task-high');
    });

    it('should skip tasks with score < 0.85 and check initiatives', async () => {
      const response = await request(app)
        .post('/api/brain/attach-decision')
        .send({
          input: 'task description',
          matches: [
            {
              level: 'task',
              id: 'task-low',
              title: 'Low similarity task',
              score: 0.70,
              status: 'pending'
            },
            {
              level: 'initiative',
              id: 'init-999',
              title: 'Related initiative',
              score: 0.75,
              status: 'active'
            }
          ]
        })
        .expect(200);

      // Should skip task and return extend_initiative
      expect(response.body.attach.action).toBe('extend_initiative');
      expect(response.body.attach.target.id).toBe('init-999');
    });

    it('should handle context parameter', async () => {
      const response = await request(app)
        .post('/api/brain/attach-decision')
        .send({
          input: 'implement feature',
          matches: [],
          context: {
            user: 'user-123',
            mode: 'interactive'
          }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return confidence values in valid range', async () => {
      const response = await request(app)
        .post('/api/brain/attach-decision')
        .send({
          input: 'implement feature',
          matches: []
        })
        .expect(200);

      expect(response.body.attach.confidence).toBeGreaterThanOrEqual(0);
      expect(response.body.attach.confidence).toBeLessThanOrEqual(1.0);
      expect(response.body.route.confidence).toBeGreaterThanOrEqual(0);
      expect(response.body.route.confidence).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Error handling', () => {
    it('should handle invalid JSON in request body', async () => {
      const response = await request(app)
        .post('/api/brain/search-similar')
        .set('Content-Type', 'application/json')
        .send('invalid json')
        .expect(400);

      // Express will reject invalid JSON before reaching route handler
    });

    it('should handle missing Content-Type header', async () => {
      const response = await request(app)
        .post('/api/brain/search-similar')
        .send('query=test')
        .expect(400);
    });
  });
});
