import { it, expect, vi } from 'vitest';
import { sample } from './fixtures/commander-contract-v1.js';
import { dispatchWorkflowCommanderTasks } from '../workflow-commander-dispatch.js';
it('相同预检阻断只落一份原因；条件实际变化追加新事实且零业务起跑', async () => {
  const current = { ...structuredClone(sample.task), status: 'queued', result: {} };
  const query = vi.fn(async (sql, args = []) => {
    if (sql.includes('SELECT * FROM tasks')) return { rows: [current] };
    if (sql.includes("jsonb_build_object('commander_preflight'")) current.result.commander_preflight = JSON.parse(args[1]);
    return { rows: [] };
  });
  const pool = { query, connect: async () => ({ query, release() {} }) }, recordEvent = vi.fn(), sshDispatch = vi.fn();
  const deps = { frozenContract: async () => { throw Error('frozen_dependency_missing'); }, recordEvent, sshDispatch };
  await dispatchWorkflowCommanderTasks(pool, deps); await dispatchWorkflowCommanderTasks(pool, deps);
  expect(recordEvent).toHaveBeenCalledTimes(1); expect(current.result.commander_preflight.reason).toBe('frozen_dependency_missing');
  current.payload.workflow_input.content_ref = 'changed'; await dispatchWorkflowCommanderTasks(pool, deps);
  expect(recordEvent).toHaveBeenCalledTimes(2); expect(sshDispatch).not.toHaveBeenCalled();
});
