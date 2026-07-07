/**
 * INV-10: 飞书告警聚合 & 连败升级
 * 同类告警 10min 合并；连败 ≥ 3 次升级；webhook 失败 → 本地日志兜底
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFeishuAlerter } from '../../../packages/brain/src/feishu-alerter.js';

describe('INV-10: 飞书告警聚合 & 连败升级', () => {
  let alerter;
  let webhookCalls;
  let fallbackLogs;

  beforeEach(() => {
    webhookCalls = [];
    fallbackLogs = [];

    // Mock webhook 调用
    const mockWebhook = vi.fn(async (payload) => {
      webhookCalls.push({ ...payload, sentAt: Date.now() });
    });

    // Mock 本地日志兜底
    const mockFallback = vi.fn(async (entry) => {
      fallbackLogs.push({ ...entry, loggedAt: Date.now() });
    });

    alerter = createFeishuAlerter({
      webhookFn: mockWebhook,
      fallbackFn: mockFallback,
      aggregationWindowMs: 100, // 测试用 100ms 聚合窗口
      escalationThreshold: 3,
    });
  });

  afterEach(() => {
    alerter.destroy?.();
    vi.restoreAllMocks();
  });

  it('聚合窗口内同类告警只发送 1 条消息', async () => {
    // 快速触发 3 次同类告警
    alerter.send({ type: 'timeout', task_id: 'task-1', message: '超时1' });
    alerter.send({ type: 'timeout', task_id: 'task-2', message: '超时2' });
    alerter.send({ type: 'timeout', task_id: 'task-3', message: '超时3' });

    // 等待聚合窗口结束（100ms）
    await new Promise(r => setTimeout(r, 200));

    // 只发送了 1 条消息
    const timeoutAlerts = webhookCalls.filter(c => c.type === 'timeout');
    expect(timeoutAlerts).toHaveLength(1);
  });

  it('聚合消息包含所有合并的事件信息', async () => {
    alerter.send({ type: 'quota', task_id: 'task-a', message: '额度不足A' });
    alerter.send({ type: 'quota', task_id: 'task-b', message: '额度不足B' });

    await new Promise(r => setTimeout(r, 200));

    const quotaAlert = webhookCalls.find(c => c.type === 'quota');
    expect(quotaAlert).toBeDefined();
    // 聚合消息应包含 count 或合并详情
    expect(quotaAlert.count || quotaAlert.events?.length).toBeGreaterThanOrEqual(2);
  });

  it('不同类型告警不互相聚合', async () => {
    alerter.send({ type: 'timeout', task_id: 't1', message: '超时' });
    alerter.send({ type: 'quota', task_id: 't2', message: '额度不足' });
    alerter.send({ type: 'ssh_failed', task_id: 't3', message: 'SSH失败' });

    await new Promise(r => setTimeout(r, 200));

    const types = webhookCalls.map(c => c.type);
    expect(types).toContain('timeout');
    expect(types).toContain('quota');
    expect(types).toContain('ssh_failed');
    // 每种类型最多 1 条
    expect(types.filter(t => t === 'timeout')).toHaveLength(1);
  });

  it('连续失败 ≥ 3 次 → 告警携带升级标记', async () => {
    // 触发 3 次连续失败
    alerter.recordFailure({ type: 'eval_failed', task_id: 'f1' });
    alerter.recordFailure({ type: 'eval_failed', task_id: 'f2' });
    alerter.recordFailure({ type: 'eval_failed', task_id: 'f3' });

    await new Promise(r => setTimeout(r, 200));

    const escalatedAlert = webhookCalls.find(c => c.escalated === true || c.level === 'P0');
    expect(escalatedAlert).toBeDefined();
  });

  it('成功后连败计数器重置', async () => {
    alerter.recordFailure({ type: 'eval_failed', task_id: 'f1' });
    alerter.recordFailure({ type: 'eval_failed', task_id: 'f2' });
    alerter.recordSuccess({ task_id: 's1' }); // 成功打断连败

    await new Promise(r => setTimeout(r, 200));

    // 再失败 2 次，不应升级（计数器已重置）
    webhookCalls.length = 0; // 清空记录
    alerter.recordFailure({ type: 'eval_failed', task_id: 'f3' });
    alerter.recordFailure({ type: 'eval_failed', task_id: 'f4' });

    await new Promise(r => setTimeout(r, 200));

    const escalatedAlert = webhookCalls.find(c => c.escalated === true || c.level === 'P0');
    expect(escalatedAlert).toBeUndefined();
  });

  it('webhook 调用失败 → 写入本地日志兜底', async () => {
    const failingAlerter = createFeishuAlerter({
      webhookFn: vi.fn().mockRejectedValue(new Error('webhook failed')),
      fallbackFn: async (entry) => { fallbackLogs.push(entry); },
      aggregationWindowMs: 100,
      escalationThreshold: 3,
    });

    failingAlerter.send({ type: 'timeout', task_id: 'fallback-task', message: '测试' });

    await new Promise(r => setTimeout(r, 200));

    expect(fallbackLogs).toHaveLength(1);
    expect(fallbackLogs[0]).toMatchObject({ type: 'timeout' });

    failingAlerter.destroy?.();
  });

  it('fallback 日志条目应含时间戳和原始事件', async () => {
    const failingAlerter = createFeishuAlerter({
      webhookFn: vi.fn().mockRejectedValue(new Error('down')),
      fallbackFn: async (entry) => { fallbackLogs.push(entry); },
      aggregationWindowMs: 100,
      escalationThreshold: 3,
    });

    failingAlerter.send({ type: 'quota', task_id: 'q1', message: '额度警告' });

    await new Promise(r => setTimeout(r, 200));

    const log = fallbackLogs[0];
    expect(log).toHaveProperty('timestamp');
    expect(log).toHaveProperty('type', 'quota');

    failingAlerter.destroy?.();
  });
});
