/**
 * Harness v6 BEHAVIOR Test — Workstream 1: GET /api/brain/time
 *
 * 真实 HTTP fetch 断言（外部可观测行为），不 import Brain 内部任何模块。
 * 这让测试对 Generator 的实现形态完全中立：
 *   - 用 express Router + app.use('/api/brain', timeRoutes) 合规
 *   - 用 app.get('/api/brain/time', ...) 直接挂主 app 合规
 *   - 任何等价 express 机制，只要 `/api/brain/time` 返回符合硬阈值的响应，都合规
 *
 * 前置条件：
 *   Brain 进程已在 BRAIN_TEST_URL（默认 http://127.0.0.1:5221）监听。
 *   Harness v6 Final E2E 环境中 Brain 常驻运行；Generator 在 Green 阶段前必须启动 Brain。
 *
 * TDD Red/Green 语义：
 *   - 实现前：Brain 已运行但无此路由 → `GET /api/brain/time` 返回 HTTP 404
 *     → 每个 `expect(res.status).toBe(200)` 抛 AssertionError → 8 个 it 全红（真 Red）。
 *   - 实现后（三字段正确、挂载正确）→ 8 个 it 全绿（真 Green）。
 */

import { describe, it, expect } from 'vitest';

const BASE = process.env.BRAIN_TEST_URL || 'http://127.0.0.1:5221';
const ENDPOINT = `${BASE}/api/brain/time`;
const FETCH_TIMEOUT_MS = 5000;

async function fetchTime(): Promise<{ status: number; contentType: string; body: any; rawText: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, { method: 'GET', signal: ctrl.signal });
    const contentType = String(res.headers.get('content-type') || '');
    const rawText = await res.text();
    let body: any = null;
    try {
      body = JSON.parse(rawText);
    } catch {
      body = null;
    }
    return { status: res.status, contentType, body, rawText };
  } finally {
    clearTimeout(timer);
  }
}

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
const UNIX_2020_01_01 = 1577836800;

describe('Workstream 1 — GET /api/brain/time [BEHAVIOR]', () => {
  it('GET /api/brain/time 返回 HTTP 200 且 Content-Type 含 application/json', async () => {
    const r = await fetchTime();
    expect(r.status).toBe(200);
    expect(r.contentType.toLowerCase()).toContain('application/json');
  });

  it('响应 body 顶层 key 严格等于 [iso, timezone, unix]', async () => {
    const r = await fetchTime();
    expect(r.status).toBe(200);
    expect(r.body).not.toBeNull();
    expect(typeof r.body).toBe('object');
    const keys = Object.keys(r.body).sort();
    expect(keys).toEqual(['iso', 'timezone', 'unix']);
  });

  it('iso 是合法 ISO 8601 字符串且可被 Date 解析', async () => {
    const r = await fetchTime();
    expect(r.status).toBe(200);
    expect(typeof r.body.iso).toBe('string');
    expect(ISO8601_RE.test(r.body.iso)).toBe(true);
    const t = new Date(r.body.iso).getTime();
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThan(0);
  });

  it('timezone 是非空字符串', async () => {
    const r = await fetchTime();
    expect(r.status).toBe(200);
    expect(typeof r.body.timezone).toBe('string');
    expect(r.body.timezone.length).toBeGreaterThan(0);
  });

  it('unix 是合理范围内的正整数秒', async () => {
    const r = await fetchTime();
    expect(r.status).toBe(200);
    expect(Number.isInteger(r.body.unix)).toBe(true);
    expect(r.body.unix).toBeGreaterThan(0);
    expect(r.body.unix).toBeGreaterThan(UNIX_2020_01_01);
  });

  it('iso 与 unix 指向同一时刻（差值 ≤ 1 秒）', async () => {
    const r = await fetchTime();
    expect(r.status).toBe(200);
    const isoSeconds = Math.floor(new Date(r.body.iso).getTime() / 1000);
    expect(Math.abs(isoSeconds - r.body.unix)).toBeLessThanOrEqual(1);
  });

  it('连续两次调用 timezone 完全一致', async () => {
    const a = await fetchTime();
    const b = await fetchTime();
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.timezone).toBe(b.body.timezone);
  });

  it('连续两次调用 unix 单调不减', async () => {
    const a = await fetchTime();
    const b = await fetchTime();
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(Number.isInteger(a.body.unix)).toBe(true);
    expect(Number.isInteger(b.body.unix)).toBe(true);
    expect(b.body.unix - a.body.unix).toBeGreaterThanOrEqual(0);
  });
});
