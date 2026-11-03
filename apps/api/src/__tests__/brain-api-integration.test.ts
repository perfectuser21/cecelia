import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Server } from 'node:http';
import { createBrainProxy } from '../dashboard/brain-proxy.js';
import { startLocalHttp, localHttpUrl, closeLocalHttp } from '../dashboard/__tests__/helpers/local-http.js';

interface Received { method: string | undefined; url: string | undefined; body: string; host: string | undefined; contentType: string | undefined }
let upstream: Server;
let gateway: Server;
let received: Received[];
let responseStatus: number;
let responseBody: unknown;
let upstreamClosed: boolean;

beforeEach(async () => {
  received = []; responseStatus = 200; responseBody = { tasks: [{ id: 'private-task', status: 'in_progress' }] }; upstreamClosed = false;
  upstream = await startLocalHttp((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, body, host: req.headers.host, contentType: req.headers['content-type'] });
      res.writeHead(responseStatus, { 'Content-Type': 'application/json', 'X-Private-Upstream': 'brain-fixture' });
      res.end(JSON.stringify(responseBody));
    });
  });
  const app = express();
  // 生产挂载位置：在JSON parser前，避免吃掉转发body。
  app.use('/api/brain', createBrainProxy(localHttpUrl(upstream)));
  app.use(express.json());
  gateway = await startLocalHttp(app);
});
afterEach(async () => { await closeLocalHttp(gateway); if (!upstreamClosed) await closeLocalHttp(upstream); });

describe('生产Brain HTTP代理（两端本人HTTP）', () => {
  it('恢复被Express剥掉的/api/brain并保留查询，返回实际上游数据', async () => {
    const response = await request(gateway).get('/api/brain/tasks?status=in_progress&limit=5');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ tasks: [{ id: 'private-task', status: 'in_progress' }] });
    expect(response.headers['x-private-upstream']).toBe('brain-fixture');
    expect(received).toEqual([{ method: 'GET', url: '/api/brain/tasks?status=in_progress&limit=5', body: '', host: new URL(localHttpUrl(upstream)).host, contentType: undefined }]);
  });

  it('POST JSON字节不被body parser吞掉，实际创建回执与201透传', async () => {
    responseStatus = 201; responseBody = { id: 'created-private-task', title: '只在本人上游创建' };
    const response = await request(gateway).post('/api/brain/tasks').send({ title: '只在本人上游创建', payload: { unicode: '中文', enabled: false } });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: 'created-private-task', title: '只在本人上游创建' });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: 'POST', url: '/api/brain/tasks', contentType: 'application/json' });
    expect(JSON.parse(received[0].body)).toEqual({ title: '只在本人上游创建', payload: { unicode: '中文', enabled: false } });
  });

  it.each([404, 500])('上游%s必须透传真实错误，不能返回自造成功body', async status => {
    responseStatus = status; responseBody = { error: 'private-upstream-failure', status };
    const response = await request(gateway).get('/api/brain/tasks/missing-private-id');
    expect(response.status).toBe(status);
    expect(response.body).toEqual({ error: 'private-upstream-failure', status });
    expect(received[0].url).toBe('/api/brain/tasks/missing-private-id');
  });

  it('上游不可达时返回网关失败而非吞错或伪造200', async () => {
    await closeLocalHttp(upstream); upstreamClosed = true;
    const response = await request(gateway).get('/api/brain/context').timeout(2000);
    expect(response.status).toBe(504);
    expect(received).toHaveLength(0);
  });
});
