// packages/mcp-readonly/__tests__/health.test.js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server.js';

describe('GET /health', () => {
  it('返回 200 且包含 uptime 字段', async () => {
    const app = createApp({ skipDbInit: true });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('uptime');
  });
});
