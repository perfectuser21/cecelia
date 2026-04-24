/**
 * GET /api/brain/health — 轻量健康检查端点
 *
 * 合同（Harness Initiative bb245cb4 / ws1 / task a930d4dd）：
 *  - [ARTIFACT] packages/brain/src/routes/health.js 存在，导出 Express Router
 *  - [BEHAVIOR] GET / 响应 body 恰好含 status/uptime_seconds/version 三键
 *  - [BEHAVIOR] status === 'ok'；uptime_seconds 为非负 number；
 *               version === packages/brain/package.json.version
 *  - [BEHAVIOR] 不触发 db.js / pg pool 的任何 import-time 或请求期连接
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// 追踪 health 模块是否（直接或间接）触发 db.js / pg 的加载
const { loadSpy } = vi.hoisted(() => ({
  loadSpy: { dbLoaded: false, pgLoaded: false },
}));

vi.mock('../../db.js', () => {
  loadSpy.dbLoaded = true;
  return {
    default: { query: vi.fn(), connect: vi.fn() },
    getPoolHealth: vi.fn(() => ({ total: 0, idle: 0, waiting: 0, activeCount: 0 })),
  };
});

vi.mock('pg', () => {
  loadSpy.pgLoaded = true;
  class Pool {
    constructor() {
      this.totalCount = 0;
      this.idleCount = 0;
      this.waitingCount = 0;
    }
    query = vi.fn();
    connect = vi.fn();
    on = vi.fn();
    end = vi.fn();
  }
  return { default: { Pool }, Pool };
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = JSON.parse(
  readFileSync(resolve(__dirname, '../../../package.json'), 'utf-8')
).version;

describe('routes/health', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    loadSpy.dbLoaded = false;
    loadSpy.pgLoaded = false;

    const healthRouter = (await import('../../routes/health.js')).default;
    app = express();
    app.use('/api/brain/health', healthRouter);
  });

  it('[ARTIFACT] 默认导出一个 Express Router 实例', async () => {
    const mod = await import('../../routes/health.js');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
    expect(typeof mod.default.use).toBe('function');
    expect(typeof mod.default.get).toBe('function');
    expect(Array.isArray(mod.default.stack)).toBe(true);
  });

  it('[BEHAVIOR] GET / 响应 body 恰好含 status/uptime_seconds/version 三键', async () => {
    const res = await request(app).get('/api/brain/health');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['status', 'uptime_seconds', 'version'].sort()
    );
  });

  it('[BEHAVIOR] status 固定为字符串 "ok"', async () => {
    const res = await request(app).get('/api/brain/health');
    expect(res.body.status).toBe('ok');
  });

  it('[BEHAVIOR] uptime_seconds 为非负有限 number', async () => {
    const res = await request(app).get('/api/brain/health');
    expect(typeof res.body.uptime_seconds).toBe('number');
    expect(Number.isFinite(res.body.uptime_seconds)).toBe(true);
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it('[BEHAVIOR] version 等于 packages/brain/package.json.version', async () => {
    const res = await request(app).get('/api/brain/health');
    expect(res.body.version).toBe(PKG_VERSION);
  });

  it('[BEHAVIOR] import-time 不触发 db.js 的加载', () => {
    // beforeEach 已 resetModules + 重新 import health.js；
    // 若 health.js 直接/间接 import 了 db.js，mock factory 会把 dbLoaded 置 true
    expect(loadSpy.dbLoaded).toBe(false);
  });

  it('[BEHAVIOR] import-time 不触发 pg pool 的构造', () => {
    expect(loadSpy.pgLoaded).toBe(false);
  });

  it('[BEHAVIOR] 请求期不调用 db.query / db.connect', async () => {
    // 单独 import 仅为拿到 spy（此操作本身不算 health 模块行为）
    const db = (await import('../../db.js')).default;
    db.query.mockClear();
    db.connect.mockClear();

    await request(app).get('/api/brain/health');

    expect(db.query).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();
  });
});
