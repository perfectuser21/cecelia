import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import approvalRouter from '../routes/harness-kernel-approvals.js';

describe('kernel context review read admission', () => {
  it('rate-limits repeated context-list database reads', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = express();
    app.set('pool', { query });
    app.use('/kernel-reviews', approvalRouter);
    const server = await new Promise((resolve) => {
      const listeningServer = app.listen(0, () => resolve(listeningServer));
    });
    const client = request(server);

    try {
      for (let requestNumber = 1; requestNumber <= 60; requestNumber += 1) {
        const response = await client.get('/kernel-reviews/contexts');
        expect(response.status, `request ${requestNumber}`).toBe(200);
      }

      const blocked = await client.get('/kernel-reviews/contexts');
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual({ error: 'context read rate limit exceeded' });
      expect(query).toHaveBeenCalledTimes(60);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
