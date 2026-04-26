/**
 * Workstream 1 — build-info endpoint [BEHAVIOR]
 *
 * 真实 import 路由模块 + supertest，不 mock 被测对象自身。
 *
 * 设计要点：
 *  - 每个 it 内部独立 dynamic import，确保实现缺失时每个 it 单独标红
 *    （而非顶层 import 让整个 suite 折叠成一条错误）
 *  - 严格 3 键集合：sort 后 toEqual，挡 mutation 加多余字段
 *  - built_at 用 ISO toISOString round-trip（挡 "2026-01-01" 这种合法但非规范化输入）
 *  - package_version 与 packages/brain/package.json runtime 读取值严格相等
 *  - git_sha fallback 测试：清空常见 SHA 注入变量，强迫触发 fallback 路径
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN_PKG_JSON = resolve(__dirname, '../../../packages/brain/package.json');

async function buildAppFromRouter() {
  const mod = await import('../../../packages/brain/src/routes/build-info.js');
  const router = mod.default;
  const app = express();
  app.use('/api/brain/build-info', router);
  return app;
}

function readPkgVersion() {
  return JSON.parse(readFileSync(BRAIN_PKG_JSON, 'utf8')).version;
}

describe('Workstream 1 — build-info endpoint [BEHAVIOR]', () => {
  it('GET /api/brain/build-info returns 200 with content-type application/json', async () => {
    const app = await buildAppFromRouter();
    const res = await request(app).get('/api/brain/build-info');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('response body has own property git_sha', async () => {
    const app = await buildAppFromRouter();
    const res = await request(app).get('/api/brain/build-info');
    expect(Object.prototype.hasOwnProperty.call(res.body, 'git_sha')).toBe(true);
  });

  it('response body has own property package_version', async () => {
    const app = await buildAppFromRouter();
    const res = await request(app).get('/api/brain/build-info');
    expect(Object.prototype.hasOwnProperty.call(res.body, 'package_version')).toBe(true);
  });

  it('response body has own property built_at', async () => {
    const app = await buildAppFromRouter();
    const res = await request(app).get('/api/brain/build-info');
    expect(Object.prototype.hasOwnProperty.call(res.body, 'built_at')).toBe(true);
  });

  it('responds with exactly three own keys: git_sha / package_version / built_at (no extras)', async () => {
    const app = await buildAppFromRouter();
    const res = await request(app).get('/api/brain/build-info');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['built_at', 'git_sha', 'package_version']);
  });

  it('package_version exactly equals the version field in packages/brain/package.json', async () => {
    const app = await buildAppFromRouter();
    const expected = readPkgVersion();
    expect(typeof expected).toBe('string');
    expect(expected.length).toBeGreaterThan(0);
    const res = await request(app).get('/api/brain/build-info');
    expect(res.body.package_version).toBe(expected);
  });

  it('built_at is a stable ISO 8601 string (round-trip via new Date().toISOString() is identity)', async () => {
    const app = await buildAppFromRouter();
    const res = await request(app).get('/api/brain/build-info');
    const original = res.body.built_at;
    expect(typeof original).toBe('string');
    const parsed = new Date(original);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.toISOString()).toBe(original);
  });

  it('git_sha is a non-empty string even when common SHA env vars are unset', async () => {
    // 强制制造"git 不可得"环境：清掉常见 SHA 注入变量，逼出 fallback 路径。
    const cleared = ['GIT_SHA', 'GIT_COMMIT', 'COMMIT_SHA', 'SOURCE_COMMIT', 'VERCEL_GIT_COMMIT_SHA'];
    const saved = {};
    for (const k of cleared) { saved[k] = process.env[k]; delete process.env[k]; }
    try {
      const app = await buildAppFromRouter();
      const res = await request(app).get('/api/brain/build-info');
      expect(typeof res.body.git_sha).toBe('string');
      expect(res.body.git_sha.length).toBeGreaterThan(0);
    } finally {
      for (const k of cleared) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});
