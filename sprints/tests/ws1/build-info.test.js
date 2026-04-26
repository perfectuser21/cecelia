/**
 * Workstream 1 — build-info endpoint [BEHAVIOR]
 *
 * 真实 import 路由模块 + supertest，不 mock 被测对象自身。
 *
 * 设计要点：
 *  - beforeEach 执行 vi.resetModules() 隔离模块缓存：
 *      build-info.js 在模块加载时一次性确定 git_sha / built_at / package_version；
 *      ESM 默认全局缓存模块，若不重置，第二个 it 之后的 dynamic import 不会
 *      再读 process.env，导致 env 相关断言（fallback / priority）静默失效。
 *  - 每个 it 内部独立 dynamic import，确保实现缺失时每个 it 单独标红
 *    （而非顶层 import 让整个 suite 折叠成一条错误）。
 *  - 严格 3 键集合：sort 后 toEqual，挡 mutation 加多余字段。
 *  - built_at 用 ISO toISOString round-trip（挡 "2026-01-01" 这种合法但非规范化输入）。
 *  - package_version 与 packages/brain/package.json runtime 读取值严格相等。
 *  - git_sha fallback 测试：清空全部 5 个常见 SHA 注入变量，强迫触发 fallback 路径。
 *  - git_sha 优先级测试：5 个 env 变量同时设不同 sentinel，逐个删除最高优先级变量，
 *    验证次高优先级值成为新的 git_sha；最终全部删除 → 'unknown'。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN_PKG_JSON = resolve(__dirname, '../../../packages/brain/package.json');

const SHA_ENV_KEYS = ['GIT_SHA', 'GIT_COMMIT', 'COMMIT_SHA', 'SOURCE_COMMIT', 'VERCEL_GIT_COMMIT_SHA'];

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

function snapshotShaEnv() {
  const saved = {};
  for (const k of SHA_ENV_KEYS) saved[k] = process.env[k];
  return saved;
}

function restoreShaEnv(saved) {
  for (const k of SHA_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

describe('Workstream 1 — build-info endpoint [BEHAVIOR]', () => {
  beforeEach(() => {
    // 模块缓存隔离：build-info.js 在 top-level 读 env vars / Date.now()，
    // 必须每个 it 重新评估，否则 env 类断言静默失效。
    vi.resetModules();
  });

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

  it('git_sha is a non-empty string even when GIT_SHA / GIT_COMMIT / COMMIT_SHA / SOURCE_COMMIT / VERCEL_GIT_COMMIT_SHA are all unset', async () => {
    const saved = snapshotShaEnv();
    for (const k of SHA_ENV_KEYS) delete process.env[k];
    try {
      vi.resetModules();
      const app = await buildAppFromRouter();
      const res = await request(app).get('/api/brain/build-info');
      expect(typeof res.body.git_sha).toBe('string');
      expect(res.body.git_sha.length).toBeGreaterThan(0);
    } finally {
      restoreShaEnv(saved);
    }
  });

  it('git_sha resolution follows fixed priority GIT_SHA > GIT_COMMIT > COMMIT_SHA > SOURCE_COMMIT > VERCEL_GIT_COMMIT_SHA > "unknown"', async () => {
    const saved = snapshotShaEnv();
    try {
      const sentinels = {
        GIT_SHA: 'priority-marker-GIT_SHA',
        GIT_COMMIT: 'priority-marker-GIT_COMMIT',
        COMMIT_SHA: 'priority-marker-COMMIT_SHA',
        SOURCE_COMMIT: 'priority-marker-SOURCE_COMMIT',
        VERCEL_GIT_COMMIT_SHA: 'priority-marker-VERCEL_GIT_COMMIT_SHA',
      };
      // 全部设为不同 sentinel
      for (const k of SHA_ENV_KEYS) process.env[k] = sentinels[k];

      // 逐个删除最高优先级变量，验证次高优先级值接管
      for (const winner of SHA_ENV_KEYS) {
        vi.resetModules();
        const app = await buildAppFromRouter();
        const res = await request(app).get('/api/brain/build-info');
        expect(res.body.git_sha).toBe(sentinels[winner]);
        delete process.env[winner];
      }

      // 全 5 个删完 → fallback 必须是 'unknown'
      vi.resetModules();
      const app = await buildAppFromRouter();
      const res = await request(app).get('/api/brain/build-info');
      expect(res.body.git_sha).toBe('unknown');
    } finally {
      restoreShaEnv(saved);
    }
  });
});
