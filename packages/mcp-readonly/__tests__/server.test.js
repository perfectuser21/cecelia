// packages/mcp-readonly/__tests__/server.test.js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server.js';

describe('POST /mcp 鉴权', () => {
  it('无 token 调用 /mcp 返回 401', async () => {
    const app = createApp({ skipDbInit: true, bearerToken: 'test-token' });
    const res = await request(app).post('/mcp').send({});
    expect(res.status).toBe(401);
  });

  it('错误 token 返回 401', async () => {
    const app = createApp({ skipDbInit: true, bearerToken: 'test-token' });
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer wrong')
      .send({});
    expect(res.status).toBe(401);
  });
});
