/**
 * feishu-alerter 单元测试
 * 覆盖：告警发送、10min 聚合窗口、连败升级、webhook 失败降级
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFeishuAlerter } from '../feishu-alerter.js';

describe('feishu-alerter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('send() 把事件放入聚合缓冲区，窗口结束后调用 webhookFn', async () => {
    const webhookFn = vi.fn().mockResolvedValue(undefined);
    const alerter = createFeishuAlerter({ webhookFn, aggregationWindowMs: 5000 });

    alerter.send({ type: 'eval_failed', task_id: 't1' });
    alerter.send({ type: 'eval_failed', task_id: 't2' });

    // 窗口未到，webhook 未触发
    expect(webhookFn).not.toHaveBeenCalled();

    // 推进时间，触发 flush
    vi.advanceTimersByTime(5001);
    await Promise.resolve();

    expect(webhookFn).toHaveBeenCalledTimes(1);
    const payload = webhookFn.mock.calls[0][0];
    expect(payload.type).toBe('eval_failed');
    expect(payload.count).toBe(2);
    expect(payload.events).toHaveLength(2);

    alerter.destroy();
  });

  it('默认聚合窗口为 10 分钟（600000ms），窗口内多次 send 只触发一次 flush', async () => {
    const webhookFn = vi.fn().mockResolvedValue(undefined);
    const alerter = createFeishuAlerter({ webhookFn });

    alerter.send({ type: 'timeout', task_id: 'a' });
    alerter.send({ type: 'timeout', task_id: 'b' });
    alerter.send({ type: 'timeout', task_id: 'c' });

    // 9 分钟内不触发
    vi.advanceTimersByTime(9 * 60 * 1000);
    await Promise.resolve();
    expect(webhookFn).not.toHaveBeenCalled();

    // 10 分钟后触发
    vi.advanceTimersByTime(60 * 1000 + 100);
    await Promise.resolve();
    expect(webhookFn).toHaveBeenCalledTimes(1);
    expect(webhookFn.mock.calls[0][0].count).toBe(3);

    alerter.destroy();
  });

  it('recordFailure 连败 ≥3 时，flush payload 带 escalated=true 和 level=P0', async () => {
    const webhookFn = vi.fn().mockResolvedValue(undefined);
    const alerter = createFeishuAlerter({
      webhookFn,
      aggregationWindowMs: 100,
      escalationThreshold: 3,
    });

    alerter.recordFailure({ type: 'eval_failed', task_id: 'x1' });
    alerter.recordFailure({ type: 'eval_failed', task_id: 'x2' });
    alerter.recordFailure({ type: 'eval_failed', task_id: 'x3' });

    vi.advanceTimersByTime(200);
    await Promise.resolve();

    expect(webhookFn).toHaveBeenCalled();
    const payload = webhookFn.mock.calls[0][0];
    expect(payload.escalated).toBe(true);
    expect(payload.level).toBe('P0');

    alerter.destroy();
  });

  it('recordSuccess 重置连败计数，后续 flush 不带 escalated', async () => {
    const webhookFn = vi.fn().mockResolvedValue(undefined);
    const alerter = createFeishuAlerter({
      webhookFn,
      aggregationWindowMs: 100,
      escalationThreshold: 3,
    });

    // 制造 3 次连败，先 flush
    alerter.recordFailure({ type: 'eval_failed', task_id: 'y1' });
    alerter.recordFailure({ type: 'eval_failed', task_id: 'y2' });
    alerter.recordFailure({ type: 'eval_failed', task_id: 'y3' });
    vi.advanceTimersByTime(200);
    await Promise.resolve();

    // 成功重置
    alerter.recordSuccess({});

    // 再发一次失败（连败归 1，不升级）
    alerter.recordFailure({ type: 'eval_failed', task_id: 'y4' });
    vi.advanceTimersByTime(200);
    await Promise.resolve();

    const lastPayload = webhookFn.mock.calls[webhookFn.mock.calls.length - 1][0];
    expect(lastPayload.escalated).toBeUndefined();

    alerter.destroy();
  });

  it('webhook 失败时调用 fallbackFn 做本地日志兜底', async () => {
    const webhookFn = vi.fn().mockRejectedValue(new Error('network error'));
    const fallbackFn = vi.fn().mockResolvedValue(undefined);
    const alerter = createFeishuAlerter({ webhookFn, fallbackFn, aggregationWindowMs: 50 });

    alerter.send({ type: 'eval_failed', task_id: 'z1' });
    vi.advanceTimersByTime(100);
    // drain multiple microtask turns: timer fires sync, then awaits webhookFn (rejects), then catch awaits fallbackFn
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(webhookFn).toHaveBeenCalled();
    expect(fallbackFn).toHaveBeenCalled();
    const fallbackArg = fallbackFn.mock.calls[0][0];
    expect(fallbackArg.type).toBe('eval_failed');
    expect(fallbackArg.error).toBe('network error');

    alerter.destroy();
  });

  it('不同 type 的事件进入不同 bucket，各自独立 flush', async () => {
    const webhookFn = vi.fn().mockResolvedValue(undefined);
    const alerter = createFeishuAlerter({ webhookFn, aggregationWindowMs: 200 });

    alerter.send({ type: 'timeout' });
    alerter.send({ type: 'quota_insufficient' });

    vi.advanceTimersByTime(300);
    await Promise.resolve();

    expect(webhookFn).toHaveBeenCalledTimes(2);
    const types = webhookFn.mock.calls.map(c => c[0].type);
    expect(types).toContain('timeout');
    expect(types).toContain('quota_insufficient');

    alerter.destroy();
  });
});
