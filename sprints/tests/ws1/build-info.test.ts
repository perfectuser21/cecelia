import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../../../');

const PKG_VERSION: string = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'packages/brain/package.json'), 'utf-8'),
).version;

const ROUTE_REL_FROM_TEST = '../../../packages/brain/src/routes/build-info.js';
const ROUTE_ABS = resolve(REPO_ROOT, 'packages/brain/src/routes/build-info.js');

async function loadFreshApp(envOverrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(envOverrides)) {
    saved[k] = process.env[k];
    if (envOverrides[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = envOverrides[k] as string;
    }
  }
  const mod: any = await import(ROUTE_REL_FROM_TEST);
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
  const router = mod.default ?? mod.router;
  const app = express();
  app.use('/api/brain/build-info', router);
  return app;
}

describe('Workstream 1 — GET /api/brain/build-info [BEHAVIOR]', () => {
  it('returns HTTP 200 on GET /api/brain/build-info', async () => {
    const app = await loadFreshApp();
    const res = await request(app).get('/api/brain/build-info');
    expect(res.status).toBe(200);
  });

  it('returns JSON body with exactly three keys: built_at, git_sha, package_version', async () => {
    const app = await loadFreshApp();
    const res = await request(app).get('/api/brain/build-info');
    expect(Object.keys(res.body).sort()).toEqual(['built_at', 'git_sha', 'package_version']);
  });

  it('returns package_version equal to packages/brain/package.json.version', async () => {
    const app = await loadFreshApp();
    const res = await request(app).get('/api/brain/build-info');
    expect(res.body.package_version).toBe(PKG_VERSION);
  });

  it('returns identical built_at across two consecutive requests (cached at module load)', async () => {
    const app = await loadFreshApp();
    const r1 = await request(app).get('/api/brain/build-info');
    const r2 = await request(app).get('/api/brain/build-info');
    expect(r2.body.built_at).toBe(r1.body.built_at);
  });

  it('returns built_at as a valid ISO 8601 UTC timestamp', async () => {
    const app = await loadFreshApp();
    const res = await request(app).get('/api/brain/build-info');
    const v: string = res.body.built_at;
    expect(typeof v).toBe('string');
    expect(new Date(v).toISOString()).toBe(v);
  });

  it('returns git_sha equal to GIT_SHA env value when set at module load', async () => {
    const app = await loadFreshApp({ GIT_SHA: 'cafebabe123' });
    const res = await request(app).get('/api/brain/build-info');
    expect(res.body.git_sha).toBe('cafebabe123');
  });

  it('returns git_sha equal to "unknown" when GIT_SHA env is empty string at module load', async () => {
    const app = await loadFreshApp({ GIT_SHA: '' });
    const res = await request(app).get('/api/brain/build-info');
    expect(res.body.git_sha).toBe('unknown');
  });

  it('returns 200 with non-empty git_sha string when GIT_SHA env is unset (no throw)', async () => {
    const app = await loadFreshApp({ GIT_SHA: undefined });
    const res = await request(app).get('/api/brain/build-info');
    expect(res.status).toBe(200);
    expect(typeof res.body.git_sha).toBe('string');
    expect(res.body.git_sha.length).toBeGreaterThan(0);
  });
});
