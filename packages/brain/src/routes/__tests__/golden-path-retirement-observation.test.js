import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query } }));
import router from '../abilities.js';

const savedFlag = process.env.GOLDEN_PATH_LEGACY_READ;
function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/brain', router);
  return instance;
}
function events() {
  return query.mock.calls.filter(([sql]) => /INSERT INTO cecelia_events/.test(sql));
}
function domainQueries() {
  return query.mock.calls.filter(([sql]) => !/INSERT INTO cecelia_events/.test(sql));
}
const writes = [
  ['post', '/golden_path', {}],
  ['patch', '/golden_path/g1', { note: 'private-note' }],
  ['post', '/golden_path/g1/run-result', { run_id: 'private-run', verdict: 'completed' }],
  ['post', '/decisions', { level: 'step', target_type: 'golden_path', target_id: 'g1' }],
];
const reads = [
  ['/golden_path', '/golden_path'],
  ['/golden_path/canvas', '/golden_path/canvas'],
  ['/golden_path/private-id/decisions', '/golden_path/:id/decisions'],
  ['/tasks/private-id/golden-path-decisions', '/tasks/:id/golden-path-decisions'],
  ['/journeys/private-id/golden-paths', '/journeys/:journey_id/golden-paths'],
];

describe('golden_path 退役：应急只读与持久观测', () => {
  beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [] });
    delete process.env.GOLDEN_PATH_LEGACY_READ;
  });
  afterEach(() => {
    if (savedFlag === undefined) delete process.env.GOLDEN_PATH_LEGACY_READ;
    else process.env.GOLDEN_PATH_LEGACY_READ = savedFlag;
    vi.restoreAllMocks();
  });

  it.each(writes)('%s %s：flag=1 仍永久 410，不写业务表', async (method, path, body) => {
    process.env.GOLDEN_PATH_LEGACY_READ = '1';
    const response = await request(app())[method](`/api/brain${path}`).send(body);
    expect(response.status).toBe(410);
    expect(response.body.path_kind).toBe('write');
    expect(response.body).not.toHaveProperty('legacy_read_env');
    expect(domainQueries()).toEqual([]);
    expect(events()).toHaveLength(1);
    expect(events()[0][1]).toEqual([
      'golden_path_legacy_access', 'golden-path-retirement',
      expect.objectContaining({ path_kind: 'write', outcome: 'rejected', legacy_read_enabled: true }),
    ]);
  });

  it.each(reads)('%s：关闭 flag 时拒读且事件用模板脱敏', async (path, template) => {
    const response = await request(app()).get(`/api/brain${path}?token=private-token`)
      .set('Authorization', 'Bearer private-secret');
    expect(response.status).toBe(410);
    expect(domainQueries()).toEqual([]);
    expect(events()).toHaveLength(1);
    const payload = events()[0][1][2];
    expect(payload).toEqual({
      actor: 'brain', method: 'GET', route: template, path_kind: 'read', outcome: 'rejected',
      legacy_read_enabled: false, retirement_task_id: '7d312fd8-10b0-4f23-99ec-535a6e782326',
    });
    expect(JSON.stringify(payload)).not.toContain('private');
  });

  it('flag=1 旧读仍可用，放行同样落库', async () => {
    process.env.GOLDEN_PATH_LEGACY_READ = '1';
    const response = await request(app()).get('/api/brain/golden_path');
    expect(response.status).toBe(200);
    expect(events()).toHaveLength(1);
    expect(events()[0][1][2]).toMatchObject({ outcome: 'legacy_read_allowed', path_kind: 'read' });
    expect(domainQueries()).toHaveLength(1);
    expect(domainQueries()[0][0]).toContain('FROM golden_path');
  });

  it('事件库失败也保住 410，不重新打开写口', async () => {
    query.mockRejectedValue(new Error('event-store unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await request(app()).post('/api/brain/golden_path/g1/run-result').send({});
    expect(response.status).toBe(410);
    expect(response.body.path_kind).toBe('write');
    expect(events()).toHaveLength(1);
    expect(domainQueries()).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it('大小写、尾斜线、HEAD 按 Express 路由语义留下命中', async () => {
    const response = await request(app()).head('/api/brain/GOLDEN_PATH/');
    expect(response.status).toBe(410);
    expect(events()).toHaveLength(1);
    expect(events()[0][1][2]).toMatchObject({ method: 'HEAD', route: '/golden_path' });
  });

  it('非旧接口不记退役事件、不影响合法决策', async () => {
    query.mockResolvedValue({ rows: [{ id: 'd1' }] });
    const response = await request(app()).post('/api/brain/decisions')
      .send({ level: 'area', topic: 'normal', decision: 'continue' });
    expect(response.status).toBe(201);
    expect(events()).toEqual([]);
    expect(domainQueries()).toHaveLength(1);
  });
});
