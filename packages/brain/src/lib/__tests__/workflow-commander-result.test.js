import {expect, test, vi} from 'vitest';
vi.mock('../commander-v2-control.js', () => ({reconcileCommanderV2: vi.fn()}));
import {reconcileCommanderV2} from '../commander-v2-control.js';
import {runWorkflowCommanderDispatch} from '../workflow-commander-dispatch.js';

test('在途Commander收尾失败显式传给调度器，不把单项错误标成整轮成功', async () => {
  reconcileCommanderV2.mockResolvedValueOnce([{task_id: 'owned-task', error: 'invalid frozen span outcome'}]);
  const pool = {query: async () => ({rows: []})};
  const result = await runWorkflowCommanderDispatch(pool);
  expect(result).toMatchObject({ok: false, error: 'commander_reconciliation_failed: 1'});
  expect(result.controlled).toEqual([{task_id: 'owned-task', error: 'invalid frozen span outcome'}]);
  expect(result.dispatched.dispatched).toBe(0);
});

test('在途运行只等待或成功收尾时不把业务停等误报成故障', async () => {
  reconcileCommanderV2.mockResolvedValueOnce([{task_id: 'owned-task', reconciled: true}]);
  const result = await runWorkflowCommanderDispatch({query: async () => ({rows: []})});
  expect(result.ok).not.toBe(false);
  expect(result.error).toBeUndefined();
});
