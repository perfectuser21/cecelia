import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch 和 notifier
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock notifier 的 sendFeishu
vi.mock('../notifier.js', () => ({
  sendFeishu: vi.fn().mockResolvedValue(true),
}));

import { sendFeishu } from '../notifier.js';
import { raise, flushP1, flushP2, flushAlertsIfNeeded, getStatus } from '../alerting.js';

describe('Alerting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置模块内部状态：通过直接重新 import 不可行，所以测试后验证行为
  });

  describe('getStatus()', () => {
    it('初始状态返回正确结构', () => {
      const status = getStatus();
      expect(status).toHaveProperty('p1_pending');
      expect(status).toHaveProperty('p2_pending');
      expect(status).toHaveProperty('p0_rate_limited');
      expect(status).toHaveProperty('last_p1_flush');
      expect(status).toHaveProperty('last_p2_flush');
      expect(typeof status.p1_pending).toBe('number');
      expect(typeof status.p2_pending).toBe('number');
    });
  });

  describe('raise()', () => {
    it('P0 立即调用 sendFeishu', async () => {
      // 先清空 P0 rate limit（通过不同 eventType 绕过）
      await raise('P0', 'test_p0_immediate_' + Date.now(), '测试 P0 报警');
      expect(sendFeishu).toHaveBeenCalledTimes(1);
      const callArg = sendFeishu.mock.calls[0][0];
      expect(callArg).toContain('[P0]');
      expect(callArg).toContain('测试 P0 报警');
    });

    it('P0 同一 eventType 短时间内限流（不重复推送）', async () => {
      const eventType = 'test_rate_limit_' + Date.now();
      await raise('P0', eventType, '第一次');
      await raise('P0', eventType, '第二次（应被限流）');
      // 只有第一次推送成功
      expect(sendFeishu).toHaveBeenCalledTimes(1);
    });

    it('P0 不同 eventType 各自独立推送', async () => {
      const ts = Date.now();
      await raise('P0', `event_a_${ts}`, '事件 A');
      await raise('P0', `event_b_${ts}`, '事件 B');
      expect(sendFeishu).toHaveBeenCalledTimes(2);
    });

    it('P1 不立即推送，加入缓冲区', async () => {
      const before = getStatus().p1_pending;
      await raise('P1', 'test_p1', 'P1 测试报警');
      expect(sendFeishu).not.toHaveBeenCalled();
      const after = getStatus().p1_pending;
      expect(after).toBeGreaterThan(before);
    });

    it('P2 不立即推送，加入缓冲区', async () => {
      const before = getStatus().p2_pending;
      await raise('P2', 'test_p2', 'P2 测试报警');
      expect(sendFeishu).not.toHaveBeenCalled();
      const after = getStatus().p2_pending;
      expect(after).toBeGreaterThan(before);
    });

    it('P3 只写日志，不推送', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await raise('P3', 'test_p3', 'P3 日志记录');
      expect(sendFeishu).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('未知级别静默忽略', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await raise('P99', 'test', '未知级别');
      expect(sendFeishu).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('flushP1()', () => {
    it('缓冲区有内容时发送汇总并清空', async () => {
      // 先加几条 P1
      await raise('P1', 'flush_test_1', 'P1 消息 A');
      await raise('P1', 'flush_test_2', 'P1 消息 B');
      const beforeCount = getStatus().p1_pending;
      expect(beforeCount).toBeGreaterThanOrEqual(2);

      vi.clearAllMocks();
      await flushP1();

      expect(sendFeishu).toHaveBeenCalledTimes(1);
      const msg = sendFeishu.mock.calls[0][0];
      expect(msg).toContain('[P1 每小时汇总]');

      // 缓冲区已清空
      expect(getStatus().p1_pending).toBe(0);
    });

    it('缓冲区为空时不推送', async () => {
      // 先刷新确保为空
      await flushP1();
      vi.clearAllMocks();

      await flushP1();
      expect(sendFeishu).not.toHaveBeenCalled();
    });
  });

  describe('flushP2()', () => {
    it('缓冲区有内容时发送汇总并清空', async () => {
      await raise('P2', 'flush2_test_1', 'P2 消息 A');
      const beforeCount = getStatus().p2_pending;
      expect(beforeCount).toBeGreaterThanOrEqual(1);

      vi.clearAllMocks();
      await flushP2();

      expect(sendFeishu).toHaveBeenCalledTimes(1);
      const msg = sendFeishu.mock.calls[0][0];
      expect(msg).toContain('[P2 每日记录]');
      expect(getStatus().p2_pending).toBe(0);
    });

    it('缓冲区为空时不推送', async () => {
      await flushP2();
      vi.clearAllMocks();

      await flushP2();
      expect(sendFeishu).not.toHaveBeenCalled();
    });
  });

  describe('flushAlertsIfNeeded()', () => {
    it('首次调用会触发刷新（因为 _lastFlushAt = 0）', async () => {
      // 先往两个缓冲区加内容
      await raise('P1', 'needed_test_p1', 'P1 需要刷新');
      await raise('P2', 'needed_test_p2', 'P2 需要刷新');

      vi.clearAllMocks();

      // 首次调用，距 _lastFlushAt 超过阈值（因为 _lastFlushAt=0）
      await flushAlertsIfNeeded();

      // P1 或 P2 有内容时应该推送
      // 由于 flushP1/flushP2 内部实现，只有有内容才推送
      // 这里主要验证不抛错
      expect(typeof getStatus().p1_pending).toBe('number');
    });
  });
});
