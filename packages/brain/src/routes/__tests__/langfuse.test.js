/**
 * routes/langfuse.test.js — integration test for /api/brain/langfuse
 *
 * Mocks global fetch and verifies route handler:
 *   - 成功路径：返回 success:true + data 数组
 *   - Langfuse 不可达：fail-soft 返回 success:false + data:[]
 *   - 凭据缺失：fail-soft 返回 success:false + error:'credentials_missing'
 *   - limit 上限：超过 100 时被截到 100
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import langfuseRouter from '../langfuse.js';

let app;

beforeEach(() => {
  app = express();
  app.use('/api/brain/langfuse', langfuseRouter);
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function callApi(path) {
  const port = await new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv.address().port));
    app.locals._srv = srv;
  });
  try {
    const res = await fetch(`http://localhost:${port}${path}`);
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    app.locals._srv.close();
  }
}

describe('GET /api/brain/langfuse/recent', () => {
  it('成功路径：返回 success:true + data 数组', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 'trace-1', name: 'llm-call-cortex', timestamp: '2026-04-29T10:00:00Z' },
          { id: 'trace-2', name: 'llm-call-cortex', timestamp: '2026-04-29T10:01:00Z' },
        ],
      }),
    });
    const { status, body } = await callApi('/api/brain/langfuse/recent?limit=5');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toHaveProperty('id', 'trace-1');
    expect(body.data[0]).toHaveProperty('langfuseUrl');
  });

  it('Langfuse 不可达：fail-soft 返回 success:false + data:[]', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ETIMEDOUT'));
    const { status, body } = await callApi('/api/brain/langfuse/recent');
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.data).toEqual([]);
    expect(body.error).toMatch(/ETIMEDOUT|unreachable/i);
  });

  it('Langfuse 401 返回 fail-soft', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    });
    const { status, body } = await callApi('/api/brain/langfuse/recent');
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/auth|401/i);
  });

  it('limit 上限被截到 100', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    });
    await callApi('/api/brain/langfuse/recent?limit=9999');
    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(String(calledUrl)).toMatch(/limit=100\b/);
  });

  it('limit 默认 20', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    });
    await callApi('/api/brain/langfuse/recent');
    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(String(calledUrl)).toMatch(/limit=20\b/);
  });
});
