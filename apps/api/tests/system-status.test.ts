import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../src/task-system/db.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

describe('现役系统状态聚合', () => {
  let app: express.Application;
  let calls: string[];
  let failedHost: string | null;
  let stopHealthChecks: () => void;
  beforeEach(async () => {
    vi.resetModules(); calls = []; failedHost = null;
    vi.stubEnv('BRAIN_API', 'http://brain.fixture.invalid');
    vi.stubEnv('WORKSPACE_API', 'http://workspace.fixture.invalid');
    vi.stubEnv('N8N_BACKEND', 'http://n8n.fixture.invalid');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = new URL(String(input)); calls.push(url.href);
      if (url.hostname === failedHost) throw new Error('fixture service unavailable');
      if (url.pathname === '/api/brain/tick/status') return Response.json({ enabled: true });
      if (url.pathname === '/api/brain/focus/summary') return Response.json({ focus: { project: '现役项目' } });
      if (url.pathname === '/api/tasks/tasks') return Response.json({ tasks: [{ priority: 'P0', status: 'queued' }] });
      if (url.pathname === '/healthz') return Response.json({ status: 'ok' });
      if (url.pathname === '/api/v1/executions') return Response.json({ data: [] });
      if (url.pathname === '/api/system/health') return Response.json({ status: 'healthy' });
      throw new Error(`Unexpected service request: ${url.href}`);
    }));
    const router = await import('../src/system/routes.js');
    ({ stopHealthChecks } = await import('../src/system/degrade.js'));
    stopHealthChecks(); await new Promise(resolve => setImmediate(resolve));
    app = express(); app.use('/api/system', router.default);
  });
  afterEach(() => { stopHealthChecks?.(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it('只聚合Brain与工作流，不再请求退役Quality', async () => {
    const res = await request(app).get('/api/system/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ health: 'ok', brain: { health: 'ok', tasks: { p0: 1 } }, workflows: { health: 'ok' } });
    expect(res.body.data).not.toHaveProperty('quality');
    expect(calls.some(url => new URL(url).port === '5681' || url.includes('/api/state'))).toBe(false);
  });
  it('健康列表保留Brain、Workspace与N8N', async () => {
    const res = await request(app).get('/api/system/health');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.services).sort()).toEqual(['brain', 'n8n', 'workspace']);
    expect(res.body.status).toBe('healthy');
  });
  it('Brain失败仍明确返回降级并保留工作流状态', async () => {
    failedHost = 'brain.fixture.invalid';
    const res = await request(app).get('/api/system/status');
    expect(res.body.data).toMatchObject({ health: 'degraded', brain: { health: 'unavailable' }, workflows: { health: 'ok' } });
  });
});
