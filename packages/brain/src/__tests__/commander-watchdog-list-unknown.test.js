import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  nativeExec: vi.fn(() => { throw new Error('unexpected native exec'); }),
  bark: vi.fn(),
}));
vi.mock('node:child_process', () => ({ execFile: boundary.nativeExec }));
vi.mock('../notifier.js', () => ({ sendBark: boundary.bark }));

import { runCommanderWatchdog } from '../commander-watchdog.js';

function arrange(payload) {
  const writes = [];
  const events = [];
  const task = { id: 'owned-task-1', title: 'owned-run', task_type: 'workflow_run', payload };
  const pool = { query: vi.fn(async (sql, params) => {
    if (/FROM tasks[\s\S]*commander_heartbeat_at/.test(sql)) return { rows: [task] };
    if (/FROM task_runs|FROM working_memory|FROM phone_registry/.test(sql)) return { rows: [] };
    if (/^UPDATE tasks/.test(sql)) {
      writes.push(JSON.parse(params[1]));
      return { rows: [{ id: task.id }], rowCount: 1 };
    }
    if (/INSERT INTO task_events/.test(sql)) {
      events.push({ type: params[1], payload: JSON.parse(params[2]) });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected record-only SQL: ${sql}`);
  }) };
  const execFileFn = vi.fn(() => { throw new Error('retired SSH must not run'); });
  const run = (deps = {}) => runCommanderWatchdog(pool, { execFileFn, now: 1900000000000, gateMs: 0, ...deps });
  return { run, execFileFn, writes, events };
}

describe('退役陪跑状态不再触发cron恢复', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.bark.mockResolvedValue(true);
  });

  it.each([
    { tag: 'owned-tag', host: 'owned-worker', escort_id: 'old-escort', commander_adopt_count: 0 },
    { tag: 'owned-tag', host: 'owned-worker', escort_id: 'old-escort', commander_adopt_count: 2 },
    { tag: 'owned-tag', host: 'owned-worker', commander_relaunch_count: 3 },
    {},
  ])('保留旧状态 %j，缺上下文也只报真实失联', async payload => {
    const fixture = arrange(payload);
    expect(await fixture.run()).toMatchObject({ scanned: 1, relaunched: 0, adopted: 0, barked: 1, failed: 0 });
    expect(fixture.execFileFn).not.toHaveBeenCalled();
    expect(boundary.nativeExec).not.toHaveBeenCalled();
    expect(fixture.writes).toEqual([{ commander_bark_at: new Date(1900000000000).toISOString() }]);
    expect(fixture.events).toEqual([{ type: 'commander_heartbeat_stale', payload: expect.any(Object) }]);
    expect(boundary.bark).toHaveBeenCalledTimes(1);
    expect(boundary.bark.mock.calls[0][1]).toContain('旧 OpenClaw 陪跑已退役');
  });
});
