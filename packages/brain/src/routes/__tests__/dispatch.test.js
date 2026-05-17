/**
 * routes/__tests__/dispatch.test.js — lint-test-pairing stub + 行为验证
 *
 * 覆盖 routes/dispatch.js 的 buildRecentDispatchEventsHandler 函数
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { buildRecentDispatchEventsHandler } from '../dispatch.js';

describe('routes/dispatch.js 静态验证', () => {
  it('routes/dispatch.js 含 GET /dispatch/recent 路由注册', () => {
    const src = fs.readFileSync(new URL('../dispatch.js', import.meta.url), 'utf8');
    expect(src).toMatch(/dispatch\/recent/);
  });

  it('routes/dispatch.js 导出 buildRecentDispatchEventsHandler', () => {
    const src = fs.readFileSync(new URL('../dispatch.js', import.meta.url), 'utf8');
    expect(src).toMatch(/export function buildRecentDispatchEventsHandler/);
  });

  it('routes/dispatch.js 使用 ORDER BY created_at DESC', () => {
    const src = fs.readFileSync(new URL('../dispatch.js', import.meta.url), 'utf8');
    expect(src).toMatch(/ORDER BY created_at DESC/);
  });
});

describe('buildRecentDispatchEventsHandler', () => {
  it('默认 limit=20，返回 events 数组', async () => {
    const rows = [{ id: '1', event_type: 'dispatched', reason: null, task_id: null, created_at: new Date().toISOString() }];
    const pool = { query: vi.fn().mockResolvedValue({ rows }) };

    const handler = buildRecentDispatchEventsHandler(pool);
    const req = { query: {} };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      events: rows,
      limit: 20,
      total: 1,
    }));
    expect(pool.query.mock.calls[0][1]).toContain(20);
  });

  it('DB 报错返回 500', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('DB down')) };
    const handler = buildRecentDispatchEventsHandler(pool);
    const req = { query: {} };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });
});
