/**
 * Workstream 1 — GET /api/brain/build-info [BEHAVIOR]
 *
 * Harness v9 GAN Layer 2a 合同测试（TDD Red 阶段产物）。
 * 目标实现：packages/brain/src/routes/build-info.js（尚未存在 → 全部 it FAIL）
 *
 * 双落点设计（通过 import.meta.url 自动判别）:
 *   sprints/tests/ws1/build-info.test.js                 → ../../../packages/brain/...
 *   packages/brain/src/__tests__/build-info.test.js      → ../routes/build-info.js + ../../package.json
 *
 * 这样 Generator 在合同批准后可把本文件 **字节级原样复制** 到生产路径，
 * 无需改一个字符即可在两个位置同时跑（CI dod-structure-purity 校验）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isSprintCopy =
  __dirname.includes(`${'sprints'}/tests/ws1`) ||
  __dirname.endsWith(`${'sprints'}/tests/ws1`);

const ROUTER_SPEC = isSprintCopy
  ? '../../../packages/brain/src/routes/build-info.js'
  : '../routes/build-info.js';

const BRAIN_PKG_PATH = isSprintCopy
  ? resolve(__dirname, '../../../packages/brain/package.json')
  : resolve(__dirname, '../../package.json');

const brainPkg = JSON.parse(readFileSync(BRAIN_PKG_PATH, 'utf8'));

async function loadAppFresh(suffix = '') {
  const { default: router } = await import(`${ROUTER_SPEC}${suffix}`);
  const app = express();
  app.use('/api/brain/build-info', router);
  return app;
}

describe('Workstream 1 — GET /api/brain/build-info [BEHAVIOR]', () => {
  it('GET /api/brain/build-info returns status 200 with application/json content-type', async () => {
    const app = await loadAppFresh();
    const res = await request(app).get('/api/brain/build-info');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('response body has exactly three keys: built_at, git_sha, package_version', async () => {
    const app = await loadAppFresh();
    const res = await request(app).get('/api/brain/build-info');
    expect(typeof res.body).toBe('object');
    expect(res.body).not.toBeNull();
    expect(Array.isArray(res.body)).toBe(false);
    expect(Object.keys(res.body).sort()).toEqual([
      'built_at',
      'git_sha',
      'package_version',
    ]);
  });

  it('package_version equals packages/brain/package.json version field', async () => {
    const app = await loadAppFresh();
    const res = await request(app).get('/api/brain/build-info');
    expect(typeof brainPkg.version).toBe('string');
    expect(brainPkg.version.length).toBeGreaterThan(0);
    expect(res.body.package_version).toBe(brainPkg.version);
  });

  it('built_at is a valid ISO 8601 timestamp (round-trip identical)', async () => {
    const app = await loadAppFresh();
    const res = await request(app).get('/api/brain/build-info');
    const builtAt = res.body.built_at;
    expect(typeof builtAt).toBe('string');
    expect(builtAt.length).toBeGreaterThan(0);
    expect(new Date(builtAt).toISOString()).toBe(builtAt);
  });

  it('returns identical built_at across three consecutive requests within the same process', async () => {
    const app = await loadAppFresh();
    const r1 = await request(app).get('/api/brain/build-info');
    const r2 = await request(app).get('/api/brain/build-info');
    const r3 = await request(app).get('/api/brain/build-info');
    expect(typeof r1.body.built_at).toBe('string');
    expect(r1.body.built_at.length).toBeGreaterThan(0);
    expect(r2.body.built_at).toBe(r1.body.built_at);
    expect(r3.body.built_at).toBe(r1.body.built_at);
    expect(r3.body.built_at).toBe(r2.body.built_at);
  });

  it('git_sha matches /^([0-9a-f]{40}|unknown)$/', async () => {
    const app = await loadAppFresh();
    const res = await request(app).get('/api/brain/build-info');
    const sha = res.body.git_sha;
    expect(typeof sha).toBe('string');
    expect(sha).toMatch(/^([0-9a-f]{40}|unknown)$/);
  });

  describe('git_sha fallback when child_process.execSync throws', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.doUnmock('child_process');
      vi.doUnmock('node:child_process');
      vi.resetModules();
    });

    it('git_sha falls back to "unknown" when git rev-parse HEAD fails', async () => {
      const failingExecSync = () => {
        throw new Error('git: command not found');
      };
      vi.doMock('child_process', () => ({
        execSync: failingExecSync,
        default: { execSync: failingExecSync },
      }));
      vi.doMock('node:child_process', () => ({
        execSync: failingExecSync,
        default: { execSync: failingExecSync },
      }));

      const app = await loadAppFresh('?fallback');
      const res = await request(app).get('/api/brain/build-info');
      expect(res.status).toBe(200);
      expect(res.body.git_sha).toBe('unknown');
    });
  });
});
