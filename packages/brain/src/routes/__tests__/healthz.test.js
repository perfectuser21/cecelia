/**
 * GET /api/brain/healthz 测试
 * 验证：DB ok + tick alive → status:ok + 200
 *       DB error → status:degraded/critical + 503
 *       db_error 字段脱敏（不含连接字符串）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── vi.hoisted 确保 mock 变量在 hoisting 阶段就初始化 ────────
const { mockConnect, mockQuery, mockRelease } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockQuery: vi.fn(),
  mockRelease: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  default: { connect: mockConnect, query: mockQuery }
}));

vi.mock('../tick.js', () => ({ getTickStatus: vi.fn() }));
vi.mock('../focus.js', () => ({ getDailyFocus: vi.fn(), setDailyFocus: vi.fn(), clearDailyFocus: vi.fn(), getFocusSummary: vi.fn() }));
vi.mock('./shared.js', () => ({ getActivePolicy: vi.fn(), getWorkingMemory: vi.fn(), getTopTasks: vi.fn(), getRecentDecisions: vi.fn(), IDEMPOTENCY_TTL: 60, ALLOWED_ACTIONS: [] }));
vi.mock('../nightly-orchestrator.js', () => ({ getNightlyOrchestratorStatus: vi.fn() }));
vi.mock('../websocket.js', () => ({ default: { emit: vi.fn() }, WS_EVENTS: {} }));
vi.mock('../selfcheck.js', () => ({ EXPECTED_SCHEMA_VERSION: '1' }));
vi.mock('fs', () => ({ readFileSync: () => JSON.stringify({ version: '1.0.0' }) }));

const { default: statusRouter } = await import('../status.js');
import express from 'express';
import supertest from 'supertest';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', statusRouter);
  return app;
}

const RECENT_TICK = new Date(Date.now() - 60_000).toISOString(); // 1分钟前
const STALE_TICK  = new Date(Date.now() - 8 * 60_000).toISOString(); // 8分钟前（> 6min 阈值）

beforeEach(() => {
  vi.resetAllMocks(); // 清除所有 mock 实现，确保每个测试从干净状态开始
  mockRelease.mockReturnValue(undefined);
  // 默认：DB 连接成功，返回空 working_memory 行
  mockConnect.mockResolvedValue({ query: vi.fn().mockResolvedValue({}), release: mockRelease });
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('GET /api/brain/healthz', () => {
  it('DB ok + tick alive → status:ok + HTTP 200', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ value_json: { timestamp: RECENT_TICK } }]
    });

    const res = await supertest(makeApp()).get('/api/brain/healthz');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('connected');
    expect(res.body.tick).toBe('alive');
    expect(res.body.last_tick_at).toBe(RECENT_TICK);
    expect(res.body.checked_at).toBeDefined();
    expect(res.body.db_error).toBeUndefined();
  });

  it('DB ok + tick dead（> 6min）→ status:degraded + HTTP 503', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ value_json: { timestamp: STALE_TICK } }]
    });

    const res = await supertest(makeApp()).get('/api/brain/healthz');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.tick).toBe('dead');
  });

  it('DB error → status:critical + HTTP 503', async () => {
    mockConnect.mockRejectedValue(new Error('connection_timeout'));

    const res = await supertest(makeApp()).get('/api/brain/healthz');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('critical');
    expect(res.body.db).toBe('error');
    expect(res.body.db_error).toBe('connection_timeout');
  });

  it('db_error 不含连接字符串（脱敏验证）', async () => {
    mockConnect.mockRejectedValue(new Error('password authentication failed for postgres://user:secret@localhost/db'));

    const res = await supertest(makeApp()).get('/api/brain/healthz');

    expect(res.body.db_error).toBeDefined();
    expect(res.body.db_error).not.toMatch(/postgres:\/\//);
    expect(res.body.db_error).not.toMatch(/secret/);
  });

  it('tick_last 不存在 → tick:unknown，状态 degraded', async () => {
    // beforeEach 已设 mockQuery 返回 { rows: [] }，无需重复设置

    const res = await supertest(makeApp()).get('/api/brain/healthz');

    expect(res.status).toBe(503);
    expect(res.body.tick).toBe('unknown');
    expect(res.body.status).toBe('degraded');
  });
});
