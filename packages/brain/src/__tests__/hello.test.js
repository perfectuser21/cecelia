import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import brainRoutes from '../routes.js';

const app = express();
app.use(express.json());
app.use('/api/brain', brainRoutes);

describe('Hello API Tests', () => {
  describe('GET /api/brain/hello', () => {
    it('should return Hello Cecelia message', async () => {
      const response = await request(app)
        .get('/api/brain/hello')
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toBe('Hello Cecelia');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should return HTTP 200 status code', async () => {
      const response = await request(app)
        .get('/api/brain/hello');

      expect(response.status).toBe(200);
    });

    it('should return a valid timestamp', async () => {
      const response = await request(app)
        .get('/api/brain/hello')
        .expect(200);

      // Check that timestamp is a valid ISO date string
      const timestamp = new Date(response.body.timestamp);
      expect(timestamp.toString()).not.toBe('Invalid Date');
      expect(response.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });
  });
});