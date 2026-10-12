/**
 * 统一领单租约的心跳/释放端点（任务 c5f6e683）：POST /tasks/:id/heartbeat、POST /tasks/:id/lease/release。
 * 409 lease_lost = 认领已换人 / 任务已终态 / 租约已被回收——执行者据此立即停手。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

const { default: router } = await import('../task-lease.js');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/tasks', router);
  return a;
}

describe('POST /tasks/:id/heartbeat', () => {
  beforeEach(() => vi.clearAllMocks());

  it('缺 claimer → 400', async () => {
    const res = await request(app()).post('/tasks/t1/heartbeat').send({});
    expect(res.status).toBe(400);
  });

  it('续约成功 → 200 带新 lease_until，并同步设备锁', async () => {
    const until = new Date(Date.now() + 600_000).toISOString();
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ task_id: 't1', lease_until: until, heartbeat_count: 3, lease_seconds: 600 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app()).post('/tasks/t1/heartbeat').send({ claimer: 'runner', lease_seconds: 600 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, lease_until: until });
    expect(mockPool.query.mock.calls[1][0]).toMatch(/UPDATE device_locks/);
  });

  it('租约丢了 → 409 lease_lost', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ status: 'queued', claimed_by: 'other' }] });
    const res = await request(app()).post('/tasks/t1/heartbeat').send({ claimer: 'runner' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('lease_lost');
  });
});

describe('POST /tasks/:id/lease/release', () => {
  beforeEach(() => vi.clearAllMocks());
  it('领单方主动释放 → 200', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ task_id: 't1' }], rowCount: 1 });
    const res = await request(app()).post('/tasks/t1/lease/release').send({ claimer: 'runner', reason: 'finished' });
    expect(res.status).toBe(200);
    expect(res.body.released).toBe(true);
  });
});
