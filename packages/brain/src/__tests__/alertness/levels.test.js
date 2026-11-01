import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';

const { query, command } = vi.hoisted(() => ({
  query: vi.fn(async sql => ({ rows: sql.includes('COUNT(*)') ? [{ count: '0' }] : [], rowCount: 0 })),
  command: vi.fn((_command, callback) => callback(new Error('Host command forbidden'))),
}));
vi.mock('../../db.js', () => ({
  default: { query, connect: async () => ({ query, release() {} }) },
  getPoolHealth: () => ({ waiting: 0, idle: 1, total: 1, activeCount: 0 }),
}));
vi.mock('../../event-bus.js', () => ({ emit: vi.fn() }));
vi.mock('../../events/taskEvents.js', () => ({ publishAlertnessChanged: vi.fn() }));
vi.mock('child_process', async () => ({ ...(await vi.importActual('child_process')), exec: command }));

let alertness;
let kill;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
  vi.spyOn(process, 'memoryUsage').mockReturnValue({ rss: 100 * 1024 * 1024, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 });
  vi.spyOn(process, 'cpuUsage').mockReturnValue({ user: 0, system: 0 });
  vi.spyOn(os, 'loadavg').mockReturnValue([0, 0, 0]);
  vi.spyOn(os, 'cpus').mockReturnValue([{}, {}]);
  kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('Host signal forbidden'); });
  alertness = await import('../../alertness/index.js');
});
afterEach(() => {
  try {
    expect(command).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  } finally {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});

describe('旧 levels 迁入：真实状态、派发与降级控制', () => {
  it.each([
    [0, 'SLEEPING', 0, true, true],
    [1, 'CALM', 1, true, true],
    [2, 'AWARE', 0.7, true, true],
    [3, 'ALERT', 0.3, true, false],
    [4, 'PANIC', 0, false, false],
  ])('level=%s → %s，派发率=%s', async (level, name, rate, dispatch, plan) => {
    await alertness.setManualOverride(level, '测试已批准覆盖');
    expect(alertness.getCurrentAlertness()).toMatchObject({ level, levelName: name, isRecovering: false, reason: 'Manual override: 测试已批准覆盖' });
    expect(alertness.getDispatchRate()).toBe(rate);
    expect(alertness.canDispatch()).toBe(dispatch);
    expect(alertness.canPlan()).toBe(plan);
  });

  it('ALERT 在一分钟冷却内保持等级；随后仅逐级降为 AWARE→CALM', async () => {
    await alertness.setManualOverride(3, '已确认告警', 0);
    await vi.advanceTimersByTimeAsync(1);
    await alertness.evaluateAlertness();
    expect(alertness.getCurrentAlertness().level).toBe(3);
    await vi.advanceTimersByTimeAsync(59998);
    await alertness.evaluateAlertness();
    expect(alertness.getCurrentAlertness().level).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    await alertness.evaluateAlertness();
    expect(alertness.getCurrentAlertness()).toMatchObject({ level: 2, levelName: 'AWARE' });
    expect(alertness.getDispatchRate()).toBe(0.7);
    await vi.advanceTimersByTimeAsync(60000);
    await alertness.evaluateAlertness();
    expect(alertness.getCurrentAlertness()).toMatchObject({ level: 1, levelName: 'CALM' });
    expect(alertness.getDispatchRate()).toBe(1);
  });

  it('SLEEPING 的零速率随真实健康评估恢复为 CALM 全速派发', async () => {
    await alertness.setManualOverride(0, '休眠', 0);
    expect(alertness.getDispatchRate()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await alertness.evaluateAlertness();
    expect(alertness.getCurrentAlertness()).toMatchObject({ level: 1, levelName: 'CALM' });
    expect(alertness.getDispatchRate()).toBe(1);
  });
});
