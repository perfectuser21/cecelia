/** 历史 interrupt 读面保留；已退休 graph 的写面不得伪报恢复成功。 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
const boundary = vi.hoisted(() => ({
  query: vi.fn(), connect: vi.fn(() => { throw new Error('forbidden DB connect'); }),
  process: vi.fn(() => { throw new Error('forbidden process'); }),
}));
vi.mock('../../db.js', () => ({ default: boundary }));
vi.mock('child_process', () => ({ default: {}, exec: boundary.process, execFile: boundary.process, spawn: boundary.process }));
vi.mock('node:child_process', () => ({ default: {}, exec: boundary.process, execFile: boundary.process, spawn: boundary.process }));
import router from '../harness-interrupts.js';
import pool from '../../db.js';
let server;
async function ownedApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/harness-interrupts', router);
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  return request(server);
}
beforeEach(() => { vi.clearAllMocks(); boundary.query.mockReset(); });
afterEach(async () => {
  if (server) await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  server = undefined;
});
describe('harness interrupt 历史 HTTP 边界', () => {
  it.each([
    { decision: { action: 'abort' } },
    { decision: { action: 'extend_fix_rounds' } },
    { decision: { action: 'accept_failed' } },
    { decision: { action: 'unknown' } }, {},
  ])('退休 resume 明确410且不查任务/不伪写恢复事件：%j', async body => {
    boundary.query.mockResolvedValue({ rows: [{ id: 'owned-task', payload: {} }], rowCount: 1 });
    const client = await ownedApp();
    const res = await client.post('/api/brain/harness-interrupts/owned-task/resume').send(body);
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ error: 'kernel_runtime_retired' });
    expect(res.body.ok).not.toBe(true);
    expect(pool).toBe(boundary);
    expect(boundary.query).not.toHaveBeenCalled();
    expect(boundary.connect).not.toHaveBeenCalled();
    expect(boundary.process).not.toHaveBeenCalled();
  });
  it('GET仍读原历史pending事件，不能写入或生成恢复事件', async () => {
    const rows = [{ task_id: 'history-task', payload: { reason: 'archived interrupt' } }];
    boundary.query.mockResolvedValue({ rows });
    const client = await ownedApp();
    const res = await client.get('/api/brain/harness-interrupts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ interrupts: rows });
    expect(boundary.query).toHaveBeenCalledTimes(1);
    const [sql] = boundary.query.mock.calls[0];
    expect(sql.trim()).toMatch(/^SELECT /);
    expect(sql).toContain("pending.event_type = 'interrupt_pending'");
    expect(sql).toContain("resumed.event_type = 'interrupt_resumed'");
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/);
    expect(boundary.connect).not.toHaveBeenCalled();
    expect(boundary.process).not.toHaveBeenCalled();
  });
  it('历史读面DB失败仍500，不冒称空列表', async () => {
    boundary.query.mockRejectedValue(new Error('owned read failure'));
    const client = await ownedApp();
    const res = await client.get('/api/brain/harness-interrupts');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('owned read failure');
    expect(boundary.query).toHaveBeenCalledTimes(1);
  });
});
