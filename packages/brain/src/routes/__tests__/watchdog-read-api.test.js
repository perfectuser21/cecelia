import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import express from 'express';
import request from 'supertest';

const boundary = vi.hoisted(() => ({query: vi.fn(), external: vi.fn(),
  status: vi.fn(), trends: vi.fn(), monitor: vi.fn()}));
vi.mock('../../db.js', () => ({default: {query: boundary.query}}));
vi.mock('../../tick.js', () => ({
  getTickStatus: vi.fn(), enableTick: vi.fn(), disableTick: vi.fn(), executeTick: vi.fn(),
  runTickSafe: vi.fn(), drainTick: vi.fn(), getDrainStatus: vi.fn(), cancelDrain: vi.fn(),
  getStartupErrors: vi.fn(), check48hReport: vi.fn(),
}));
vi.mock('../../alertness/index.js', () => ({
  getCurrentAlertness: vi.fn(), setManualOverride: vi.fn(), clearManualOverride: vi.fn(),
  evaluateAlertness: vi.fn(), ALERTNESS_LEVELS: {}, LEVEL_NAMES: {},
}));
// 真实规范模块身份。禁止导入真实watchdog：顶层getconf和getter的slot/proc探测均无需执行。
vi.mock('../../watchdog.js', () => ({
  getWatchdogStatus: boundary.status, getWatchdogTrends: boundary.trends,
  checkRunaways: boundary.monitor, checkIdleSessions: boundary.monitor,
  sampleProcess: boundary.monitor, checkAndTriggerHealing: boundary.monitor,
}));
vi.mock('child_process', () => ({execSync: boundary.external, execFile: boundary.external, spawn: boundary.external}));
vi.mock('node:child_process', () => ({execSync: boundary.external, execFile: boundary.external, spawn: boundary.external}));
import router from '../tick.js';

const app = express().use('/api/brain', router);
const status = {thresholds: {rss_kill_mb: 2400}, tasks: [{task_id: 'owned-fixture', last_rss_mb: null}], stale_slots: []};
const trends = {trends: [{task_id: 'owned-fixture', slope_mb_per_min: 3}], alerts: [], thresholds: {rss_warn_mb: 1800}};
beforeEach(() => {
  vi.resetAllMocks();
  boundary.status.mockReturnValue(status); boundary.trends.mockReturnValue(trends);
  boundary.query.mockImplementation(() => {throw Error('database forbidden');});
  boundary.external.mockImplementation(() => {throw Error('external process forbidden');});
  boundary.monitor.mockImplementation(() => {throw Error('monitoring forbidden');});
  vi.stubGlobal('fetch', boundary.external);
  vi.spyOn(process, 'kill').mockImplementation(boundary.external);
});
afterEach(() => {
  expect(boundary.query).not.toHaveBeenCalled();
  expect(boundary.monitor).not.toHaveBeenCalled();
  expect(boundary.external).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
for (const [path, getter, other, value, error] of [
  ['/watchdog', boundary.status, boundary.trends, status, 'Failed to get watchdog status'],
  ['/watchdog/trends', boundary.trends, boundary.status, trends, 'Failed to get watchdog trends'],
]) describe('真实注册只读路由' + path, () => {
  it('只调用规范模块的对应getter，保留数据封套和unknown字段', async () => {
    const response = await request(app).get('/api/brain' + path);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({success: true, ...value});
    expect(getter).toHaveBeenCalledExactlyOnceWith();
    expect(other).not.toHaveBeenCalled();
  });
  it('getter故障诚实500，不假成功或调用监控恢复', async () => {
    getter.mockImplementationOnce(() => {throw Error('owned-read-failure');});
    const response = await request(app).get('/api/brain' + path);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({error, details: 'owned-read-failure'});
    expect(getter).toHaveBeenCalledExactlyOnceWith();
    expect(other).not.toHaveBeenCalled();
  });
});
