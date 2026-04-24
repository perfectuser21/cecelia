/**
 * Workstream 2 — Health Route Integration Smoke [BEHAVIOR]
 *
 * 覆盖 contract-draft.md:
 *  - Feature 3: Server 挂载与端到端可达性（5 个 it）
 *  - Feature 4: uptime_seconds 随时间单调不降（1 个 it）
 *
 * 策略：不启动完整 server.js（它会初始化 DB / WebSocket / tick loop），
 * 而是构造一个"最小等价 app"，把 health 路由挂载在 /api/brain/health，
 * 验证 HTTP 语义、shape、version 匹配、uptime 单调性、错误方法返回 404/405。
 * 挂载顺序（health 在 brainRoutes 之前）由 contract-dod-ws2.md 的 ARTIFACT 检查覆盖。
 *
 * 预期 Red（round 1）：`packages/brain/src/routes/health.js` 尚不存在，
 * 动态 import 失败 → 该文件所有 it() 全部 FAIL。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let app: Express;
let pkgVersion: string;

beforeAll(async () => {
  const mod = await import('../../../packages/brain/src/routes/health.js');
  const router = (mod as any).default;
  app = express();
  app.use(express.json());
  app.use('/api/brain/health', router);

  const pkgPath = resolve(__dirname, '../../../packages/brain/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkgVersion = pkg.version;
});

describe('Workstream 2 — /api/brain/health End-to-End [BEHAVIOR]', () => {
  it('GET /api/brain/health returns 200 with status/uptime_seconds/version fields', async () => {
    const res = await request(app).get('/api/brain/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('uptime_seconds');
    expect(typeof res.body.uptime_seconds).toBe('number');
    expect(res.body).toHaveProperty('version');
    expect(typeof res.body.version).toBe('string');
    expect(res.body.version.length).toBeGreaterThan(0);
  });

  it('version field equals packages/brain/package.json version field', async () => {
    const res = await request(app).get('/api/brain/health');
    expect(res.body.version).toBe(pkgVersion);
  });

  it('POST /api/brain/health returns 404 or 405, never 200 or 5xx', async () => {
    const res = await request(app).post('/api/brain/health').send({});
    expect([404, 405]).toContain(res.status);
    expect(res.status).not.toBe(200);
    expect(res.status).toBeLessThan(500);
  });

  it('PUT /api/brain/health returns 404 or 405, never 200 or 5xx', async () => {
    const res = await request(app).put('/api/brain/health').send({});
    expect([404, 405]).toContain(res.status);
    expect(res.status).not.toBe(200);
    expect(res.status).toBeLessThan(500);
  });

  it('DELETE /api/brain/health returns 404 or 405, never 200 or 5xx', async () => {
    const res = await request(app).delete('/api/brain/health');
    expect([404, 405]).toContain(res.status);
    expect(res.status).not.toBe(200);
    expect(res.status).toBeLessThan(500);
  });
});

describe('Workstream 2 — uptime_seconds Monotonicity [BEHAVIOR]', () => {
  it('uptime_seconds strictly increases between two sequential requests with 150ms gap', async () => {
    const first = await request(app).get('/api/brain/health');
    expect(first.status).toBe(200);
    const uptime1 = first.body.uptime_seconds;

    await new Promise((r) => setTimeout(r, 200));

    const second = await request(app).get('/api/brain/health');
    expect(second.status).toBe(200);
    const uptime2 = second.body.uptime_seconds;

    expect(typeof uptime1).toBe('number');
    expect(typeof uptime2).toBe('number');
    expect(uptime2).toBeGreaterThan(uptime1);
  });
});
