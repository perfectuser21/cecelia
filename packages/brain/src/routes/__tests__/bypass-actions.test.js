/**
 * 旁路报警路由（派发总闸 H，任务 865b502c）：执行机上报入口 + 运维视图 + 设备锁 acquire 记录持有者。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../bypass-audit.js', () => ({
  recordBypassAction: vi.fn(),
  summarizeBypass: vi.fn(),
}));

let app;
let audit;

beforeEach(async () => {
  vi.clearAllMocks();
  audit = await import('../../bypass-audit.js');
  const routes = (await import('../bypass-actions.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/brain', routes);
});

describe('POST /api/brain/bypass-actions/report', () => {
  it('执行机上报 → recordBypassAction，source 缺省 executor-report，原样回结果', async () => {
    audit.recordBypassAction.mockResolvedValue({ bypass: true, recorded: true, event_id: 9 });
    const res = await request(app).post('/api/brain/bypass-actions/report').send({
      kind: 'phone_outward', device: 'S1', host: 'xian-m4', owner: 'manual-test', action: 'publish', command: 'tap-evidence',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, bypass: true, recorded: true, event_id: 9 });
    const input = audit.recordBypassAction.mock.calls[0][1];
    expect(input).toMatchObject({ kind: 'phone_outward', device: 'S1', host: 'xian-m4', owner: 'manual-test', action: 'publish', source: 'executor-report' });
  });

  it('kind 非法 → 400', async () => {
    audit.recordBypassAction.mockRejectedValue(new Error('invalid_kind: x'));
    const res = await request(app).post('/api/brain/bypass-actions/report').send({ kind: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/brain/bypass-actions/summary', () => {
  it('按天×类型汇总，days 透传', async () => {
    audit.summarizeBypass.mockResolvedValue({ days: 3, rows: [{ day: '2026-10-12', kind: 'phone_lock', n: 1 }] });
    const res = await request(app).get('/api/brain/bypass-actions/summary?days=3');
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(audit.summarizeBypass.mock.calls[0][1]).toEqual({ days: 3 });
  });
});
