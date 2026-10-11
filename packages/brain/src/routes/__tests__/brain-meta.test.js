/**
 * Device Lock API 路由测试（brain-meta.js 尾部 Device Lock 段）
 *
 * 钉住三件事：
 * 1. POST /device-locks/acquire 第一条 SQL 必须是单条 UPDATE ... RETURNING
 *    （原子抢锁，消灭旧 check-then-act 的 SELECT 先行竞态）
 * 2. acquire 对 unknown device（UPDATE 0 行 + 补查 SELECT 0 行）→ 404 'Unknown device'
 * 3. POST /device-locks/register 发 INSERT ... ON CONFLICT (device_name) DO UPDATE，
 *    SET 只碰 host/device_type，绝不碰 locked_by（重注册不得偷锁）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../../llm-caller.js', () => ({ callLLM: vi.fn() }));
vi.mock('../../user-profile.js', () => ({
  loadUserProfile: vi.fn(),
  upsertUserProfile: vi.fn(),
}));
vi.mock('../../orchestrator-realtime.js', () => ({
  getRealtimeConfig: vi.fn(),
  handleRealtimeTool: vi.fn(),
}));
vi.mock('../../model-profile.js', () => ({
  loadActiveProfile: vi.fn(),
  getActiveProfile: vi.fn(),
  switchProfile: vi.fn(),
  listProfiles: vi.fn(),
  updateAgentModel: vi.fn(),
  batchUpdateAgentModels: vi.fn(),
  updateAgentCascade: vi.fn(),
}));
vi.mock('../../account-usage.js', () => ({
  getAccountUsage: vi.fn(),
  selectBestAccount: vi.fn(),
}));
vi.mock('../../websocket.js', () => ({
  default: { emit: vi.fn() },
  WS_EVENTS: {},
}));
vi.mock('../../orchestrator-chat.js', () => ({
  handleChat: vi.fn(),
  handleChatStream: vi.fn(),
}));
// 旁路报警（任务 865b502c）：acquire 成功后异步记持有者；这里替成假函数，不占 pool.query 计数。
vi.mock('../../bypass-audit.js', () => ({
  noteDeviceLockAcquire: vi.fn().mockResolvedValue({ bypass: false }),
}));

let app;
let pool;

beforeEach(async () => {
  vi.clearAllMocks();
  pool = (await import('../../db.js')).default;
  const brainMetaRoutes = (await import('../brain-meta.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/brain', brainMetaRoutes);
});

describe('POST /api/brain/device-locks/acquire', () => {
  it('抢锁成功 → 把 owner/task_id/run_id/host 交给旁路审计（持有者追不到 Brain 任务即记旁路事件）', async () => {
    const { noteDeviceLockAcquire } = await import('../../bypass-audit.js');
    pool.query.mockResolvedValueOnce({ rows: [{ device_name: 'S1', locked_by: 'outreach-tick:xian-m4:1:2' }], rowCount: 1 });
    const res = await request(app)
      .post('/api/brain/device-locks/acquire')
      .send({ device_name: 'S1', locked_by: 'outreach-tick:xian-m4:1:2', task_id: 't-1', run_id: 'r-1', host: 'xian-m4' });
    expect(res.status).toBe(200);
    expect(noteDeviceLockAcquire).toHaveBeenCalledTimes(1);
    expect(noteDeviceLockAcquire.mock.calls[0][1]).toEqual({
      device: 'S1', owner: 'outreach-tick:xian-m4:1:2', taskId: 't-1', runId: 'r-1', host: 'xian-m4',
    });
  });

  it('被占用 → 不记旁路（没动到手机）', async () => {
    const { noteDeviceLockAcquire } = await import('../../bypass-audit.js');
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ device_name: 'S1', locked_by: 'x', expires_at: null }], rowCount: 1 });
    await request(app).post('/api/brain/device-locks/acquire').send({ device_name: 'S1', locked_by: 'y' });
    expect(noteDeviceLockAcquire).not.toHaveBeenCalled();
  });

  it('第一条 SQL 是单条 UPDATE device_locks ... RETURNING（禁止先 SELECT 判定）', async () => {
    const lockRow = {
      device_name: 'ANGYVB4311010223',
      locked_by: 'task-1',
      locked_at: '2026-09-16T00:00:00Z',
      expires_at: '2026-09-16T00:30:00Z',
    };
    pool.query.mockResolvedValueOnce({ rows: [lockRow], rowCount: 1 });

    const res = await request(app)
      .post('/api/brain/device-locks/acquire')
      .send({ device_name: 'ANGYVB4311010223', locked_by: 'task-1', ttl_minutes: 30 });

    expect(res.status).toBe(200);
    expect(res.body.acquired).toBe(true);
    expect(res.body.lock).toEqual(lockRow);

    expect(pool.query).toHaveBeenCalled();
    const firstSql = pool.query.mock.calls[0][0];
    expect(firstSql.trim().toUpperCase().startsWith('UPDATE')).toBe(true);
    expect(firstSql).toMatch(/UPDATE\s+device_locks/i);
    expect(firstSql).toMatch(/RETURNING/i);
    // 抢锁成功路径只需这一条 SQL
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('被占用 → { acquired:false, locked_by, expires_at }（取自补查 holder）', async () => {
    const holder = {
      device_name: 'ANGYVB4311010223',
      locked_by: 'task-other',
      locked_at: '2026-09-16T00:00:00Z',
      expires_at: '2026-09-16T00:30:00Z',
    };
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE 0 行
      .mockResolvedValueOnce({ rows: [holder], rowCount: 1 }); // 补查 SELECT

    const res = await request(app)
      .post('/api/brain/device-locks/acquire')
      .send({ device_name: 'ANGYVB4311010223', locked_by: 'task-1' });

    expect(res.status).toBe(200);
    expect(res.body.acquired).toBe(false);
    expect(res.body.locked_by).toBe('task-other');
    expect(res.body.expires_at).toBe(holder.expires_at);
  });

  it('unknown device（UPDATE 0 行且补查 0 行）→ 404 Unknown device', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post('/api/brain/device-locks/acquire')
      .send({ device_name: 'NO_SUCH_SERIAL', locked_by: 'task-1' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Unknown device');
  });

  it('缺参 → 400', async () => {
    const res = await request(app)
      .post('/api/brain/device-locks/acquire')
      .send({ device_name: 'ANGYVB4311010223' });
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('POST /api/brain/device-locks/register', () => {
  it('发出 INSERT ... ON CONFLICT (device_name) DO UPDATE，SET 只碰 host/device_type 不含 locked_by', async () => {
    const deviceRow = {
      device_name: 'NEWPHONE001',
      host: 'xian-m1',
      device_type: 'phone',
      locked_by: null,
      expires_at: null,
    };
    pool.query.mockResolvedValueOnce({ rows: [deviceRow], rowCount: 1 });

    const res = await request(app)
      .post('/api/brain/device-locks/register')
      .send({ device_name: 'NEWPHONE001', host: 'xian-m1', device_type: 'phone' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.device).toEqual(deviceRow);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/INSERT\s+INTO\s+device_locks/i);
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*device_name\s*\)\s*DO\s+UPDATE/i);
    // DO UPDATE SET 段（RETURNING 之前）只允许 host/device_type，禁碰锁字段
    const setClause = sql.split(/DO\s+UPDATE/i)[1].split(/RETURNING/i)[0];
    expect(setClause).toMatch(/host\s*=\s*EXCLUDED\.host/i);
    expect(setClause).toMatch(/device_type\s*=\s*EXCLUDED\.device_type/i);
    expect(setClause).not.toMatch(/locked_by/i);
    expect(setClause).not.toMatch(/locked_at/i);
    expect(setClause).not.toMatch(/expires_at/i);
  });

  it('缺 device_name → 400', async () => {
    const res = await request(app)
      .post('/api/brain/device-locks/register')
      .send({ host: 'xian-m1' });
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
