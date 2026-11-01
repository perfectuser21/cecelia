import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', async () => (await import('./helpers/watchdog-process-fixture.js')).fixtureFs);
vi.mock('child_process', async () => ({ execSync: (await import('./helpers/watchdog-process-fixture.js')).processFixture.execSync.bind((await import('./helpers/watchdog-process-fixture.js')).processFixture) }));
vi.mock('os', () => ({ default: { totalmem: () => 8 * 1024 ** 3 } }));
import { loadWatchdog, lockDirectory, processFixture } from './helpers/watchdog-process-fixture.js';

let watchdog;
let kill;
beforeEach(() => {
  processFixture.reset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
  vi.stubEnv('LOCK_DIR', lockDirectory);
  vi.stubEnv('CRISIS_KILL_MIN_RSS_MB', '20');
  kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (signal === 0 && processFixture.rows.get(pid)?.alive) return true;
    throw new Error(`Host signal forbidden: ${pid}/${signal}`);
  });
});
afterEach(() => {
  try {
    expect(processFixture.unexpected).toEqual([]);
    expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
  } finally { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); }
});

describe.each(['linux', 'darwin'])('真实 checkRunaways crisis budget：%s', platform => {
  beforeEach(async () => { watchdog = await loadWatchdog(platform); watchdog._taskMetrics.clear(); });

  it.each([[1, [0]], [3, [0]], [4, [0]], [8, [0, 1]], [16, [0, 1, 2, 3]], [20, [0, 1, 2, 3]]])(
    '%s 个候选仅选择 RSS 最高的预算 %j', (count, expected) => {
      // Reverse slot order: a selection that only trusts directory order must fail.
      for (let index = count - 1; index >= 0; index--) processFixture.addTask(index);
      const { actions } = watchdog.checkRunaways(1);
      expect(actions.filter(action => action.action === 'kill').map(action => action.taskId).sort()).toEqual(expected.map(index => `task-${index}`).sort());
      expect(actions.filter(action => action.action === 'warn')).toHaveLength(count - expected.length);
      expect(actions).toHaveLength(count);
      expect(actions.every(action => action.evidence.pressure === 1)).toBe(true);
    },
  );

  it('不足 crisis 压力时，低于 RSS 硬阈值的正常任务不会被杀', () => {
    processFixture.addTask(0);
    expect(watchdog.checkRunaways(0.69).actions).toEqual([]);
    expect(watchdog.checkRunaways(0.99).actions).toEqual([]);
  });

  it('新启动任务在60秒保护期内不成为 crisis 候选', () => {
    processFixture.addTask(0, { started: Date.now() - 59999 });
    expect(watchdog.checkRunaways(1.2).actions).toEqual([]);
  });

  it('失效 slot 的进程不进入候选', () => {
    processFixture.addTask(0, { alive: false });
    expect(watchdog.checkRunaways(1.2).actions).toEqual([]);
  });

  it('树采样计入子进程 RSS，再按整棵树选择最高资源任务', () => {
    processFixture.addTask(0, { rss: 100, childRss: 900 });
    processFixture.addTask(1, { rss: 800 });
    const { actions } = watchdog.checkRunaways(1.2);
    expect(actions.filter(action => action.action === 'kill')).toMatchObject([{ taskId: 'task-0', evidence: { rss_mb: 1000 } }]);
    expect(actions.filter(action => action.action === 'warn').map(action => action.taskId)).toEqual(['task-1']);
  });

  it('未纳入 Brain slot 的有头进程与本会话不会成为任务杀进程目标', () => {
    const managed = processFixture.addTask(0);
    processFixture.addProcess({ pid: process.pid, rss: 4000, command: 'node current-session' });
    processFixture.addProcess({ pid: 90000, rss: 4000, command: 'claude headed-user-session' });
    const { actions } = watchdog.checkRunaways(1.2);
    expect(actions.map(action => action.pid)).toEqual([managed]);
    expect(actions[0].action).toBe('kill');
  });
});
