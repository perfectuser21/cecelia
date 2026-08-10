/**
 * blocking-states.test.js — 阻断类状态位 TTL 自愈 + 可见性单元测试
 *
 * 事故实证（2026-08-10）：
 *   ① tick_draining 卡 2h20m（5 条 P0 零派发，健康检查报 healthy）
 *   ② machine_vitals_stale_alert 卡 2 天
 * 共性：进程活着、健康检查绿、日志无异常，系统安静停在错误状态里——"健康地停摆"。
 *
 * 本套覆盖 PRD 4 项必须实现 + 6 条验收断言（TTL 自愈 / 不误伤 / 哨兵可见 /
 * 健康检查红线 / 排空汇总日志 / drain 语义不变），全部在真函数上断言行为。
 *
 * mock 只打在系统边界（db.js / drain.js / event-bus.js / alerting.js），
 * 被测模块 blocking-states.js 的判定逻辑不 mock。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── 系统边界 mock ────────────────────────────────────────────────
const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: queryMock } }));

const drainState = vi.hoisted(() => ({ draining: false, startedAt: null, cancelled: 0 }));
vi.mock('../drain.js', () => ({
  isDraining: () => drainState.draining,
  getDrainStartedAt: () => drainState.startedAt,
  cancelDrain: vi.fn(async () => {
    drainState.cancelled += 1;
    drainState.draining = false;
    drainState.startedAt = null;
    return { success: true, was_draining: true };
  }),
}));

const emitMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../event-bus.js', () => ({ emit: emitMock }));

const raiseMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../alerting.js', () => ({ raise: raiseMock }));

import {
  getBlockingStates,
  reconcileBlockingStates,
  maybeLogDrainSummary,
  summarizeHealth,
  getDrainTtlMs,
  DEFAULT_DRAIN_TTL_MS,
  _resetBlockingStatesForTest,
} from '../blocking-states.js';
import { cancelDrain } from '../drain.js';

const MIN = 60 * 1000;

function setDraining(sinceMsAgo) {
  drainState.draining = true;
  drainState.startedAt = new Date(Date.now() - sinceMsAgo).toISOString();
}

beforeEach(() => {
  drainState.draining = false;
  drainState.startedAt = null;
  drainState.cancelled = 0;
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });
  emitMock.mockClear();
  raiseMock.mockClear();
  cancelDrain.mockClear();
  _resetBlockingStatesForTest();
  delete process.env.DRAIN_TTL_MS;
  delete process.env.DRAIN_SUMMARY_EVERY_N;
});

afterEach(() => {
  delete process.env.DRAIN_TTL_MS;
  delete process.env.DRAIN_SUMMARY_EVERY_N;
});

describe('getDrainTtlMs — TTL 默认 30 分钟，环境变量可覆盖', () => {
  it('未设 env → 默认 30 分钟', () => {
    expect(getDrainTtlMs()).toBe(30 * MIN);
    expect(DEFAULT_DRAIN_TTL_MS).toBe(30 * MIN);
  });

  it('DRAIN_TTL_MS 合法值覆盖默认', () => {
    process.env.DRAIN_TTL_MS = String(5 * MIN);
    expect(getDrainTtlMs()).toBe(5 * MIN);
  });

  it('DRAIN_TTL_MS 非法值（NaN / <=0）回退默认', () => {
    process.env.DRAIN_TTL_MS = 'abc';
    expect(getDrainTtlMs()).toBe(30 * MIN);
    process.env.DRAIN_TTL_MS = '0';
    expect(getDrainTtlMs()).toBe(30 * MIN);
  });
});

describe('getBlockingStates — 列出当前生效阻断位及持续时长', () => {
  it('无阻断位 → 空数组', async () => {
    const states = await getBlockingStates();
    expect(states).toEqual([]);
  });

  it('draining 生效 → 含 tick_draining 及 duration_ms（近似持续时长）', async () => {
    setDraining(7 * MIN);
    const states = await getBlockingStates();
    const draining = states.find((s) => s.key === 'tick_draining');
    expect(draining).toBeTruthy();
    expect(draining.since).toBe(drainState.startedAt);
    // 约 7 分钟（允许执行漂移）
    expect(draining.duration_ms).toBeGreaterThanOrEqual(7 * MIN - 5000);
    expect(draining.duration_human).toMatch(/m|分/);
  });

  it('machine_vitals_stale_alert 哨兵存在 → 从 working_memory 读出并列为阻断位', async () => {
    const since = new Date(Date.now() - 2 * 24 * 60 * MIN).toISOString();
    queryMock.mockImplementation(async (sql) => {
      if (String(sql).includes('working_memory')) {
        return { rows: [{ value_json: { since, last_error: 'spawn docker ENOENT' } }] };
      }
      return { rows: [] };
    });
    const states = await getBlockingStates();
    const vitals = states.find((s) => s.key === 'machine_vitals_stale_alert');
    expect(vitals).toBeTruthy();
    expect(vitals.since).toBe(since);
    expect(vitals.detail).toMatch(/ENOENT/);
    expect(vitals.duration_ms).toBeGreaterThan(24 * 60 * MIN);
  });

  it('DB 查询抛错 → 不崩，仍返回内存态阻断位（可观测降级）', async () => {
    setDraining(3 * MIN);
    queryMock.mockRejectedValue(new Error('db down'));
    const states = await getBlockingStates();
    expect(states.some((s) => s.key === 'tick_draining')).toBe(true);
  });
});

describe('reconcileBlockingStates — TTL 自愈（验收：31 分钟前 → 自动清除 + 事件 + 告警）', () => {
  it('draining 超 TTL（31 分钟前）→ 自动 cancelDrain + auto_recovered 事件 + 告警', async () => {
    setDraining(31 * MIN);
    const result = await reconcileBlockingStates();

    // 状态位被自动清除
    expect(cancelDrain).toHaveBeenCalledTimes(1);
    expect(drainState.draining).toBe(false);

    // 产生 auto_recovered 事件（留痕，禁静默）
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventType, , payload] = emitMock.mock.calls[0];
    expect(eventType).toBe('auto_recovered');
    expect(payload.key).toBe('tick_draining');
    expect(payload.stuck_ms).toBeGreaterThanOrEqual(31 * MIN - 5000);
    expect(payload).toHaveProperty('recovered_at');

    // 发出告警，且说明曾卡多久
    expect(raiseMock).toHaveBeenCalledTimes(1);
    const [, , message] = raiseMock.mock.calls[0];
    expect(message).toMatch(/tick_draining/);
    expect(message).toMatch(/自动|已解除|恢复/);

    // 返回结构含 auto_recovered
    expect(result.auto_recovered).toHaveLength(1);
    expect(result.auto_recovered[0].key).toBe('tick_draining');
  });

  it('验收（不误伤）：draining 仅 5 分钟 → 不清除，无事件无告警', async () => {
    setDraining(5 * MIN);
    const result = await reconcileBlockingStates();

    expect(cancelDrain).not.toHaveBeenCalled();
    expect(drainState.draining).toBe(true);
    expect(emitMock).not.toHaveBeenCalled();
    expect(raiseMock).not.toHaveBeenCalled();
    expect(result.auto_recovered).toHaveLength(0);
  });

  it('未 draining → 完全 no-op（不查库、不发事件）', async () => {
    const result = await reconcileBlockingStates();
    expect(cancelDrain).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
    expect(result.auto_recovered).toHaveLength(0);
  });

  it('TTL 环境变量收窄后，6 分钟即触发自愈（验证 TTL 可配）', async () => {
    process.env.DRAIN_TTL_MS = String(5 * MIN);
    setDraining(6 * MIN);
    const result = await reconcileBlockingStates();
    expect(cancelDrain).toHaveBeenCalledTimes(1);
    expect(result.auto_recovered).toHaveLength(1);
  });

  it('drain_started_at 不可解析 → 不误清（无法证明超时则保守不动）', async () => {
    drainState.draining = true;
    drainState.startedAt = 'not-a-date';
    const result = await reconcileBlockingStates();
    expect(cancelDrain).not.toHaveBeenCalled();
    expect(result.auto_recovered).toHaveLength(0);
  });
});

describe('maybeLogDrainSummary — 可观测兜底（验收：每 N 轮至少一条汇总日志）', () => {
  it('排空生效 N+1 轮 → 至少出现一条含"已排空时长 + 被挡候选数"的汇总日志', async () => {
    process.env.DRAIN_SUMMARY_EVERY_N = '2';
    setDraining(9 * MIN);
    queryMock.mockResolvedValue({ rows: [{ n: 5 }] });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    let logged = 0;
    for (let round = 0; round < 3; round++) {
      // N=2 → 3 轮（N+1）
      if (await maybeLogDrainSummary()) logged += 1;
    }
    logSpy.mockRestore();

    expect(logged).toBeGreaterThanOrEqual(1);
    const summaryLines = logSpy.mock.calls
      .map((c) => c.join(' '))
      .filter((l) => l.includes('drain') && (l.includes('候选') || l.includes('candidate')));
    expect(summaryLines.length).toBeGreaterThanOrEqual(1);
    // 汇总必须含被挡候选数（来自 queued 计数）
    expect(summaryLines.join('\n')).toMatch(/5/);
  });

  it('未到 N 轮 → 不打印（避免刷屏）', async () => {
    process.env.DRAIN_SUMMARY_EVERY_N = '5';
    setDraining(1 * MIN);
    const logged1 = await maybeLogDrainSummary();
    expect(logged1).toBe(false);
  });

  it('queued 计数查询失败 → 不阻断，仍打印（候选数降级为未知）', async () => {
    process.env.DRAIN_SUMMARY_EVERY_N = '1';
    setDraining(2 * MIN);
    queryMock.mockRejectedValue(new Error('db down'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logged = await maybeLogDrainSummary();
    logSpy.mockRestore();
    expect(logged).toBe(true);
  });
});

describe('summarizeHealth — 健康检查红线（验收：有阻断位不得报 healthy）', () => {
  it('无阻断位 → healthy=true, blocked=false', () => {
    const h = summarizeHealth([]);
    expect(h.healthy).toBe(true);
    expect(h.blocked).toBe(false);
  });

  it('有 draining 阻断位 → healthy=false, blocked=true, 摘要含 tick_draining', () => {
    const states = [{ key: 'tick_draining', duration_ms: 3 * MIN, duration_human: '3m' }];
    const h = summarizeHealth(states);
    expect(h.healthy).toBe(false);
    expect(h.blocked).toBe(true);
    expect(h.blocking_summary).toMatch(/tick_draining/);
    // 摘要必须带持续时长（可判读）
    expect(h.blocking_summary).toMatch(/3m/);
  });
});
