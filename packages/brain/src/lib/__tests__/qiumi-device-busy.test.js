/**
 * lib/qiumi-device-busy.js 单测（任务 5ad81457）：标记行解析、回队/超时判定、回队 UPDATE 形状。
 * 收割器端到端见 src/__tests__/qiumi-device-busy-wait.test.js，真 PG 见 integration/qiumi-device-busy-wait.pg.integration.test.js。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  parseDeviceBusyMarker, planDeviceBusy, requeueForDeviceBusy,
  DEVICE_BUSY_RETRY_MS, DEVICE_BUSY_DEFAULT_WAIT_MS,
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

describe('planDeviceBusy：等待上限 = 截止时间，与执行超时无关', () => {
  const marker = { owner: 'o', serial: 's' };
  const iso = (ms) => new Date(ms).toISOString();
  it('首次忙：requeue、attempts=1、first_at=now、next_run_at=+5min', () => {
    const p = planDeviceBusy({ payload: {}, marker, now: NOW });
    expect(p).toMatchObject({ action: 'requeue', attempts: 1, waitedMs: 0 });
    expect(p.deviceBusy.first_at).toBe(iso(NOW));
    expect(Date.parse(p.nextRunAt) - NOW).toBe(DEVICE_BUSY_RETRY_MS);
  });
  it('无 expires_at / 无 due_at → 默认首次等待起 24 小时', () => {
    expect(DEVICE_BUSY_DEFAULT_WAIT_MS).toBe(24 * 60 * MIN);
    const p = planDeviceBusy({ payload: {}, marker, now: NOW });
    expect(p).toMatchObject({ deadlineSource: 'default_24h', deadlineAt: iso(NOW + DEVICE_BUSY_DEFAULT_WAIT_MS) });
    const first = { device_busy: { first_at: iso(NOW - 23 * 60 * MIN) } };
    expect(planDeviceBusy({ payload: first, marker, now: NOW }).action).toBe('requeue');
    const over = { device_busy: { first_at: iso(NOW - 24 * 60 * MIN) } };
    expect(planDeviceBusy({ payload: over, marker, now: NOW })).toMatchObject({ action: 'expired', nextRunAt: null });
  });
  it('执行超时不参与：timeout_sec=1800 的任务排队 40 分钟仍回队', () => {
    const payload = { timeout_sec: 1800, device_busy_attempts: 8, device_busy: { first_at: iso(NOW - 40 * MIN) } };
    expect(planDeviceBusy({ payload, marker, timeoutSec: 1800, now: NOW }).action).toBe('requeue');
  });
  it('有 payload.expires_at → 按它（优先于 due_at）：未过 requeue，已过 expired', () => {
    const due = iso(NOW + 10 * 60 * MIN);
    const a = planDeviceBusy({ payload: { expires_at: iso(NOW + MIN) }, dueAt: due, marker, now: NOW });
    expect(a).toMatchObject({ action: 'requeue', deadlineSource: 'expires_at', deadlineAt: iso(NOW + MIN) });
    const b = planDeviceBusy({ payload: { expires_at: iso(NOW - 1) }, dueAt: due, marker, now: NOW });
    expect(b).toMatchObject({ action: 'expired', deadlineSource: 'expires_at' });
  });
  it('无 expires_at、有 due_at（中文「预期结束时间」）→ 按它，哪怕超过 24 小时', () => {
    const payload = { device_busy: { first_at: iso(NOW - 30 * 60 * MIN) } };
    const a = planDeviceBusy({ payload, dueAt: new Date(NOW + MIN), marker, now: NOW });
    expect(a).toMatchObject({ action: 'requeue', deadlineSource: 'due_at', deadlineAt: iso(NOW + MIN) });
    const b = planDeviceBusy({ payload: {}, dueAt: iso(NOW - MIN), marker, now: NOW });
    expect(b).toMatchObject({ action: 'expired', deadlineSource: 'due_at' });
  });
  it('due_at 不晚于排期开始时间（存量行把「预期开始时间」误落 due_at）→ 不当截止，走 24 小时默认', () => {
    const start = iso(NOW - 60 * MIN);
    const p = planDeviceBusy({ payload: { scheduled_start: start }, dueAt: start, marker, now: NOW });
    expect(p).toMatchObject({ action: 'requeue', deadlineSource: 'default_24h' });
  });
  it('非法时间忽略', () => {
    const p = planDeviceBusy({ payload: { expires_at: 'garbage' }, dueAt: 'nope', marker, now: NOW });
    expect(p).toMatchObject({ action: 'requeue', deadlineSource: 'default_24h' });
  });
});

describe('requeueForDeviceBusy', () => {
  it('CAS in_progress、payload 删 run_id 后合并、返回是否命中', async () => {
    const plan = planDeviceBusy({ payload: {}, marker: { owner: 'o', serial: 's' }, now: NOW });
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
