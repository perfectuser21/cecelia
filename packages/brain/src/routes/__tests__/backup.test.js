import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const boundary = vi.hoisted(() => ({ schedule: vi.fn(), pool: {} }));
vi.mock('../../daily-backup-scheduler.js', () => ({ scheduleDailyBackup: boundary.schedule }));
vi.mock('../../db.js', () => ({ default: boundary.pool }));
import backupRouter from '../backup.js';

// 挂载真实生产 router；调度器是此次 HTTP 合同的 I/O 边界，不执行真实备份。
describe('backup — 真实HTTP路由', () => {
  let app;
  beforeEach(() => {
    boundary.schedule.mockReset();
    app = express();
    app.use(express.json());
    app.use('/api/brain/backup', backupRouter);
  });
  it.each([
    ['已触发', { force: true }, true,
      { triggered: true, alreadyDone: false, inWindow: true, taskId: 'test-task-id' },
      { ok: true, triggered: true, alreadyDone: false, inWindow: true, taskId: 'test-task-id', error: null }],
    ['已执行过', { force: false }, false,
      { triggered: false, alreadyDone: true, inWindow: true },
      { ok: true, triggered: false, alreadyDone: true, inWindow: true, taskId: null, error: null }],
    ['窗口外', {}, false,
      { triggered: false, alreadyDone: false, inWindow: false },
      { ok: true, triggered: false, alreadyDone: false, inWindow: false, taskId: null, error: null }],
  ])('%s：规范化请求并映射响应', async (_label, body, force, scheduled, expected) => {
    boundary.schedule.mockResolvedValue(scheduled);
    const response = await request(app).post('/api/brain/backup/trigger-now').send(body).expect(200);
    expect(response.body).toEqual(expected);
    expect(boundary.schedule).toHaveBeenCalledTimes(1);
    expect(boundary.schedule).toHaveBeenCalledWith(boundary.pool, { force });
  });
  it('字符串 true 不能启用强制备份', async () => {
    boundary.schedule.mockResolvedValue({ triggered: false, alreadyDone: false, inWindow: false });
    const response = await request(app).post('/api/brain/backup/trigger-now').send({ force: 'true' }).expect(200);
    expect(response.body.triggered).toBe(false);
    expect(boundary.schedule).toHaveBeenCalledTimes(1);
    expect(boundary.schedule).toHaveBeenCalledWith(boundary.pool, { force: false });
  });
  it('调度错误转为500响应', async () => {
    boundary.schedule.mockRejectedValue(new Error('备份调度失败'));
    const response = await request(app).post('/api/brain/backup/trigger-now').send({}).expect(500);
    expect(response.body).toEqual({ ok: false, error: '备份调度失败' });
  });
});
