/**
 * Workstream 1 — Brain /api/brain/build-info 端点行为契约（Round 2）
 *
 * BEHAVIOR 测试（vitest + supertest），共 8 个 it：
 *   1. GET 返回 200 + JSON 三字段（键集合严格等于）
 *   2. built_at 是合法 ISO 8601
 *   3. 连续两次请求 built_at 完全相等（启动时缓存）
 *   4. package_version 等于 packages/brain/package.json.version
 *   5. [R3] git rev-parse 抛 generic Error → git_sha === 'unknown' + 200
 *   6. [R3] git rev-parse 抛 ENOENT-coded Error → git_sha === 'unknown' + 200
 *   7. [R3] git rev-parse 抛 TypeError 子类 → git_sha === 'unknown' + 200
 *   8. [R4] 端点公开：不带任何鉴权头也返回 200（不被 internalAuth 拦截）
 *
 * 跑测：cd packages/brain && npx vitest run /workspace/sprints/tests/ws1/build-info.test.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BRAIN_PKG_JSON = resolve(__dirname, '../../../packages/brain/package.json');
const EXPECTED_VERSION = JSON.parse(readFileSync(BRAIN_PKG_JSON, 'utf8')).version;

async function buildApp() {
  const { default: router } = await import('../../../packages/brain/src/routes/build-info.js');
  const app = express();
  app.use('/api/brain/build-info', router);
  return app;
}

async function buildAppWithExecSyncMock(throwFn) {
  vi.resetModules();
  vi.doMock('child_process', () => ({
    execSync: throwFn,
    default: { execSync: throwFn },
  }));
  try {
    const { default: router } = await import('../../../packages/brain/src/routes/build-info.js');
    const app = express();
    app.use('/api/brain/build-info', router);
    return { app };
  } catch (e) {
    vi.doUnmock('child_process');
    vi.resetModules();
    throw e;
  }
}

describe('Workstream 1 — Brain /api/brain/build-info [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.doUnmock('child_process');
    vi.resetModules();
  });

  it('GET /api/brain/build-info 返回 HTTP 200 + JSON 三字段（键集合严格等于 git_sha/package_version/built_at）', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/brain/build-info');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(Object.keys(res.body).sort()).toEqual(['built_at', 'git_sha', 'package_version']);
  });

  it('built_at 是合法 ISO 8601（new Date(x).toISOString() === x）', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/brain/build-info');
    const builtAt = res.body.built_at;
    expect(typeof builtAt).toBe('string');
    expect(builtAt.length).toBeGreaterThan(0);
    expect(new Date(builtAt).toISOString()).toBe(builtAt);
  });

  it('连续两次请求 built_at 字段值完全相等（启动时缓存）', async () => {
    const app = await buildApp();
    const r1 = await request(app).get('/api/brain/build-info');
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await request(app).get('/api/brain/build-info');
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.built_at).toBe(r2.body.built_at);
  });

  it('package_version 严格等于 packages/brain/package.json 的 version 字段', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/brain/build-info');
    expect(res.body.package_version).toBe(EXPECTED_VERSION);
  });

  it('[R3] git rev-parse 抛 generic Error 时 git_sha 回退为字符串 unknown 且端点仍返回 200', async () => {
    const throwFn = vi.fn(() => { throw new Error('fatal: not a git repository'); });
    try {
      const { app } = await buildAppWithExecSyncMock(throwFn);
      const res = await request(app).get('/api/brain/build-info');
      expect(res.status).toBe(200);
      expect(res.body.git_sha).toBe('unknown');
    } finally {
      vi.doUnmock('child_process');
      vi.resetModules();
    }
  });

  it('[R3] git rev-parse 抛 ENOENT-coded Error 时 git_sha 回退为 unknown（CI 容器无 .git 场景）', async () => {
    const throwFn = vi.fn(() => {
      const err = new Error('ENOENT: no such file or directory');
      // @ts-ignore — Node.js 通常给 spawn 错误打 code
      err.code = 'ENOENT';
      err.errno = -2;
      err.syscall = 'spawnSync git';
      throw err;
    });
    try {
      const { app } = await buildAppWithExecSyncMock(throwFn);
      const res = await request(app).get('/api/brain/build-info');
      expect(res.status).toBe(200);
      expect(res.body.git_sha).toBe('unknown');
    } finally {
      vi.doUnmock('child_process');
      vi.resetModules();
    }
  });

  it('[R3] git rev-parse 抛 TypeError 子类时 git_sha 回退为 unknown（catch 不限 Error 子类）', async () => {
    const throwFn = vi.fn(() => { throw new TypeError('command argument has wrong type'); });
    try {
      const { app } = await buildAppWithExecSyncMock(throwFn);
      const res = await request(app).get('/api/brain/build-info');
      expect(res.status).toBe(200);
      expect(res.body.git_sha).toBe('unknown');
    } finally {
      vi.doUnmock('child_process');
      vi.resetModules();
    }
  });

  it('[R4] 端点是公开的：不带任何鉴权头也返回 200（不被 internalAuth 拦截）', async () => {
    const app = await buildApp();
    const res = await request(app)
      .get('/api/brain/build-info')
      .unset('Authorization')
      .unset('X-Internal-Token');
    expect(res.status).toBe(200);
    expect(res.body.git_sha).toBeDefined();
    expect(res.body.package_version).toBeDefined();
    expect(res.body.built_at).toBeDefined();
  });
});
