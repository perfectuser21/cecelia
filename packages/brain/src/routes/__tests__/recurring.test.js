/**
 * routes/recurring.js —— 定时引擎复活（任务 3d0db274）的路由侧回归：
 *   - POST/PATCH 收 template(jsonb) 与 task_type，GET 返回二者；
 *   - PATCH 把 is_active false→true、或改 cron_expression 时重建基线（next_run_at=现在之后下一个时间点），绝不补跑；
 *   - 非法 cron / 非法时区直接 400，不落库。
 * 旧行为回归见 src/__tests__/routes/recurring.test.js。
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../actions.js', () => ({ createTask: vi.fn() }));

let router;

beforeAll(async () => {
  vi.resetModules();
  router = (await import('../recurring.js')).default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/recurring-tasks', router);
  return app;
}

// 北京 22:00 = UTC 14:00；"现在"= 北京 22:00:30，重建基线必须落到次日 22:00，不能补今天这一次
const NOW = '2026-09-29T14:00:30.000Z';
const NEXT = '2026-09-30T14:00:00.000Z';

describe('recurring routes：template / task_type / 基线重建', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockReset();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    app = createApp();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('GET 返回 template 与 task_type 列', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'r1', template: { task_type: 'research' }, task_type: 'research' }] });
    const res = await request(app).get('/recurring-tasks');
    expect(res.status).toBe(200);
    const [sql] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/\btemplate\b/);
    expect(sql).toMatch(/\btask_type\b/);
    expect(res.body[0].template).toEqual({ task_type: 'research' });
  });

  it('POST 落库 template(JSON) 与 task_type', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'x' }] });
    const template = { task_type: 'research', assigned_to: 'alex', due_offset_minutes: 60 };
    const res = await request(app).post('/recurring-tasks').send({
      title: '晚间复盘', cron_expression: '0 22 * * *', template, task_type: 'research',
    });
    expect(res.status).toBe(201);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('template');
    expect(sql).toContain('task_type');
    expect(JSON.parse(params[10])).toEqual(template);
    expect(params[11]).toBe('research');
  });

  it('POST 未给 task_type 时取 template.task_type，再兜底 dev（表上 task_type NOT NULL）', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 'x' }] });
    await request(app).post('/recurring-tasks').send({ title: 'a', cron_expression: '0 22 * * *', template: { task_type: 'research' } });
    await request(app).post('/recurring-tasks').send({ title: 'b', cron_expression: '0 22 * * *' });
    expect(mockPool.query.mock.calls[0][1][11]).toBe('research');
    expect(mockPool.query.mock.calls[1][1][11]).toBe('dev');
  });

  it('POST 非法 cron / 非法时区 → 400 且不落库', async () => {
    const r1 = await request(app).post('/recurring-tasks').send({ title: 'T', cron_expression: '0 22 * *' });
    const r2 = await request(app).post('/recurring-tasks').send({ title: 'T', cron_expression: '0 22 * * *', template: { timezone: 'Mars/Olympus' } });
    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('PATCH 可改 template 与 task_type', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'r1', is_active: false, _old_is_active: false, _old_cron_expression: '0 22 * * *' }] });
    const res = await request(app).patch('/recurring-tasks/r1').send({ template: { dept: 'ops' }, task_type: 'research' });
    expect(res.status).toBe(200);
    const [sql, values] = mockPool.query.mock.calls[0];
    expect(sql).toContain('template = $1');
    expect(sql).toContain('task_type = $2');
    expect(JSON.parse(values[0])).toEqual({ dept: 'ops' });
    expect(values[1]).toBe('research');
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('PATCH is_active false→true：重建基线为现在之后下一个时间点（北京次日 22:00），不补跑', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{
        id: 'r1', is_active: true, recurrence_type: 'cron', cron_expression: '0 22 * * *', template: {},
        next_run_at: '2026-04-27T16:00:00.000Z', _old_is_active: false, _old_cron_expression: '0 22 * * *',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'r1', is_active: true, next_run_at: NEXT }] });
    const res = await request(app).patch('/recurring-tasks/r1').send({ is_active: true });
    expect(res.status).toBe(200);
    expect(mockPool.query).toHaveBeenCalledTimes(2);
    const [sql2, params2] = mockPool.query.mock.calls[1];
    expect(sql2).toMatch(/UPDATE recurring_tasks SET next_run_at = \$1/);
    expect(params2).toEqual([NEXT, 'r1']);
    expect(res.body.next_run_at).toBe(NEXT);
    expect(res.body).not.toHaveProperty('_old_is_active');
  });

  it('PATCH 改 cron_expression：重建基线', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{
        id: 'r1', is_active: true, recurrence_type: 'cron', cron_expression: '0 22 * * *', template: {},
        _old_is_active: true, _old_cron_expression: '0 9 * * *',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'r1', next_run_at: NEXT }] });
    const res = await request(app).patch('/recurring-tasks/r1').send({ cron_expression: '0 22 * * *' });
    expect(res.status).toBe(200);
    expect(mockPool.query.mock.calls[1][1]).toEqual([NEXT, 'r1']);
  });

  it('PATCH 已启用的模板再发 is_active=true / 只改标题：不动 next_run_at', async () => {
    mockPool.query.mockResolvedValue({ rows: [{
      id: 'r1', is_active: true, recurrence_type: 'cron', cron_expression: '0 22 * * *', template: {},
      _old_is_active: true, _old_cron_expression: '0 22 * * *',
    }] });
    await request(app).patch('/recurring-tasks/r1').send({ is_active: true });
    await request(app).patch('/recurring-tasks/r1').send({ title: '新标题' });
    expect(mockPool.query).toHaveBeenCalledTimes(2);
    for (const [sql] of mockPool.query.mock.calls) expect(sql).not.toMatch(/SET next_run_at = \$1/);
  });

  it('PATCH 非法 cron → 400 且不落库', async () => {
    const res = await request(app).patch('/recurring-tasks/r1').send({ cron_expression: 'every day' });
    expect(res.status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
