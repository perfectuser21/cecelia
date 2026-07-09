import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../notifier.js', () => ({
  sendFeishu: vi.fn().mockResolvedValue(true),
}));

import { sendFeishu } from '../../notifier.js';
import { shouldFire, resetDebounce, _debounceStatus } from '../alert-debounce.js';
import { raise } from '../../alerting.js';

describe('alert-debounce 核心', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('连续 N 次才放行：前 N-1 次 false，第 N 次 true', () => {
    const opts = { n: 3, cooldownMs: 60_000 };
    expect(shouldFire('ev-a', opts)).toBe(false);
    expect(shouldFire('ev-a', opts)).toBe(false);
    expect(shouldFire('ev-a', opts)).toBe(true);
  });

  it('放行后进入冷却：冷却期内继续 false，冷却结束后重新计数', () => {
    const opts = { n: 2, cooldownMs: 60_000 };
    shouldFire('ev-b', opts);
    expect(shouldFire('ev-b', opts)).toBe(true);   // 第2次放行
    expect(shouldFire('ev-b', opts)).toBe(false);  // 冷却中
    vi.advanceTimersByTime(61_000);
    expect(shouldFire('ev-b', opts)).toBe(false);  // 冷却结束，重新计数第1次
    expect(shouldFire('ev-b', opts)).toBe(true);   // 第2次再放行
  });

  it('resetDebounce 清零计数（恢复期单次失败不告警）', () => {
    const opts = { n: 2, cooldownMs: 60_000 };
    shouldFire('ev-c', opts);
    resetDebounce('ev-c');
    expect(shouldFire('ev-c', opts)).toBe(false); // 重新从 1 开始
  });

  it('n=1 首击即放行（纯冷却模式）', () => {
    const opts = { n: 1, cooldownMs: 60_000 };
    expect(shouldFire('ev-d', opts)).toBe(true);
    expect(shouldFire('ev-d', opts)).toBe(false);
  });

  it('Map 上限 1000 + 过期 GC（防内存泄漏，抄 notifier 教训）', () => {
    const opts = { n: 5, cooldownMs: 1_000 };
    for (let i = 0; i < 1100; i++) shouldFire(`ev-bulk-${i}`, opts);
    expect(_debounceStatus().entries).toBeLessThanOrEqual(1000);
  });
});

describe('raise() debounce opt-in + 三层串联不吞真告警', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('不传 debounce 完全走老路径（P0 立即发）', async () => {
    await raise('P0', `legacy-${Date.now()}-${Math.random()}`, '老路径回归');
    expect(sendFeishu).toHaveBeenCalledTimes(1);
  });

  it('P1 + debounce{n:2}：第 1 次不入 buffer，第 2 次入', async () => {
    const { getStatus } = await import('../../alerting.js');
    const ev = `flap-${Date.now()}`;
    const before = getStatus().p1_pending;
    await raise('P1', ev, '抖动1', { debounce: { n: 2, cooldownMs: 60_000 } });
    expect(getStatus().p1_pending).toBe(before);
    await raise('P1', ev, '抖动2', { debounce: { n: 2, cooldownMs: 60_000 } });
    expect(getStatus().p1_pending).toBe(before + 1);
  });

  it('组合行为：debounce 放行的第一次真告警必达 P0 发送（debounce→P0限流 串联）', async () => {
    const ev = `combo-${Date.now()}`;
    await raise('P0', ev, '第1次', { debounce: { n: 2, cooldownMs: 600_000 } });
    expect(sendFeishu).not.toHaveBeenCalled();
    await raise('P0', ev, '第2次', { debounce: { n: 2, cooldownMs: 600_000 } });
    expect(sendFeishu).toHaveBeenCalledTimes(1); // debounce 放行后 P0 限流是首次，不吞
  });
});
