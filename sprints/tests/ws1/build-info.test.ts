import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgPath = resolve(__dirname, '../../../packages/brain/package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

async function makeApp(): Promise<express.Express> {
  const mod = await import('../../../packages/brain/src/routes/build-info.js');
  const router = (mod as { default: express.Router }).default;
  const app = express();
  app.use('/api/brain/build-info', router);
  return app;
}

describe('Workstream 1 — /api/brain/build-info [BEHAVIOR]', () => {
  it('returns 200 with application/json content-type', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/brain/build-info');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('body contains exactly the three keys git_sha / package_version / built_at', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/brain/build-info');
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual(['built_at', 'git_sha', 'package_version']);
  });

  it('all three fields are non-empty strings', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/brain/build-info');
    expect(typeof res.body.git_sha).toBe('string');
    expect(typeof res.body.package_version).toBe('string');
    expect(typeof res.body.built_at).toBe('string');
    expect(res.body.git_sha.length).toBeGreaterThan(0);
    expect(res.body.package_version.length).toBeGreaterThan(0);
    expect(res.body.built_at.length).toBeGreaterThan(0);
  });

  it('body.package_version equals packages/brain/package.json version field', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/brain/build-info');
    expect(typeof pkg.version).toBe('string');
    expect(pkg.version.length).toBeGreaterThan(0);
    expect(res.body.package_version).toBe(pkg.version);
  });

  it('body.built_at is a valid ISO 8601 string (round-trip equal)', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/brain/build-info');
    const v: string = res.body.built_at;
    expect(typeof v).toBe('string');
    expect(new Date(v).toISOString()).toBe(v);
  });

  it('built_at is identical across two requests within the same process', async () => {
    const app = await makeApp();
    const r1 = await request(app).get('/api/brain/build-info');
    const r2 = await request(app).get('/api/brain/build-info');
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.body.built_at).toBe(r1.body.built_at);
  });

  it('git_sha is either 40-char lowercase hex or the literal string "unknown"', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/brain/build-info');
    const sha: string = res.body.git_sha;
    expect(typeof sha).toBe('string');
    const isFullSha = /^[0-9a-f]{40}$/.test(sha);
    const isUnknown = sha === 'unknown';
    expect(isFullSha || isUnknown).toBe(true);
  });
});
