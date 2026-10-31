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

describe.each(['linux', 'darwin'])('真实 crisis 最小 RSS 保护：%s', platform => {
  beforeEach(async () => { watchdog = await loadWatchdog(platform); watchdog._taskMetrics.clear(); });

  it.each([[2, 0], [19, 0], [20, 1], [21, 1]])('单任务 RSS=%sMB → %s 个 kill', (rss, expectedKills) => {
    processFixture.addTask(0, { rss });
    const { actions } = watchdog.checkRunaways(1.04);
    expect(actions).toHaveLength(1);
    expect(actions.filter(action => action.action === 'kill')).toHaveLength(expectedKills);
    expect(actions.filter(action => action.action === 'warn')).toHaveLength(1 - expectedKills);
    expect(actions[0].evidence.rss_mb).toBe(rss);
  });

  it('三个2MB刚启动的轻量候选全部降为 warn，不能仅返回空数组假装安全', () => {
    for (let index = 0; index < 3; index++) processFixture.addTask(index, { rss: 2 });
    const { actions } = watchdog.checkRunaways(1.04);
    expect(actions.map(action => action.action)).toEqual(['warn', 'warn', 'warn']);
    expect(actions.map(action => action.taskId).sort()).toEqual(['task-0', 'task-1', 'task-2']);
  });

  it('混合100/80/5/3MB时只有最高100MB任务成为kill', () => {
    [100, 80, 5, 3].forEach((rss, index) => processFixture.addTask(index, { rss }));
    const { actions } = watchdog.checkRunaways(1);
    expect(actions.filter(action => action.action === 'kill')).toMatchObject([{ taskId: 'task-0', evidence: { rss_mb: 100 } }]);
    expect(actions.filter(action => action.action === 'warn')).toHaveLength(3);
  });
});
