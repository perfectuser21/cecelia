import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import request from 'supertest';
import healthRouter from '../../../packages/brain/src/routes/health.js';

function makeApp() {
  const app = express();
  app.use('/api/brain/health', healthRouter);
  return app;
}

const BRAIN_PKG_PATH = resolve(__dirname, '../../../packages/brain/package.json');
const HEALTH_SRC_PATH = resolve(__dirname, '../../../packages/brain/src/routes/health.js');

describe('Workstream 3 — Field Invariants [BEHAVIOR]', () => {
  it('uptime_seconds strictly increases across calls separated by 1.1s', async () => {
    const app = makeApp();
    const r1 = await request(app).get('/api/brain/health');
    await new Promise((res) => setTimeout(res, 1100));
    const r2 = await request(app).get('/api/brain/health');
    expect(typeof r1.body.uptime_seconds).toBe('number');
    expect(typeof r2.body.uptime_seconds).toBe('number');
    expect(r2.body.uptime_seconds).toBeGreaterThan(r1.body.uptime_seconds);
  }, 10000);

  it('version field equals the version string in packages/brain/package.json', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/brain/health');
    const pkg = JSON.parse(readFileSync(BRAIN_PKG_PATH, 'utf8'));
    expect(typeof pkg.version).toBe('string');
    expect(pkg.version.length).toBeGreaterThan(0);
    expect(res.body.version).toBe(pkg.version);
  });

  it('does not embed the version string as a hardcoded literal in routes/health.js', () => {
    const src = readFileSync(HEALTH_SRC_PATH, 'utf8');
    const semverLiteral = /['"]\d+\.\d+\.\d+['"]/;
    expect(semverLiteral.test(src)).toBe(false);
  });

  it('5 concurrent requests return consistent version and all status=ok', async () => {
    const app = makeApp();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request(app).get('/api/brain/health')),
    );
    expect(responses.length).toBe(5);
    const versions = new Set(responses.map((r) => r.body.version));
    expect(versions.size).toBe(1);
    for (const r of responses) {
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('ok');
      expect(typeof r.body.uptime_seconds).toBe('number');
    }
  });

  it('removed the WS1 placeholder literal pending from routes/health.js', () => {
    const src = readFileSync(HEALTH_SRC_PATH, 'utf8');
    const placeholderLiteral = /['"]pending['"]/;
    expect(placeholderLiteral.test(src)).toBe(false);
  });
});
