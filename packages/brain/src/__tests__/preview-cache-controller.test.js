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
});
