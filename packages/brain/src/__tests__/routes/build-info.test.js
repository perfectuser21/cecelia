/**
 * Route tests: /api/brain/build-info
 *
 * Covers DoD for harness task b06b5327 (logical_task_id ws1):
 *   [ARTIFACT] packages/brain/src/routes/build-info.js 文件存在
 *   [ARTIFACT] 文件 export default 是 Express Router 实例
 *   [BEHAVIOR] 模块加载不抛异常（即使运行环境无 .git）
 *   [BEHAVIOR] handler 返回的 JSON 仅含 git_sha / package_version / built_at 三键
 */
import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUILD_INFO_PATH = path.resolve(__dirname, '../../routes/build-info.js');
const PKG_JSON_PATH = path.resolve(__dirname, '../../../package.json');

describe('routes/build-info', () => {
  describe('[ARTIFACT] module surface', () => {
    it('source file exists at packages/brain/src/routes/build-info.js', () => {
      expect(fs.existsSync(BUILD_INFO_PATH)).toBe(true);
    });

    it('default export is an Express Router instance (function with .stack)', async () => {
      const mod = await import('../../routes/build-info.js');
      const router = mod.default;
      expect(router).toBeDefined();
      // Express Router is a function with a .stack array
      expect(typeof router).toBe('function');
      expect(Array.isArray(router.stack)).toBe(true);
    });

    it('does not import db.js or pg pool', () => {
      const src = fs.readFileSync(BUILD_INFO_PATH, 'utf8');
      expect(src).not.toMatch(/from\s+['"][^'"]*\bdb\.js['"]/);
      expect(src).not.toMatch(/from\s+['"]pg['"]/);
    });
  });

  describe('[BEHAVIOR] module loads cleanly even without git context', () => {
    it('importing the module does not throw', async () => {
      await expect(import('../../routes/build-info.js')).resolves.toBeDefined();
    });
  });

  describe('[BEHAVIOR] GET / handler payload shape', () => {
    let app;

    beforeAll(async () => {
      const mod = await import('../../routes/build-info.js');
      app = express();
      app.use('/build-info', mod.default);
    });

    it('returns 200 JSON', async () => {
      const res = await request(app).get('/build-info');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('payload has exactly three keys: git_sha, package_version, built_at', async () => {
      const res = await request(app).get('/build-info');
      const keys = Object.keys(res.body).sort();
      expect(keys).toEqual(['built_at', 'git_sha', 'package_version']);
    });

    it('git_sha is a non-empty string (real SHA or "unknown" fallback)', async () => {
      const res = await request(app).get('/build-info');
      expect(typeof res.body.git_sha).toBe('string');
      expect(res.body.git_sha.length).toBeGreaterThan(0);
    });

    it('package_version matches packages/brain/package.json version field', async () => {
      const pkgVersion = JSON.parse(fs.readFileSync(PKG_JSON_PATH, 'utf8')).version;
      const res = await request(app).get('/build-info');
      expect(res.body.package_version).toBe(pkgVersion);
    });

    it('built_at is an ISO 8601 timestamp string', async () => {
      const res = await request(app).get('/build-info');
      expect(typeof res.body.built_at).toBe('string');
      // ISO 8601: parses to a valid Date and round-trips
      const parsed = new Date(res.body.built_at);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
      expect(parsed.toISOString()).toBe(res.body.built_at);
    });

    it('built_at is cached at module load — two requests return identical value', async () => {
      const r1 = await request(app).get('/build-info');
      await new Promise((resolve) => setTimeout(resolve, 10));
      const r2 = await request(app).get('/build-info');
      expect(r1.body.built_at).toBe(r2.body.built_at);
    });
  });
});
