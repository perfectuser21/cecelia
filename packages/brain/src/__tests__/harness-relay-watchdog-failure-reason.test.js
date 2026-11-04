/**
 * harness-relay-watchdog-failure-reason.test.js
 *
 * 缺口：task 已 failed 时 watchdog 把 initiative_runs 收敛成 phase='failed'，
 * 但这条 UPDATE 是唯一一条没写 failure_reason 的（旁边四条同类 UPDATE 都写了），
 * 界面上这类 run 的失败原因永远是空的 —— 事故 51836fb2 复盘时就卡在这。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(true) }));
const store = vi.hoisted(() => ({ patch: vi.fn(async (_db, input) => ({ id: input.runId, phase: input.phase })) }));
// 仅验证watchdog向真实store的委托封套；不让mock自产SQL冒充持久化。
vi.mock('../orchestrator/kernel-run-store.js', () => ({ patchKernelRunById: store.patch }));
const escaped = vi.hoisted(() => ({ process: vi.fn(), network: vi.fn() }));
vi.mock('node:child_process', () => Object.fromEntries(['execSync', 'execFile', 'execFileSync', 'exec', 'spawn'].map(name => [name, (...args) => { escaped.process(name, ...args); throw Error('禁止宿主进程'); }])));
afterEach(() => { expect(escaped.process).not.toHaveBeenCalled(); expect(escaped.network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

import { resumeStalledRelayRuns } from '../harness-relay-watchdog.js';

const TASK_ID = '51836fb2-10ea-48eb-97b2-c324df32d147';

function makePool(taskStatus) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    const s = String(sql);
    if (/FROM initiative_runs r/.test(s)) {
      return {
        rows: [{
          id: 'run-1', initiative_id: TASK_ID, current_task_id: TASK_ID,
          phase: 'generating', attempts: '1',
          deadline_at: new Date(Date.now() + 3600e3).toISOString(),
          pr_url: null, orchestrator_host: 'kernel-v1',
        }],
      };
    }
    if (/FROM tasks/.test(s)) {
      return { rows: [{ id: TASK_ID, status: taskStatus, title: 't', pr_url: null, payload: {} }] };
    }
    return { rows: [] };
  });
  return pool;
}

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', (...args) => { escaped.network(...args); throw Error('禁止外联'); }); });

describe('watchdog终态任务向store委托原因（不宣称DB持久化）', () => {
  it.each([['failed', 'failed', 'task_failed_upstream'], ['cancelled', 'failed', 'task_cancelled'], ['completed', 'done', null]])(
    '%s任务只委托一次phase=%s与原因=%s', async (status, phase, reason) => {
      const pool = makePool(status);
      const out = await resumeStalledRelayRuns({ pool, execFn: vi.fn(() => { throw Error('终态任务不应探测进程'); }) });
      expect(out.housekept).toBe(1);
      expect(store.patch).toHaveBeenCalledTimes(1);
      expect(store.patch).toHaveBeenCalledWith(pool, {
        runId: 'run-1', phase, failureReason: reason, prUrl: null,
      });
      expect(pool.query.mock.calls.filter(([sql]) => /UPDATE/.test(String(sql)))).toEqual([]);
    });
});
