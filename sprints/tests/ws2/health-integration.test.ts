/**
 * Workstream 2 — Health Route Integration Smoke [BEHAVIOR]
 *
 * 覆盖 contract-draft.md:
 *  - Feature 3: Server 挂载与端到端可达性（5 个 it）
 *  - Feature 4: uptime_seconds 随时间单调不降（1 个 it）
 *
 * Round 2 强化：
 *   1. 依赖边界：WS2 的 import 目标是 WS1 交付的 `packages/brain/src/routes/health.js`。
 *      Phase B 派发时 task-plan.json 必须写 depends_on: [ws1]；WS2 分支 rebase 必须
 *      pull WS1 合并后的 main，否则 supertest 会在 import 阶段爆（Reviewer 反馈 #1）。
 *   2. 断言级 Red：beforeAll 用 try/catch 吞掉 import 错误，router/pkgVersion
 *      失败时设为 null/''，app 仍正常构造。每个 it 进入执行后断言行 FAIL，
 *      不依赖 "suite 不进入执行" 这种弱 red（Reviewer 反馈 #4）。
 *   3. 空 stub 禁用：Generator 不得返回空对象 / 204 / hardcode 常量绕过——
 *      contract 同时断言 version===package.json.version（外部文件联动）、
 *      uptime 单调递增（时间联动）、POST→404/405（方法语义），三维锁定，空 stub 必翻车。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let app: Express;
let pkgVersion: string = '';
let importError: Error | null = null;

beforeAll(async () => {
  let router: any = null;
  try {
    const mod = await import('../../../packages/brain/src/routes/health.js');
    router = (mod as any).default;
  } catch (e) {
    importError = e as Error;
    router = null;
  }
  app = express();
  app.use(express.json());
  if (router) {
    app.use('/api/brain/health', router);
  }

  try {
    const pkgPath = resolve(__dirname, '../../../packages/brain/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkgVersion = pkg.version || '';
  } catch {
    pkgVersion = '';
  }
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
    expect(res.status).toBe(200);
    expect(pkgVersion.length).toBeGreaterThan(0);
    expect(res.body.version).toBe(pkgVersion);
  });

  it('POST /api/brain/health returns 404 or 405, never 200 or 5xx', async () => {
    const probe = await request(app).get('/api/brain/health');
    expect(probe.status).toBe(200);
    const res = await request(app).post('/api/brain/health').send({});
    expect([404, 405]).toContain(res.status);
    expect(res.status).not.toBe(200);
    expect(res.status).toBeLessThan(500);
  });

  it('PUT /api/brain/health returns 404 or 405, never 200 or 5xx', async () => {
    const probe = await request(app).get('/api/brain/health');
    expect(probe.status).toBe(200);
    const res = await request(app).put('/api/brain/health').send({});
    expect([404, 405]).toContain(res.status);
    expect(res.status).not.toBe(200);
    expect(res.status).toBeLessThan(500);
  });

  it('DELETE /api/brain/health returns 404 or 405, never 200 or 5xx', async () => {
    const probe = await request(app).get('/api/brain/health');
    expect(probe.status).toBe(200);
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
