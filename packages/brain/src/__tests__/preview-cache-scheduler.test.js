import { it, expect, vi, beforeEach } from 'vitest';
vi.mock('../janitor.js', () => ({ runJob: vi.fn(), reconcileJob: vi.fn() }));
import { runJob, reconcileJob } from '../janitor.js';
import { runPreviewCacheJanitor } from '../preview-cache-scheduler.js';
beforeEach(() => vi.resetAllMocks());
it('停用由3a门禁拒绝，无自动启用动作', async () => {
  reconcileJob.mockResolvedValue({ status: 'idle' }); runJob.mockRejectedValue({ code: 'JANITOR_DISABLED' });
  expect(await runPreviewCacheJanitor({})).toEqual({ status: 'JANITOR_DISABLED' });
});
it('已有running未确认，仅读同intent回执，不能进入runJob再执行', async () => {
  reconcileJob.mockRejectedValue({ code: 'JANITOR_UNCONFIRMED' });
  expect(await runPreviewCacheJanitor({})).toEqual({ status: 'JANITOR_UNCONFIRMED' });
  expect(runJob).not.toHaveBeenCalled();
});
it('对账完成的本轮不再派删除，新一轮才受启用配置约束', async () => {
  reconcileJob.mockResolvedValue({ status: 'success' });
  expect(await runPreviewCacheJanitor({})).toEqual({ status: 'success' }); expect(runJob).not.toHaveBeenCalled();
});
