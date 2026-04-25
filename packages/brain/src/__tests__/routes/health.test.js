import { describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';

const hoisted = vi.hoisted(() => ({
  dbFactory: vi.fn(() => ({
    default: { query: vi.fn(), connect: vi.fn(), end: vi.fn() },
    getPoolHealth: vi.fn(() => ({ total: 0, idle: 0, waiting: 0, activeCount: 0 })),
  })),
  pgFactory: vi.fn(() => {
    const Pool = vi.fn(() => ({ query: vi.fn(), connect: vi.fn(), end: vi.fn() }));
    return { default: { Pool }, Pool };
  }),
}));

vi.mock('../../db.js', () => hoisted.dbFactory());
vi.mock('pg', () => hoisted.pgFactory());

const pkg = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf-8')
);

describe('routes/health.js — health route module', () => {
  let app;
  let router;

  beforeAll(async () => {
    const mod = await import('../../routes/health.js');
    router = mod.default || mod.router;
    app = express();
    app.use('/', router);
  });

  it('exports an Express Router instance', () => {
    expect(router).toBeDefined();
    expect(typeof router).toBe('function');
    expect(router.stack).toBeDefined();
    expect(Array.isArray(router.stack)).toBe(true);
  });

  it('registers a GET / handler', () => {
    const routes = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));
    const root = routes.find((r) => r.path === '/');
    expect(root).toBeDefined();
    expect(root.methods).toContain('get');
  });

  it('GET / responds 200 with body containing exactly three keys: status, uptime_seconds, version', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['status', 'uptime_seconds', 'version']);
  });

  it('GET / response.status === "ok"', async () => {
    const res = await request(app).get('/');
    expect(res.body.status).toBe('ok');
  });

  it('GET / response.uptime_seconds is a non-negative finite number', async () => {
    const res = await request(app).get('/');
    expect(typeof res.body.uptime_seconds).toBe('number');
    expect(Number.isFinite(res.body.uptime_seconds)).toBe(true);
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it('GET / response.version equals packages/brain/package.json.version', async () => {
    const res = await request(app).get('/');
    expect(res.body.version).toBe(pkg.version);
  });

  it('does NOT import db.js (db factory never invoked)', () => {
    expect(hoisted.dbFactory).not.toHaveBeenCalled();
  });

  it('does NOT import pg (pg factory never invoked)', () => {
    expect(hoisted.pgFactory).not.toHaveBeenCalled();
  });

  it('GET / does not trigger any pg pool connection during request', async () => {
    await request(app).get('/');
    expect(hoisted.dbFactory).not.toHaveBeenCalled();
    expect(hoisted.pgFactory).not.toHaveBeenCalled();
  });
});
