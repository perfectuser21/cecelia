/**
 * alerting-flush-flow 集成测试
 *
 * 覆盖路径：
 *   Path 1: raise('P0', ...) — 立即推送 + 5 分钟限流（同 eventType 第二次跳过）
 *   Path 2: raise('P1', ...) — 加入 P1 缓冲区，不立即推送
 *   Path 3: raise('P2', ...) — 加入 P2 缓冲区，不立即推送
 *   Path 4: flushP1() — 缓冲区有内容时调用 sendFeishu，然后清空
 *   Path 5: flushP2() — 缓冲区有内容时调用 sendFeishu，然后清空
 *   Path 6: flushAlertsIfNeeded() — 时间门控：首次调用触发 P1/P2 flush
 *   Path 7: getStatus() — 反映当前缓冲区和限流状态
 *
 * 测试策略：
 *   - vi.resetModules() 每次重新加载 alerting.js（重置模块内部状态）
 *   - mock notifier.js 的 sendFeishu（不测实际飞书 API）
 *   - 使用 vi.setSystemTime 控制 Date.now()（测试 P0 限流时间窗口）
 *
 * 关联模块：alerting.js → notifier.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock notifier.js（不发真实飞书 API 请求）────────────────────────────────
vi.mock('../../notifier.js', () => ({
  sendFeishu: vi.fn().mockResolvedValue(true),
}));

// ─────────────────────────────────────────────────────────────────────────────

describe('Alerting flush-flow 集成测试', () => {
  let raise, flushP1, flushP2, flushAlertsIfNeeded, getStatus;
  let sendFeishu;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    // 每次重新 import 以重置模块级内部状态（buffer、rate-limit Map）
    const alertingMod = await import('../../alerting.js');
    raise = alertingMod.raise;
    flushP1 = alertingMod.flushP1;
    flushP2 = alertingMod.flushP2;
    flushAlertsIfNeeded = alertingMod.flushAlertsIfNeeded;
    getStatus = alertingMod.getStatus;

    const notifierMod = await import('../../notifier.js');
    sendFeishu = notifierMod.sendFeishu;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ─── Path 1: P0 立即推送 + 5 分钟限流 ────────────────────────────────────

  describe('Path 1: P0 立即推送与限流', () => {
    it('P0 第一次 raise → sendFeishu 立即被调用一次', async () => {
      await raise('P0', 'circuit_open_test', '熔断触发：连续失败');
      // sendFeishu 是异步 fire-and-forget，需等 microtasks
      await Promise.resolve();
      expect(sendFeishu).toHaveBeenCalledTimes(1);
      const msg = sendFeishu.mock.calls[0][0];
      expect(msg).toContain('[P0]');
      expect(msg).toContain('熔断触发：连续失败');
    });

    it('P0 同一 eventType 在 5 分钟内第二次 raise → 被限流，不重复推送', async () => {
      await raise('P0', 'dup_event', '第一次报警');
      await Promise.resolve();
      expect(sendFeishu).toHaveBeenCalledTimes(1);

      // 推进时间 1 分钟（未超限流窗口）
      vi.advanceTimersByTime(60 * 1000);
      await raise('P0', 'dup_event', '第二次报警（应被限流）');
      await Promise.resolve();
      // 仍然只调用了 1 次
      expect(sendFeishu).toHaveBeenCalledTimes(1);
    });

    it('P0 同一 eventType 超过 5 分钟后 → 再次推送', async () => {
      await raise('P0', 'timeout_event', '第一次');
      await Promise.resolve();
      expect(sendFeishu).toHaveBeenCalledTimes(1);

      // 推进 5 分钟 + 1ms（超出限流窗口）
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      await raise('P0', 'timeout_event', '第二次（应推送）');
      await Promise.resolve();
      expect(sendFeishu).toHaveBeenCalledTimes(2);
    });

    it('P0 不同 eventType → 各自独立推送', async () => {
      await raise('P0', 'event_a', '事件 A');
      await raise('P0', 'event_b', '事件 B');
      await Promise.resolve();
      expect(sendFeishu).toHaveBeenCalledTimes(2);
    });

    it('P0 rate-limit 状态反映在 getStatus()', async () => {
      await raise('P0', 'status_event', '测试状态');
      await Promise.resolve();
      const status = getStatus();
      expect(status.p0_rate_limited).toHaveProperty('status_event');
    });
  });

  // ─── Path 2: P1 缓冲区行为 ───────────────────────────────────────────────

  describe('Path 2: P1 缓冲区', () => {
    it('P1 raise 不立即调用 sendFeishu', async () => {
      await raise('P1', 'degraded_service', '核心功能降级');
      expect(sendFeishu).not.toHaveBeenCalled();
    });

    it('P1 raise 后 getStatus().p1_pending 增加', async () => {
      const before = getStatus().p1_pending;
      await raise('P1', 'degraded_a', '降级 A');
      await raise('P1', 'degraded_b', '降级 B');
      const after = getStatus().p1_pending;
      expect(after).toBe(before + 2);
    });

    it('P1 多条 raise 后 flushP1 → sendFeishu 调用一次，缓冲区清空', async () => {
      await raise('P1', 'ev_1', '消息 1');
      await raise('P1', 'ev_2', '消息 2');
      await raise('P1', 'ev_3', '消息 3');
      expect(getStatus().p1_pending).toBe(3);

      await flushP1();
      expect(sendFeishu).toHaveBeenCalledTimes(1);
      const msg = sendFeishu.mock.calls[0][0];
      expect(msg).toContain('[P1');
      expect(msg).toContain('3');
      // 缓冲区清空
      expect(getStatus().p1_pending).toBe(0);
    });

    it('P1 缓冲区为空时 flushP1 → 不调用 sendFeishu', async () => {
      await flushP1();
      expect(sendFeishu).not.toHaveBeenCalled();
    });
  });

  // ─── Path 3: P2 缓冲区行为 ───────────────────────────────────────────────

  describe('Path 3: P2 缓冲区', () => {
    it('P2 raise 不立即调用 sendFeishu', async () => {
      await raise('P2', 'task_failed', '单次任务失败');
      expect(sendFeishu).not.toHaveBeenCalled();
    });

    it('P2 raise 后 getStatus().p2_pending 增加', async () => {
      const before = getStatus().p2_pending;
      await raise('P2', 'task_1', '任务 1 失败');
      const after = getStatus().p2_pending;
      expect(after).toBe(before + 1);
    });

    it('P2 raise 后 flushP2 → sendFeishu 调用一次，缓冲区清空', async () => {
      await raise('P2', 'fail_x', '任务 X 失败');
      await raise('P2', 'fail_y', '任务 Y 失败');
      expect(getStatus().p2_pending).toBe(2);

      await flushP2();
      expect(sendFeishu).toHaveBeenCalledTimes(1);
      const msg = sendFeishu.mock.calls[0][0];
      expect(msg).toContain('[P2');
      expect(getStatus().p2_pending).toBe(0);
    });

    it('P2 缓冲区为空时 flushP2 → 不调用 sendFeishu', async () => {
      await flushP2();
      expect(sendFeishu).not.toHaveBeenCalled();
    });
  });

  // ─── Path 4: P3 只写日志，不推送 ─────────────────────────────────────────

  describe('Path 4: P3 只记录日志', () => {
    it('P3 raise 不调用 sendFeishu，也不影响缓冲区', async () => {
      await raise('P3', 'debug_event', '调试信息');
      expect(sendFeishu).not.toHaveBeenCalled();
      expect(getStatus().p1_pending).toBe(0);
      expect(getStatus().p2_pending).toBe(0);
    });
  });

  // ─── Path 5: 无效级别忽略 ────────────────────────────────────────────────

  describe('Path 5: 无效级别', () => {
    it('未知级别 raise → 不调用 sendFeishu', async () => {
      await raise('INVALID', 'ev', '无效级别报警');
      expect(sendFeishu).not.toHaveBeenCalled();
    });
  });

  // ─── Path 6: flushAlertsIfNeeded 时间门控 ────────────────────────────────

  describe('Path 6: flushAlertsIfNeeded 时间门控', () => {
    it('首次调用（_lastP1FlushAt=0）→ P1 缓冲区被 flush', async () => {
      await raise('P1', 'degraded', '降级');
      // 首次调用时 _lastP1FlushAt=0，距 now > P1_FLUSH_INTERVAL_MS (1h)
      await flushAlertsIfNeeded();
      expect(sendFeishu).toHaveBeenCalledTimes(1);
      expect(getStatus().p1_pending).toBe(0);
    });

    it('首次调用后立即再次调用 → P1 不重复 flush（时间窗口未过）', async () => {
      await raise('P1', 'ev_1', '消息 1');
      await flushAlertsIfNeeded(); // 触发 flush，清空缓冲区
      vi.clearAllMocks();

      await raise('P1', 'ev_2', '消息 2');
      // 未推进时间，1h 窗口未过
      await flushAlertsIfNeeded();
      // 这次不应 flush
      expect(sendFeishu).not.toHaveBeenCalled();
      expect(getStatus().p1_pending).toBe(1);
    });

    it('推进 1 小时后再次调用 → P1 再次 flush', async () => {
      await raise('P1', 'ev_first', '首次消息');
      await flushAlertsIfNeeded(); // 首次 flush
      vi.clearAllMocks();

      await raise('P1', 'ev_second', '第二次消息');
      vi.advanceTimersByTime(60 * 60 * 1000 + 1); // 推进 1h+
      await flushAlertsIfNeeded(); // 再次 flush
      expect(sendFeishu).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Path 7: getStatus 结构完整性 ────────────────────────────────────────

  describe('Path 7: getStatus() 结构完整性', () => {
    it('初始状态返回正确结构', () => {
      const status = getStatus();
      expect(status).toHaveProperty('p1_pending');
      expect(status).toHaveProperty('p2_pending');
      expect(status).toHaveProperty('p0_rate_limited');
      expect(status).toHaveProperty('last_p1_flush');
      expect(status).toHaveProperty('last_p2_flush');
      expect(typeof status.p1_pending).toBe('number');
      expect(typeof status.p2_pending).toBe('number');
      expect(typeof status.p0_rate_limited).toBe('object');
    });

    it('flushAlertsIfNeeded 后 last_p1_flush 更新为非 null', async () => {
      await flushAlertsIfNeeded();
      const status = getStatus();
      expect(status.last_p1_flush).not.toBeNull();
    });
  });
});
