import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

let routes;
function mockReqRes(body = {}, params = {}, query = {}) {
  const req = { body, params, query };
  const res = {
    _status: 200, _data: null,
    status(code) { this._status = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return { req, res };
}
function getHandler(method, path) {
  const layers = routes.stack.filter(l => l.route && l.route.methods[method] && l.route.path === path);
  if (layers.length === 0) throw new Error(`No handler for ${method} ${path}`);
  return layers[0].route.stack[0].handle;
}

describe('POST /key-results/:id/recalculate-progress（任务 7aeb81a6）', () => {
  beforeAll(async () => { routes = (await import('../../routes/okr-hierarchy.js')).default; });
  beforeEach(() => { mockPool.query.mockReset(); });

  function seed({ target = null, projects = true, progress = 42, current = 12 } = {}) {
    mockPool.query.mockImplementation(async (sql, params = []) => {
      if (sql.includes('UPDATE key_results')) return { rows: [] };
      if (sql.includes('FROM key_results')) return { rows: [{ id: 'kr1', target_value: target, progress, current_value: current }] };
      if (sql.includes('COUNT(t.id)')) return { rows: [{ completed_count: '9', total_count: '10' }] };
      if (sql.includes('FROM projects')) return { rows: projects ? [
        { id: 'p1', kr_id: 'kr1', name: '大项目', status: 'active' },
        { id: 'p2', kr_id: 'kr1', name: '小项目', status: 'active' },
      ] : [] };
      if (sql.includes('FROM tasks')) return { rows: [
        { project_id: 'p1', total: 9, done: 9 }, { project_id: 'p2', total: 2, done: 1 },
      ] };
      throw new Error(`未预期查询: ${sql}, ${params}`);
    });
  }
  async function run() {
    const { req, res } = mockReqRes({}, { id: 'kr1' });
    await getHandler('post', '/key-results/:id/recalculate-progress')(req, res);
    return res;
  }

  it('NULL target 保持 current_value=NULL，按两个 project 等权平均写 progress=75 与来源', async () => {
    seed();
    const res = await run();
    expect(res._status).toBe(200);
    expect(res._data).toMatchObject({ progress: 75, current_value: null, target_value: null, completed_tasks: 10, total_tasks: 11 });
    const writes = mockPool.query.mock.calls.filter(([sql]) => sql.includes('UPDATE key_results'));
    expect(writes.some(([sql]) => sql.includes('progress_source') && sql.includes('projects_v1'))).toBe(true);
    expect(writes.flatMap(([, values]) => values).some(Number.isNaN)).toBe(false);
  });

  it('有效 target 的 current_value 跟随 project 平均，而非任务扁平合计', async () => {
    seed({ target: '200' });
    expect((await run())._data).toMatchObject({ progress: 75, target_value: 200, current_value: 150 });
  });

  it.each(['NaN', 'Infinity', ''])('非有限 target=%s 不写 NaN', async (target) => {
    seed({ target });
    expect((await run())._data.current_value).toBeNull();
  });

  it('无 project 不覆盖已有 progress/current_value', async () => {
    seed({ target: '100', projects: false });
    expect((await run())._data).toMatchObject({ progress: 42, current_value: 12, total_tasks: 0 });
    expect(mockPool.query.mock.calls.some(([sql]) => sql.includes('UPDATE key_results'))).toBe(false);
  });

  it('持续并发冲突返回409，最多三次尝试且不强行覆盖', async () => {
    seed({ target: '100' });
    const seeded = mockPool.query.getMockImplementation();
    mockPool.query.mockImplementation(async (sql, params) => sql.includes('UPDATE key_results')
      ? { rows: [], rowCount: 0 } : seeded(sql, params));
    expect((await run())._status).toBe(409);
    expect(mockPool.query.mock.calls.filter(([sql]) => sql.includes('UPDATE key_results'))).toHaveLength(3);
  });

  it('不存在的 KR 返回404、不写库', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    expect((await run())._status).toBe(404);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });
});
