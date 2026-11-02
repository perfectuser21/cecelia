import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../src/task-system/db.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

describe('现役全景状态路由', () => {
  let app: express.Application;
  let calls: string[];
  let failing: boolean;
  beforeEach(async () => {
    vi.resetModules(); calls = []; failing = false;
    vi.stubEnv('BRAIN_API', 'http://brain.fixture.invalid');
    vi.stubEnv('N8N_BACKEND', 'http://n8n.fixture.invalid');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = new URL(String(input)); calls.push(url.href);
      if (failing) throw new Error('fixture service unavailable');
      if (url.hostname === 'brain.fixture.invalid' && url.pathname === '/health') return Response.json({ status: 'ok' });
      if (url.pathname === '/api/github/panorama') return Response.json({ data: { repos: ['现役仓库'] } });
      if (url.hostname === 'n8n.fixture.invalid' && url.pathname === '/healthz') return Response.json({ status: 'ok' });
      throw new Error(`Unexpected service request: ${url.href}`);
    }));
    const router = await import('../src/panorama/routes.js');
    app = express(); app.use('/api/panorama', router.default);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it('保留Brain、GitHub与N8N，去除退役Quality服务', async () => {
    const res = await request(app).get('/api/panorama/full');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ brain: { health: 'ok' }, github: { repos: ['现役仓库'] } });
    expect(res.body.data).toHaveProperty('vps');
    expect(res.body.data.services.map((s: { name: string }) => s.name)).toEqual(['semantic-brain', 'n8n']);
    expect(res.body.data.services.every((s: { status: string }) => s.status === 'up')).toBe(true);
    expect(res.body.data).not.toHaveProperty('quality');
    expect(calls.some(url => new URL(url).port === '5681' || url.includes('/api/state'))).toBe(false);
  });
  it('剩余服务失败仍报告down与unavailable', async () => {
    failing = true;
    const res = await request(app).get('/api/panorama/full');
    expect(res.status).toBe(200);
    expect(res.body.data.brain.health).toBe('unavailable');
    expect(res.body.data.services.every((s: { status: string }) => s.status === 'down')).toBe(true);
  });
});
