import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Server } from 'node:http';
import { startLocalHttp, closeLocalHttp } from '../../src/dashboard/__tests__/helpers/local-http.js';

// 只替换外部数据库操作；实际Router、请求解析、SQL绑定与HTTP响应均为生产实现。
const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/task-system/db.js', () => ({ default: database }));
import capturesRouter from '../../src/task-system/captures.js';
let server: Server;
const capture = { id: 'capture-fixture-1', content: '私有想法', source: 'dashboard', status: 'inbox', owner: 'user', area_id: null, project_id: null, extracted_to: null, destination_type: null, destination_id: null, created_at: '2026-11-03T00:00:00Z', updated_at: '2026-11-03T00:00:00Z' };
beforeEach(async () => {
  database.query.mockReset();
  database.query.mockResolvedValue({ rows: [], rowCount: 0 });
  const app = express(); app.use(express.json()); app.use('/api/captures', capturesRouter);
  server = await startLocalHttp(app);
});
afterEach(async () => { await closeLocalHttp(server); });

describe('真实captures Router（仅DB边界替身）', () => {
  it('GET返回实际DB记录而非自造列表，默认分页绑定50/0', async () => {
    database.query.mockResolvedValue({ rows: [capture], rowCount: 1 });
    const response = await request(server).get('/api/captures');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([capture]);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('FROM captures'), [50, 0]);
  });

  it('GET将status/source/owner及分页实际绑定查询，不能仅转发原URL', async () => {
    database.query.mockResolvedValue({ rows: [capture], rowCount: 1 });
    const response = await request(server).get('/api/captures?status=inbox&source=dashboard&owner=user&limit=2&offset=5');
    expect(response.status).toBe(200); expect(response.body).toEqual([capture]);
    expect(database.query).toHaveBeenCalledWith(expect.stringMatching(/WHERE status = \$1 AND source = \$2 AND owner = \$3[\s\S]*LIMIT \$4 OFFSET \$5/), ['inbox', 'dashboard', 'user', 2, 5]);
  });

  it('GET单条读取绑定实际id，并返回该记录', async () => {
    database.query.mockResolvedValue({ rows: [capture], rowCount: 1 });
    const response = await request(server).get('/api/captures/capture-fixture-1');
    expect(response.status).toBe(200); expect(response.body).toEqual(capture);
    expect(database.query).toHaveBeenCalledWith('SELECT * FROM captures WHERE id = $1', ['capture-fixture-1']);
  });

  it('GET不存在的id返回404与明确错误', async () => {
    const response = await request(server).get('/api/captures/missing');
    expect(response.status).toBe(404); expect(response.body).toEqual({ error: 'Capture not found' });
  });

  it('POST修剪正文、使用默认source/owner，返回DB产生的真实编号与201', async () => {
    database.query.mockResolvedValue({ rows: [capture], rowCount: 1 });
    const response = await request(server).post('/api/captures').send({ content: '  私有想法  ' });
    expect(response.status).toBe(201); expect(response.body).toEqual(capture);
    expect(database.query).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO captures[\s\S]*RETURNING \*/), ['私有想法', 'dashboard', null, null, 'user']);
  });

  it('POST显式来源/归属/项目不能被默认值覆盖', async () => {
    database.query.mockResolvedValue({ rows: [{ ...capture, source: 'import', owner: 'team', area_id: 'area-1', project_id: 'project-1' }], rowCount: 1 });
    const response = await request(server).post('/api/captures').send({ content: '私有想法', source: 'import', owner: 'team', area_id: 'area-1', project_id: 'project-1' });
    expect(response.status).toBe(201); expect(response.body).toMatchObject({ source: 'import', owner: 'team', area_id: 'area-1', project_id: 'project-1' });
    expect(database.query).toHaveBeenCalledWith(expect.any(String), ['私有想法', 'import', 'area-1', 'project-1', 'team']);
  });

  it.each(['', '   '])('POST空正文%j直接400且不写数据库', async content => {
    const response = await request(server).post('/api/captures').send({ content });
    expect(response.status).toBe(400); expect(response.body).toEqual({ error: 'content is required' }); expect(database.query).not.toHaveBeenCalled();
  });

  it('PATCH实际更新目标记录status并返回更新结果', async () => {
    database.query.mockResolvedValue({ rows: [{ ...capture, status: 'done' }], rowCount: 1 });
    const response = await request(server).patch('/api/captures/capture-fixture-1').send({ status: 'done' });
    expect(response.status).toBe(200); expect(response.body.status).toBe('done');
    expect(database.query).toHaveBeenCalledWith('UPDATE captures SET status = $1 WHERE id = $2 RETURNING *', ['done', 'capture-fixture-1']);
  });

  it('PATCH去向链与清空归属的null语义真正进入DB绑定', async () => {
    database.query.mockResolvedValue({ rows: [{ ...capture, destination_type: 'task', destination_id: 'task-1', extracted_to: ['task-1'] }], rowCount: 1 });
    const response = await request(server).patch('/api/captures/capture-fixture-1').send({ area_id: '', project_id: '', extracted_to: ['task-1'], destination_type: 'task', destination_id: 'task-1' });
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ area_id: null, project_id: null, destination_type: 'task', destination_id: 'task-1', extracted_to: ['task-1'] });
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $6 RETURNING *'), [null, null, '["task-1"]', 'task', 'task-1', 'capture-fixture-1']);
  });

  it('PATCH不存在的id返回404，不伪造更新结果', async () => {
    const response = await request(server).patch('/api/captures/missing').send({ status: 'done' });
    expect(response.status).toBe(404); expect(response.body).toEqual({ error: 'Capture not found' });
  });

  it('PATCH无更新字段返回400且不查询DB', async () => {
    const response = await request(server).patch('/api/captures/capture-fixture-1').send({ ignored: true });
    expect(response.status).toBe(400); expect(response.body).toEqual({ error: 'No fields to update' }); expect(database.query).not.toHaveBeenCalled();
  });

  it('DELETE只归档目标记录并读回归档编号', async () => {
    database.query.mockResolvedValue({ rows: [{ id: 'capture-fixture-1' }], rowCount: 1 });
    const response = await request(server).delete('/api/captures/capture-fixture-1');
    expect(response.status).toBe(200); expect(response.body).toEqual({ id: 'capture-fixture-1', status: 'archived' });
    expect(database.query).toHaveBeenCalledWith("UPDATE captures SET status = 'archived' WHERE id = $1 RETURNING id", ['capture-fixture-1']);
  });

  it('DELETE不存在记录返回404', async () => {
    const response = await request(server).delete('/api/captures/missing');
    expect(response.status).toBe(404); expect(response.body).toEqual({ error: 'Capture not found' });
  });

  it.each(['get', 'post', 'patch', 'delete'] as const)('%s数据库失败返回500，不能把失败记成成功', async method => {
    database.query.mockRejectedValue(new Error('PRIVATE_DB_FAILURE'));
    const url = method === 'get' || method === 'post' ? '/api/captures' : '/api/captures/capture-fixture-1';
    const response = await request(server)[method](url).send({ content: '私有想法', status: 'done' });
    expect(response.status).toBe(500); expect(response.body.error).toBeTypeOf('string'); expect(response.body.details).toBe('PRIVATE_DB_FAILURE');
  });
});
