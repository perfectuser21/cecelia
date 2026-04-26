/**
 * Workstream 1 — Build-Info Endpoint [BEHAVIOR]
 *
 * 真实 import 目标模块路径，通过 supertest 挂载到独立 express app 验证。
 * 不依赖 Brain 全量进程，不连真实 DB（db.js 被 mock 成 reject-on-call）。
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// db.js mock：所有 db.query 一律 reject。既阻断真实 DB 连接，
// 又便于断言 "handler 不查 DB"（mockPool.query.mock.calls.length === 0）
const mockPool = vi.hoisted(() => ({
  query: vi.fn().mockRejectedValue(new Error('build-info handler must not query DB')),
}));
vi.mock('../../../packages/brain/src/db.js', () => ({ default: mockPool }));

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN_PKG_JSON_PATH = join(__dirname, '../../../packages/brain/package.json');

function readBrainVersion(): string {
  return JSON.parse(readFileSync(BRAIN_PKG_JSON_PATH, 'utf8')).version;
}

async function loadFreshRouter() {
  vi.resetModules();
  const mod = await import('../../../packages/brain/src/routes/build-info.js');
  return mod.default;
}

function mountApp(router: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/build-info', router);
  return app;
}

describe('Workstream 1 — GET /api/brain/build-info [BEHAVIOR]', () => {
  const ORIGINAL_GIT_SHA = process.env.GIT_SHA;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GIT_SHA;
  });

  afterEach(() => {
    if (ORIGINAL_GIT_SHA === undefined) {
      delete process.env.GIT_SHA;
    } else {
      process.env.GIT_SHA = ORIGINAL_GIT_SHA;
    }
  });

  it('GET / returns 200 with version, build_time, git_sha as non-empty strings', async () => {
    const router = await loadFreshRouter();
    const app = mountApp(router);

    const res = await request(app).get('/api/brain/build-info');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(typeof res.body.version).toBe('string');
    expect(res.body.version.length).toBeGreaterThan(0);
    expect(typeof res.body.build_time).toBe('string');
    expect(res.body.build_time.length).toBeGreaterThan(0);
    expect(typeof res.body.git_sha).toBe('string');
    expect(res.body.git_sha.length).toBeGreaterThan(0);
  });

  it('version field equals packages/brain/package.json version', async () => {
    const expected = readBrainVersion();
    const router = await loadFreshRouter();
    const app = mountApp(router);

    const res = await request(app).get('/api/brain/build-info');

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(expected);
  });

  it('git_sha is "unknown" when GIT_SHA env var is unset', async () => {
    delete process.env.GIT_SHA;
    const router = await loadFreshRouter();
    const app = mountApp(router);

    const res = await request(app).get('/api/brain/build-info');

    expect(res.status).toBe(200);
    expect(res.body.git_sha).toBe('unknown');
  });

  // R3 mitigation：覆盖 GIT_SHA 被部分注入为空字符串的真实场景
  // （docker-compose / pm2 常见漂移：`export GIT_SHA=` → process.env.GIT_SHA === ""）
  // 朴素实现 `?? 'unknown'` 不会触发 fallback，本测试强制实现走 `||` 而非 `??`
  it('git_sha is "unknown" when GIT_SHA env var is empty string', async () => {
    process.env.GIT_SHA = '';
    const router = await loadFreshRouter();
    const app = mountApp(router);

    const res = await request(app).get('/api/brain/build-info');

    expect(res.status).toBe(200);
    expect(res.body.git_sha).toBe('unknown');
  });

  it('git_sha equals process.env.GIT_SHA when env var is set', async () => {
    process.env.GIT_SHA = 'abc123def456deadbeefcafebabe000011112222';
    const router = await loadFreshRouter();
    const app = mountApp(router);

    const res = await request(app).get('/api/brain/build-info');

    expect(res.status).toBe(200);
    expect(res.body.git_sha).toBe('abc123def456deadbeefcafebabe000011112222');
  });

  it('build_time is a valid ISO-8601 UTC string', async () => {
    const router = await loadFreshRouter();
    const app = mountApp(router);

    const res = await request(app).get('/api/brain/build-info');

    expect(res.status).toBe(200);
    expect(res.body.build_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    // Round-trip parseable
    const parsed = new Date(res.body.build_time);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.toISOString()).toBe(res.body.build_time);
  });

  it('build_time stays identical across two consecutive requests', async () => {
    const router = await loadFreshRouter();
    const app = mountApp(router);

    const res1 = await request(app).get('/api/brain/build-info');
    // 间隔确保如果实现错误地每次重新计算 Date.now()，会被这里抓到
    await new Promise((r) => setTimeout(r, 25));
    const res2 = await request(app).get('/api/brain/build-info');

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.build_time).toBe(res2.body.build_time);
  });

  it('handler never calls the database (db.query count = 0)', async () => {
    const router = await loadFreshRouter();
    const app = mountApp(router);

    const res = await request(app).get('/api/brain/build-info');

    expect(res.status).toBe(200);
    expect(mockPool.query).not.toHaveBeenCalled();
    expect(mockPool.query.mock.calls.length).toBe(0);
  });

  it('returns 500 with JSON error body when package.json read fails', async () => {
    // 通过 spy 重写 fs.readFileSync，仅当读取 brain 的 package.json 时抛错
    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        default: actual,
        readFileSync: vi.fn((path: any, opts: any) => {
          const p = String(path);
          if (p.endsWith('package.json') && p.includes('packages/brain')) {
            throw new Error('simulated package.json read failure');
          }
          return actual.readFileSync(path, opts);
        }),
      };
    });

    const mod = await import('../../../packages/brain/src/routes/build-info.js');
    const app = mountApp(mod.default);

    const res = await request(app).get('/api/brain/build-info');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);

    vi.doUnmock('node:fs');
  });
});
