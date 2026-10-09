import { describe, it, expect, vi } from 'vitest';
import { createPreviewCacheController } from '../preview-cache-controller.js';
import { PREVIEW_CACHE_POLICY } from '../preview-cache-authority.js';
import { createJanitor } from '../janitor.js';
describe('固定preview cache控制面', () => {
  it('未知运行结果保留running，绝不写成failed以便再次删除', async () => {
    const writes = [];
    const client = { on() {}, removeListener() {}, release() {}, query: async (sql) => {
      writes.push(sql);
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
      if (sql.startsWith('SELECT enabled')) return { rows: [{ enabled: true }] };
      if (sql.startsWith('INSERT')) return { rows: [{ id: 'fixture' }] };
      return { rows: [] };
    } };
    const janitor = createJanitor([{ JOB_ID: 'fixture', JOB_NAME: 'fixture', run: async () => ({ status: 'unconfirmed' }) }]);
    await expect(janitor.runJob({ connect: async () => client }, 'fixture')).rejects.toMatchObject({ code: 'JANITOR_UNCONFIRMED' });
    expect(writes.some(s => s.startsWith('UPDATE'))).toBe(false);
  });
  it('非法plan在建单前拒绝；空候选无任务无execute', async () => {
    const createTask = vi.fn(); const execute = vi.fn();
    const controller = createPreviewCacheController({ pool: {}, createTask, client: { plan: async () => ({ policy: PREVIEW_CACHE_POLICY, resources: [] }), execute } });
    expect(await controller.run({ run_id: 'fixture' })).toMatchObject({ status: 'skipped' });
    expect(createTask).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
    await expect(controller.claim({ machine: 'm4' }, 'fixture')).rejects.toThrow('INVALID_CACHE_PLAN');
  });
  it('零intent直调没有恢复事务保护仍未知；多intent有事务也不能伪装skipped', async () => {
    const client = { receipt: vi.fn(), execute: vi.fn() };
    const pool = { query: async () => ({ rows: [] }) };
    const controller = createPreviewCacheController({ pool, client });
    expect(await controller.reconcile({ run_id: 'fixture' })).toEqual({ status: 'unconfirmed' });
    const recovery_db = { query: async () => ({ rows: [{}, {}] }) };
    expect(await controller.reconcile({ run_id: 'fixture', recovery_db })).toEqual({ status: 'unconfirmed' });
    expect(client.receipt).not.toHaveBeenCalled(); expect(client.execute).not.toHaveBeenCalled();
  });
  it('旧plan响应在signal取消后才到达，不得开始claim或execute', async () => {
    const abort = new AbortController(); const connect = vi.fn(); const execute = vi.fn();
    const controller = createPreviewCacheController({ pool: { connect }, client: {
      plan: async () => { abort.abort(); return { policy: PREVIEW_CACHE_POLICY, resources: [{}] }; }, execute,
    } });
    await expect(controller.run({ run_id: 'fixture', signal: abort.signal })).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
});
