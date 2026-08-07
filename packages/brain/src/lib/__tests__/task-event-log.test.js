/**
 * task-event-log.test.js — recordTaskEventSafe 处置留痕单测（task 94ee0ec4）。
 *
 * 合同失败语义：处置动作必须落 task_events 行；写事件失败仅告警不阻断处置。
 */
import { describe, it, expect, vi } from 'vitest';
import { recordTaskEventSafe } from '../task-event-log.js';

describe('recordTaskEventSafe', () => {
  it('写入 task_events 行：INSERT 语句 + task_id/event_type/payload 参数正确', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const ok = await recordTaskEventSafe({ query }, 'task-abc', 'watchdog_safe_requeue', {
      reason: 'no_spawn_evidence',
    });

    expect(ok).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO task_events');
    expect(params[0]).toBe('task-abc');
    expect(params[1]).toBe('watchdog_safe_requeue');
    expect(JSON.parse(params[2])).toEqual({ reason: 'no_spawn_evidence' });
  });

  it('payload 缺省为空对象', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    await recordTaskEventSafe({ query }, 'task-def', 'watchdog_requeue');
    expect(JSON.parse(query.mock.calls[0][1][2])).toEqual({});
  });

  it('写失败不抛错（可观测降级，不阻断处置主链），返回 false', async () => {
    const query = vi.fn().mockRejectedValue(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      recordTaskEventSafe({ query }, 'task-ghi', 'watchdog_quarantine', { reason: 'x' })
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
