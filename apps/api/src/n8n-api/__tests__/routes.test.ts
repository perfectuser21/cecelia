import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import router from '../routes.js';
afterEach(() => vi.unstubAllGlobals());
it.each(['overview', 'workflows'])('%s不把未采集的单工作流统计伪报为0', async endpoint => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => ({ data: url.includes('/workflows') ? [{ id: 'wf1', name: 'actual workflow', active: true }] : [{ id: 'ex1', workflowId: 'wf1', status: 'success' }] }) })));
  const app = express(); app.use(router);
  const res = await request(app).get(`/n8n-workflows/instances/local/${endpoint}`);
  expect(res.status).toBe(200);
  const workflows = endpoint === 'overview' ? res.body.workflows.workflows : res.body.workflows;
  expect(workflows[0].runStats).toBeNull();
  expect(workflows[0].id).toBe('wf1');
});
