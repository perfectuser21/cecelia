/**
 * Workstream 1 — GET /api/brain/build-info [BEHAVIOR]
 *
 * 这是 Harness v6.0 GAN Layer 2a 的合同测试（TDD Red 阶段产物，Round 2）。
 * 目标实现：packages/brain/src/routes/build-info.js（尚未存在 → 8 it 全 FAIL）
 *
 * Generator 在合同批准后必须把本文件 **字节级原样复制** 到
 * packages/brain/src/__tests__/build-info.test.js（CI dod-structure-purity 校验）。
 *
 * Round 2 变更 vs Round 1:
 *   + it('returns identical built_at across three consecutive requests ...')
 *     防"每偶数次刷新缓存"型 mutation：N=2 idempotent 通过但 N=3 不通过的实现会被抓
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 同一文件被两个位置 import：
//   sprints/tests/ws1/build-info.test.js → ../../../packages/brain/...
//   packages/brain/src/__tests__/build-info.test.js → ../routes/build-info.js + ../../package.json
// 通过解析 import.meta.url 自动判别落点
const isSprintCopy = __dirname.includes(`${'sprints'}/tests/ws1`)
  || __dirname.endsWith(`${'sprints'}/tests/ws1`);

const ROUTER_SPEC = isSprintCopy
  ? '../../../packages/brain/src/routes/build-info.js'
  : '../routes/build-info.js';

const BRAIN_PKG_PATH = isSprintCopy
  ? resolve(__dirname, '../../../packages/brain/package.json')
  : resolve(__dirname, '../../package.json');

// 注意：brain 是 ESM 包（"type":"module"），不能用 require('packages/brain/package.json') —— vitest ESM 加载下会抛 ERR_REQUIRE_ESM 风格错误。
// 用 fs.readFileSync + JSON.parse 是合同硬阈值固定的兼容写法（见 contract-draft.md 硬阈值）。
const brainPkg = JSON.parse(readFileSync(BRAIN_PKG_PATH, 'utf8'));

describe('Workstream 1 — GET /api/brain/build-info [BEHAVIOR]', () => {
  it('responds 200 with Content-Type application/json', async () => {
    const { default: router } = await import(ROUTER_SPEC);
    const app = express();
    app.use('/api/brain/build-info', router);
    const res = await request(app).get('/api/brain/build-info');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('responds with body containing exactly the three keys git_sha, package_version, built_at', async () => {
    const { default: router } = await import(ROUTER_SPEC);
    const app = express();
    app.use('/api/brain/build-info', router);
    const res = await request(app).get('/api/brain/build-info');
    expect(Object.keys(res.body).sort()).toEqual(
      ['built_at', 'git_sha', 'package_version'],
    );
  });

  it('returns package_version equal to packages/brain/package.json version', async () => {
    const { default: router } = await import(ROUTER_SPEC);
    const app = express();
    app.use('/api/brain/build-info', router);
    const res = await request(app).get('/api/brain/build-info');
    expect(res.body.package_version).toBe(brainPkg.version);
    expect(typeof brainPkg.version).toBe('string');
    expect(brainPkg.version.length).toBeGreaterThan(0);
  });

  it('returns built_at as a valid ISO 8601 string that round-trips through Date', async () => {
    const { default: router } = await import(ROUTER_SPEC);
    const app = express();
    app.use('/api/brain/build-info', router);
    const res = await request(app).get('/api/brain/build-info');
    const builtAt = res.body.built_at;
    expect(typeof builtAt).toBe('string');
    expect(builtAt.length).toBeGreaterThan(0);
    expect(new Date(builtAt).toISOString()).toBe(builtAt);
  });

  it('returns identical built_at across two requests in the same process', async () => {
    const { default: router } = await import(ROUTER_SPEC);
    const app = express();
    app.use('/api/brain/build-info', router);
    const res1 = await request(app).get('/api/brain/build-info');
    const res2 = await request(app).get('/api/brain/build-info');
    expect(res1.body.built_at).toBe(res2.body.built_at);
    // Sanity: 不允许实现把 built_at 设成 undefined → undefined === undefined 也会通过
    expect(typeof res1.body.built_at).toBe('string');
    expect(res1.body.built_at.length).toBeGreaterThan(0);
  });

  it('returns identical built_at across three consecutive requests in the same process', async () => {
    // Round 2 新增：防"每偶数次刷新缓存"型 mutation
    // 例：实现写成 `let counter = 0; if (++counter % 2 === 0) BUILT_AT = new Date().toISOString();`
    // → N=2 测试通过（res1 与 res2 不同次数下都是同一缓存值）但 N=3 抓住第 3 次刷新
    const { default: router } = await import(ROUTER_SPEC);
    const app = express();
    app.use('/api/brain/build-info', router);
    const res1 = await request(app).get('/api/brain/build-info');
    const res2 = await request(app).get('/api/brain/build-info');
    const res3 = await request(app).get('/api/brain/build-info');
    expect(res1.body.built_at).toBe(res2.body.built_at);
    expect(res2.body.built_at).toBe(res3.body.built_at);
    expect(res1.body.built_at).toBe(res3.body.built_at);
    expect(typeof res1.body.built_at).toBe('string');
    expect(res1.body.built_at.length).toBeGreaterThan(0);
  });

  it('returns git_sha matching either /^[0-9a-f]{7,40}$/ or the literal "unknown"', async () => {
    const { default: router } = await import(ROUTER_SPEC);
    const app = express();
    app.use('/api/brain/build-info', router);
    const res = await request(app).get('/api/brain/build-info');
    const sha = res.body.git_sha;
    expect(typeof sha).toBe('string');
    expect(sha.length).toBeGreaterThan(0);
    const ok = sha === 'unknown' || /^[0-9a-f]{7,40}$/.test(sha);
    expect(ok).toBe(true);
  });

  describe('git_sha fallback when child_process.execSync throws', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.doUnmock('node:child_process');
      vi.doUnmock('child_process');
      vi.resetModules();
    });

    it('returns git_sha === "unknown" when child_process.execSync throws at module load', async () => {
      const failingExecSync = () => {
        throw new Error('git: command not found');
      };
      // 同时拦截裸 'child_process' 和 'node:child_process'，覆盖两种 import 写法
      vi.doMock('child_process', () => ({
        execSync: failingExecSync,
        default: { execSync: failingExecSync },
      }));
      vi.doMock('node:child_process', () => ({
        execSync: failingExecSync,
        default: { execSync: failingExecSync },
      }));

      const { default: router } = await import(`${ROUTER_SPEC}?fallback`);
      const app = express();
      app.use('/api/brain/build-info', router);
      const res = await request(app).get('/api/brain/build-info');
      expect(res.status).toBe(200);
      expect(res.body.git_sha).toBe('unknown');
    });
  });
});
