/**
 * POST /api/brain/commander-heartbeat 与 /api/brain/tasks/:id/commander-heartbeat（任务 17ea4536）。
 * escort 每 tick 末尾 curl 一次；网关经 socat 到 us-vps 非回环、escort 无内部令牌，故本入口不挂 internalAuth，
 * 只按 tag 限流、只写 payload 心跳字段（不改状态）。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));
const mockRecord = vi.hoisted(() => vi.fn());
vi.mock('../commander-watchdog.js', async (importOriginal) => ({
  ...(await importOriginal()),
  recordCommanderHeartbeat: mockRecord,
}));

let app;
beforeAll(async () => {
  const router = (await import('./commander-heartbeat.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/brain', router);
});
beforeEach(() => { mockPool.query.mockReset(); mockRecord.mockReset(); });

describe('POST /api/brain/commander-heartbeat', () => {
  it('命中 → 200 {matched:true, task_id}', async () => {
    mockRecord.mockResolvedValueOnce({ matched: true, task_id: 't-1', via: 'tag' });
    const res = await request(app).post('/api/brain/commander-heartbeat').send({ tag: 'cmd09300200', host: 'xian-m4', serial: 'S1', escort_id: 'e1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, matched: true, task_id: 't-1' });
    expect(mockRecord.mock.calls[0][1]).toMatchObject({ tag: 'cmd09300200', host: 'xian-m4', serial: 'S1', escort_id: 'e1' });
  });

  it('没命中（起跑登记）→ 202 {matched:false}', async () => {
    mockRecord.mockResolvedValueOnce({ matched: false, stored: 'launch' });
    const res = await request(app).post('/api/brain/commander-heartbeat').send({ kind: 'launch', tag: 'cmd09300200', host: 'xian-m4', escort_id: 'e1' });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ success: true, matched: false, stored: 'launch' });
  });

  it('非法 tag → 400，不查库', async () => {
    mockRecord.mockRejectedValueOnce(Object.assign(new Error('tag 非法'), { status: 400 }));
    const res = await request(app).post('/api/brain/commander-heartbeat').send({ tag: 'bad tag' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/brain/tasks/:id/commander-heartbeat', () => {
  it('按单号直写：in_progress 才写，写成 200，不在途 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: '11111111-1111-4111-8111-111111111111' }], rowCount: 1 });
    const res = await request(app).post('/api/brain/tasks/11111111-1111-4111-8111-111111111111/commander-heartbeat').send({ escort_id: 'e9' });
    expect(res.status).toBe(200);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/status = 'in_progress'/);
    expect(JSON.parse(params[1])).toMatchObject({ escort_id: 'e9' });
    expect(JSON.parse(params[1]).commander_heartbeat_at).toBeTruthy();
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const miss = await request(app).post('/api/brain/tasks/11111111-1111-4111-8111-111111111111/commander-heartbeat').send({});
    expect(miss.status).toBe(404);
  });
});
