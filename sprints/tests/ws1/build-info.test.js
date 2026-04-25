/**
 * Workstream 1 — Brain /api/brain/build-info 端点行为契约
 *
 * BEHAVIOR 测试（vitest + supertest）：
 *   1. GET 返回 200 + JSON 三字段（键集合严格等于）
 *   2. built_at 是合法 ISO 8601
 *   3. 连续两次请求 built_at 完全相等（启动时缓存）
 *   4. package_version 等于 packages/brain/package.json.version
 *   5. git rev-parse 抛异常时 git_sha === 'unknown' 且仍返回 200
 *
 * 跑测：cd packages/brain && npx vitest run /workspace/sprints/tests/ws1/build-info.test.js
 */

import { describe, it, expect, vi } from 'vitest';
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

describe('Workstream 1 — Brain /api/brain/build-info [BEHAVIOR]', () => {
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

  it('git rev-parse 抛异常时 git_sha 回退为字符串 unknown 且端点仍返回 200', async () => {
    vi.resetModules();
    const throwFn = vi.fn(() => { throw new Error('fatal: not a git repository'); });
    vi.doMock('child_process', () => ({
      execSync: throwFn,
      default: { execSync: throwFn },
    }));
    try {
      const { default: router } = await import('../../../packages/brain/src/routes/build-info.js');
      const app = express();
      app.use('/api/brain/build-info', router);
      const res = await request(app).get('/api/brain/build-info');
      expect(res.status).toBe(200);
      expect(res.body.git_sha).toBe('unknown');
    } finally {
      vi.doUnmock('child_process');
      vi.resetModules();
    }
  });
});
