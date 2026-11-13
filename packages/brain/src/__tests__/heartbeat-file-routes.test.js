import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFile, writeFile } from 'fs/promises';

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('fs/promises', async importOriginal => ({
  ...await importOriginal(), readFile: vi.fn(), writeFile: vi.fn(),
}));

let app;
beforeAll(async () => {
  const { default: router } = await import('../routes/execution.js');
  app = express();
  app.use(express.json());
  app.use('/api/brain', router);
});
beforeEach(() => vi.resetAllMocks());

describe('真实执行路由的HEARTBEAT文件API', () => {
  it('GET返回实际读取内容并使用HEARTBEAT文件URL', async () => {
    readFile.mockResolvedValue('# 巡检\n- [x] 健康');
    const response = await request(app).get('/api/brain/heartbeat');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, content: '# 巡检\n- [x] 健康' });
    expect(readFile).toHaveBeenCalledWith(expect.any(URL), 'utf-8');
    expect(readFile.mock.calls[0][0].pathname).toMatch(/\/HEARTBEAT\.md$/);
  });

  it('GET文件不存在返回默认模板，其余读取错误返回500', async () => {
    readFile.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const fallback = await request(app).get('/api/brain/heartbeat');
    expect(fallback.status).toBe(200);
    expect(fallback.body.success).toBe(true);
    expect(fallback.body.content).toContain('# HEARTBEAT.md — Cecelia 巡检清单');
    readFile.mockRejectedValueOnce(new Error('Permission denied'));
    const failure = await request(app).get('/api/brain/heartbeat');
    expect(failure.status).toBe(500);
    expect(failure.body).toEqual({ success: false, error: 'Permission denied' });
  });

  it.each([{}, { content: null }])('PUT缺失正文拒绝且不写文件：%j', async body => {
    const response = await request(app).put('/api/brain/heartbeat').send(body);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, error: 'content is required' });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('PUT写入请求正文，写失败返回500', async () => {
    writeFile.mockResolvedValueOnce(undefined);
    const response = await request(app).put('/api/brain/heartbeat').send({ content: '# 新巡检' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(writeFile).toHaveBeenCalledWith(expect.any(URL), '# 新巡检', 'utf-8');
    readFile.mockResolvedValueOnce('# 新巡检');
    await request(app).get('/api/brain/heartbeat');
    expect(writeFile.mock.calls[0][0]).toEqual(readFile.mock.calls[0][0]);
    writeFile.mockRejectedValueOnce(new Error('Disk full'));
    const failure = await request(app).put('/api/brain/heartbeat').send({ content: '失败写入' });
    expect(failure.status).toBe(500);
    expect(failure.body).toEqual({ success: false, error: 'Disk full' });
  });
});
