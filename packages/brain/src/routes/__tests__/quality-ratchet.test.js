import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

vi.mock('../../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));

// 刀4-T2：GET /api/brain/quality/ratchet 返回棘轮台账（ratchet-registry.json）
const { default: qualityRouter } = await import('../quality.js');

function makeApp() {
  const app = express();
  app.use('/api/brain/quality', qualityRouter);
  return app;
}

describe('GET /api/brain/quality/ratchet 棘轮台账', () => {
  it('返回 available:true 且 registry 为数组、每项含 name/direction/guard/source', async () => {
    const res = await request(makeApp()).get('/api/brain/quality/ratchet');
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(Array.isArray(res.body.registry)).toBe(true);
    expect(res.body.registry.length).toBeGreaterThanOrEqual(5);
    for (const entry of res.body.registry) {
      expect(typeof entry.name).toBe('string');
      expect(['only_up', 'only_down']).toContain(entry.direction);
      expect(typeof entry.guard).toBe('string');
      expect(typeof entry.source).toBe('string');
    }
  });

  it.each(['读取失败', '非法JSON'])('%s时catch降级available:false且不返回500', async kind => {
    if (kind === '读取失败') readFileSync.mockImplementationOnce(() => { throw new Error('registry unavailable'); });
    else readFileSync.mockReturnValueOnce('{invalid-json');
    const res = await request(makeApp()).get('/api/brain/quality/ratchet');
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(typeof res.body.error).toBe('string');
  });
});
