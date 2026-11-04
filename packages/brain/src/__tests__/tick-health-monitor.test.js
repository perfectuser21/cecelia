import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), start: vi.fn(), stop: vi.fn(), status: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: mocks.query } }));
vi.mock('../tick-loop.js', () => ({ startTickLoop: mocks.start, stopTickLoop: mocks.stop }));
vi.mock('../tick.js', () => ({ getTickStatus: mocks.status }));
vi.mock('../tick-watchdog.js', () => ({ startTickWatchdog: vi.fn() }));
vi.mock('../alertness/index.js', () => ({ initAlertness: vi.fn() }));
vi.mock('../event-bus.js', () => ({ ensureEventsTable: vi.fn() }));
import { disableTick, initTickLoop } from '../tick-recovery.js';

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T00:00:00Z'));
  for (const key of ['BRAIN_PREVIEW','BRAIN_DEPLOY_CANARY','CECELIA_TICK_HARD_OFF','CECELIA_TICK_ENABLED']) vi.stubEnv(key, '');
  mocks.status.mockResolvedValue({ enabled: false });
  mocks.query.mockResolvedValue({ rows: [] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe('真实tick恢复入口的持久化与急停边界', () => {
  it('disableTick记录准确时间/source并停止loop', async () => {
    await disableTick('manual');
    expect(mocks.query.mock.calls[0][1]).toEqual(['tick_enabled', { enabled: false, source: 'manual', disabled_at: '2026-11-04T00:00:00.000Z' }]);
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
  it.each([[59, false], [60, true], [null, true]])('非人工关停%s分钟时恢复=%s', async (minutes, expected) => {
    const value = { enabled: false, source: 'alertness', ...(minutes === null ? {} : { disabled_at: new Date(Date.now() - minutes * 60000).toISOString() }) };
    mocks.query.mockImplementation(async (_sql, params) => ({ rows: params?.[0] === 'tick_enabled' ? [{ value_json: value }] : [] }));
    await initTickLoop();
    expect(mocks.start).toHaveBeenCalledTimes(expected ? 1 : 0);
    const event = mocks.query.mock.calls.find(([sql]) => sql.includes("VALUES ('tick_auto_recover'"));
    expect(Boolean(event)).toBe(expected);
    if (expected) expect(JSON.parse(event[1][0]).auto_recovered).toBe(true);
  });
  it('人工急停即使长期过期且env=true仍不自动开启', async () => {
    vi.stubEnv('CECELIA_TICK_ENABLED', 'true');
    mocks.query.mockResolvedValue({ rows: [{ value_json: { enabled: false, source: 'manual', disabled_at: '2020-01-01T00:00:00Z' } }] });
    await initTickLoop();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
  });
});
