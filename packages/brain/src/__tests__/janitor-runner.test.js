import { describe, expect, it, vi } from 'vitest';
import * as janitor from '../janitor.js';

function fixture({ enabled = true, busy = false, previous = false, run = vi.fn(async () => ({ status: 'success', freed_bytes: 42 })) } = {}) {
  const writes = [];
  const client = {
    query: vi.fn(async (sql, args = []) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: !busy }] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
      if (sql.includes('SELECT enabled')) return { rows: enabled === null ? [] : [{ enabled }] };
      if (sql.includes("status = 'running'")) return { rows: previous ? [{ id: 'old-run' }] : [] };
      if (sql.includes('INSERT INTO janitor_runs')) return { rows: [{ id: 'new-run' }] };
      if (sql.includes('UPDATE janitor_runs')) { writes.push(args); return { rowCount: 1 }; }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client), query: client.query };
  const api = janitor.createJanitor([{ JOB_ID: 'owned-cache', JOB_NAME: '专属缓存', run }]);
  return { api, pool, client, run, writes };
}

describe('受控 Janitor 执行', () => {
  it.each([false, null])('未明确启用时拒绝动作：%s', async enabled => {
    const f = fixture({ enabled });
    await expect(f.api.runJob(f.pool, 'owned-cache')).rejects.toMatchObject({ code: 'JANITOR_DISABLED' });
    expect(f.run).not.toHaveBeenCalled();
    expect(f.client.release).toHaveBeenCalledOnce();
  });

  it('同一动作正在运行时拒绝第二次执行', async () => {
    const f = fixture({ busy: true });
    await expect(f.api.runJob(f.pool, 'owned-cache')).rejects.toMatchObject({ code: 'JANITOR_BUSY' });
    expect(f.run).not.toHaveBeenCalled();
  });

  it('残留 running 回执需要核验，不能自动重跑', async () => {
    const f = fixture({ previous: true });
    await expect(f.api.runJob(f.pool, 'owned-cache')).rejects.toMatchObject({ code: 'JANITOR_UNCONFIRMED' });
    expect(f.run).not.toHaveBeenCalled();
  });

  it('成功动作必须先登记后执行，持久终态才返回成功', async () => {
    const f = fixture();
    const result = await f.api.runJob(f.pool, 'owned-cache');
    expect(result).toMatchObject({ run_id: 'new-run', status: 'success', freed_bytes: 42 });
    const insert = f.client.query.mock.calls.findIndex(([sql]) => sql.includes('INSERT INTO janitor_runs'));
    expect(f.client.query.mock.invocationCallOrder[insert]).toBeLessThan(f.run.mock.invocationCallOrder[0]);
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0][0]).toBe('success');
  });

  it('异常必须写失败回执，原始异常内容不泄漏到响应或库', async () => {
    const f = fixture({ run: vi.fn(async () => { throw new Error('token=private-secret'); }) });
    await expect(f.api.runJob(f.pool, 'owned-cache')).rejects.toMatchObject({ code: 'JANITOR_ACTION_FAILED' });
    expect(f.writes[0][0]).toBe('failed');
    expect(JSON.stringify(f.writes)).not.toContain('private-secret');
    expect(f.client.release).toHaveBeenCalledOnce();
  });

  it('非法动作回执不能算成功', async () => {
    const f = fixture({ run: vi.fn(async () => ({ status: 'running', freed_bytes: -1 })) });
    await expect(f.api.runJob(f.pool, 'owned-cache')).rejects.toMatchObject({ code: 'JANITOR_INVALID_RESULT' });
    expect(f.writes[0][0]).toBe('failed');
  });

  it('未知配置不得入库', async () => {
    const f = fixture();
    await expect(f.api.setJobConfig(f.pool, 'arbitrary-shell', { enabled: true })).rejects.toMatchObject({ code: 'JANITOR_UNKNOWN_JOB' });
    expect(f.pool.connect).not.toHaveBeenCalled();
    expect(f.client.query).not.toHaveBeenCalled();
  });

  it('解锁失败销毁连接，不把持锁连接归还池', async () => {
    const f = fixture();
    const query = f.client.query.getMockImplementation();
    f.client.query.mockImplementation(async (sql, args) => {
      if (sql.includes('pg_advisory_unlock')) throw new Error('connection interrupted');
      return query(sql, args);
    });
    await expect(f.api.runJob(f.pool, 'owned-cache')).rejects.toMatchObject({ code: 'JANITOR_LOCK_RELEASE_FAILED' });
    expect(f.client.release).toHaveBeenCalledWith(true);
  });

  it('注册表复制后不接受外部换成另一个动作', async () => {
    const action = vi.fn(async () => ({ status: 'success' }));
    const entry = { JOB_ID: 'owned-cache', JOB_NAME: '原动作', run: action };
    const registry = [entry];
    const api = janitor.createJanitor(registry);
    const replacement = vi.fn();
    entry.run = replacement;
    registry.length = 0;
    const f = fixture();
    await api.runJob(f.pool, 'owned-cache');
    expect(action).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
  });

  it('重复注册或无执行函数不能装入动作表', () => {
    const entry = { JOB_ID: 'owned-cache', JOB_NAME: '缓存', run: vi.fn() };
    expect(() => janitor.createJanitor([entry, entry])).toThrow('JANITOR_INVALID_REGISTRY');
    expect(() => janitor.createJanitor([{ ...entry, run: null }])).toThrow('JANITOR_INVALID_REGISTRY');
  });
});
