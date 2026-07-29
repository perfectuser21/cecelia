import request from 'supertest';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createAcceptancePublicApp, startAcceptancePublicServer } from '../acceptance-public-server.js';

const TOKEN = 'test-token-abc';

function makePool() {
  return { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() };
}

describe('createAcceptancePublicApp 鉴权', () => {
  it('无 Authorization → 401', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .get('/acceptance/pending');
    expect(res.status).toBe(401);
  });

  it('错 token → 401', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .get('/acceptance/pending')
      .set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('对 token → 200 进入业务路由', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .get('/acceptance/pending')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [] });
  });

  it('未知路径 → 404（即使带对 token）', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .get('/api/brain/tasks')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
  });
});

describe('startAcceptancePublicServer fail-closed', () => {
  afterEach(() => { delete process.env.ACCEPTANCE_API_TOKEN; });

  it('ACCEPTANCE_API_TOKEN 未配置 → 返回 null 不监听', () => {
    delete process.env.ACCEPTANCE_API_TOKEN;
    const server = startAcceptancePublicServer({ pool: makePool(), port: 0 });
    expect(server).toBeNull();
  });

  it('配置了 token → 返回 server 并监听', async () => {
    process.env.ACCEPTANCE_API_TOKEN = TOKEN;
    const server = startAcceptancePublicServer({ pool: makePool(), port: 0 });
    expect(server).not.toBeNull();
    await new Promise((r) => server.close(r));
  });
});
