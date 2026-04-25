/**
 * Workstream 2 — HTTP 端点 GET /api/brain/health [BEHAVIOR]
 *
 * 合同测试：构造最小 express app，挂载 WS1 产出的 health router 到 /api/brain/health，
 * 用 supertest 打 HTTP 请求验证响应 schema 与并发行为。
 *
 * 不直接 import packages/brain/server.js——后者 import 时会初始化 tick/WebSocket/DB pool 等，
 * 合同测试不需要这些副作用。server.js 内"实际挂载了 health router"由 contract-dod-ws2.md
 * 的 ARTIFACT 静态断言（grep 代码）验证。
 *
 * 当前 Red 证据：WS1 模块尚未创建 → import healthRouter 抛 ERR_MODULE_NOT_FOUND
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// @ts-ignore - 目标模块尚未创建，TDD Red 阶段故意保留 import 错误
import healthRouter from '../../../packages/brain/src/health.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'packages', 'brain', 'package.json'), 'utf8')
).version as string;

function buildTestApp() {
  const app = express();
  app.use('/api/brain/health', healthRouter);
  return app;
}

describe('Workstream 2 — Health HTTP Endpoint [BEHAVIOR]', () => {
  it('GET /api/brain/health 返回 HTTP 200', async () => {
    const res = await request(buildTestApp()).get('/api/brain/health');
    expect(res.status).toBe(200);
  });

  it('GET /api/brain/health 响应 Content-Type 含 application/json', async () => {
    const res = await request(buildTestApp()).get('/api/brain/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('GET /api/brain/health 响应 body 键集合严格等于 {status, uptime_seconds, version}', async () => {
    const res = await request(buildTestApp()).get('/api/brain/health');
    expect(Object.keys(res.body).sort()).toEqual(['status', 'uptime_seconds', 'version']);
  });

  it('GET /api/brain/health 响应 body.status 严格等于 "ok"', async () => {
    const res = await request(buildTestApp()).get('/api/brain/health');
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/brain/health 响应 body.version 严格等于 package.json 的 version', async () => {
    const res = await request(buildTestApp()).get('/api/brain/health');
    expect(res.body.version).toBe(PKG_VERSION);
  });

  it('GET /api/brain/health 响应 body.uptime_seconds 是非负 finite number', async () => {
    const res = await request(buildTestApp()).get('/api/brain/health');
    expect(typeof res.body.uptime_seconds).toBe('number');
    expect(Number.isFinite(res.body.uptime_seconds)).toBe(true);
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it('GET /api/brain/health 5 个并发请求全部返回 200 且 body schema 正确', async () => {
    const app = buildTestApp();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request(app).get('/api/brain/health'))
    );
    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['status', 'uptime_seconds', 'version']);
    }
  });
});
