/**
 * lib/qiumi-device-busy.js 单测（任务 5ad81457）：标记行解析、回队/超时判定、回队 UPDATE 形状。
 * 收割器端到端见 src/__tests__/qiumi-device-busy-wait.test.js，真 PG 见 integration/qiumi-device-busy-wait.pg.integration.test.js。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  parseDeviceBusyMarker, planDeviceBusy, requeueForDeviceBusy,
  DEVICE_BUSY_RETRY_MS, DEVICE_BUSY_MAX_WAIT_MS,
} from '../qiumi-device-busy.js';

const NOW = Date.parse('2026-09-30T01:15:00.000Z');
const MIN = 60_000;

describe('parseDeviceBusyMarker', () => {
  it('多行时取最后一个标记行', () => {
    expect(parseDeviceBusyMarker('DEVICE_BUSY owner=a serial=1\n中间\nDEVICE_BUSY owner=b serial=2')).toEqual({ owner: 'b', serial: '2' });
  });
  it('字段顺序无关、容忍星号/反引号包裹', () => {
    expect(parseDeviceBusyMarker('**DEVICE_BUSY serial=S9 owner=harvest**')).toEqual({ owner: 'harvest', serial: 'S9' });
  });
  it('不在行首（正文顺嘴提到）不算', () => {
    expect(parseDeviceBusyMarker('没有遇到 DEVICE_BUSY owner=x')).toBeNull();
  });
});

describe('planDeviceBusy', () => {
  const marker = { owner: 'o', serial: 's' };
  it('首次忙：requeue、attempts=1、first_at=now、next_run_at=+5min', () => {
    const p = planDeviceBusy({ payload: {}, marker, timeoutSec: 1800, now: NOW });
    expect(p).toMatchObject({ action: 'requeue', attempts: 1, waitedMs: 0, budgetMs: 30 * MIN });
    expect(p.deviceBusy.first_at).toBe(new Date(NOW).toISOString());
    expect(Date.parse(p.nextRunAt) - NOW).toBe(DEVICE_BUSY_RETRY_MS);
  });
  it('等待预算 = min(任务超时, 120 分钟)', () => {
    expect(planDeviceBusy({ payload: {}, marker, timeoutSec: 10800, now: NOW }).budgetMs).toBe(DEVICE_BUSY_MAX_WAIT_MS);
  });
  it('刚好等满预算 → timeout，nextRunAt=null', () => {
    const payload = { device_busy_attempts: 3, device_busy: { first_at: new Date(NOW - 30 * MIN).toISOString() } };
    const p = planDeviceBusy({ payload, marker, timeoutSec: 1800, now: NOW });
    expect(p).toMatchObject({ action: 'timeout', attempts: 4, nextRunAt: null });
  });
  it('expires_at 已过 → timeout；未过 → requeue；非法时间忽略', () => {
    expect(planDeviceBusy({ payload: { expires_at: new Date(NOW - 1).toISOString() }, marker, timeoutSec: 1800, now: NOW }).action).toBe('timeout');
    expect(planDeviceBusy({ payload: { expires_at: new Date(NOW + MIN).toISOString() }, marker, timeoutSec: 1800, now: NOW }).action).toBe('requeue');
    expect(planDeviceBusy({ payload: { expires_at: 'garbage' }, marker, timeoutSec: 1800, now: NOW }).action).toBe('requeue');
  });
});

describe('requeueForDeviceBusy', () => {
  it('CAS in_progress、payload 删 run_id 后合并、返回是否命中', async () => {
    const plan = planDeviceBusy({ payload: {}, marker: { owner: 'o', serial: 's' }, timeoutSec: 1800, now: NOW });
    const pool = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
    await expect(requeueForDeviceBusy(pool, 't1', plan, 'run-1')).resolves.toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE id = \$1 AND status = 'in_progress'/);
    expect(sql).toMatch(/- 'run_id'\) \|\| \$2::jsonb/);
    expect(JSON.parse(params[1]).device_busy.last_run_id).toBe('run-1');
    expect(JSON.parse(params[2])).toMatchObject({ from: 'in_progress', to: 'queued', source: 'device_busy', attempt: 1 });
    pool.query.mockResolvedValue({ rowCount: 0 });
    await expect(requeueForDeviceBusy(pool, 't1', plan, 'run-1')).resolves.toBe(false);
  });
});
