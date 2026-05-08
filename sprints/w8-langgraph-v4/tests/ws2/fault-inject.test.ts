import { describe, it, expect, vi } from 'vitest';
import {
  findContainerForTask,
  pollLlmRetryEvents,
  pollHarnessInterruptPending,
  injectInitiativeDeadlineOverdue,
  assertWatchdogMarkedFailed,
} from '../../../../scripts/acceptance/w8-v4/fault-inject.mjs';

describe('Workstream 2 — fault injection helpers [BEHAVIOR]', () => {
  it('findContainerForTask 多容器时取第一个', async () => {
    const docker = vi.fn().mockResolvedValue({ stdout: 'container-aaa\ncontainer-bbb\n' });
    const name = await findContainerForTask({ docker, taskId: 'tid' });
    expect(name).toBe('container-aaa');
  });

  it('findContainerForTask 无容器时抛错且错误含 taskId', async () => {
    const docker = vi.fn().mockResolvedValue({ stdout: '' });
    await expect(findContainerForTask({ docker, taskId: 'tid-xyz' })).rejects.toThrow(/tid-xyz/);
  });

  it('pollLlmRetryEvents 超过 capMax=3 时抛错（不静默）', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: '5' }] });
    await expect(pollLlmRetryEvents({
      query,
      taskId: 'tid',
      sinceTs: 0,
      capMax: 3,
      timeoutMin: 1,
    })).rejects.toThrow(/cap|exceed|5/);
  });

  it('pollLlmRetryEvents 1-3 之间正常返回数', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: '2' }] });
    const n = await pollLlmRetryEvents({
      query,
      taskId: 'tid',
      sinceTs: 0,
      capMax: 3,
      timeoutMin: 1,
    });
    expect(n).toBe(2);
  });

  it('pollHarnessInterruptPending 超时未见 pending 时抛错且错误含 task_id', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(pollHarnessInterruptPending({
      query,
      taskId: 'tid-zzz',
      sinceTs: 0,
      timeoutMin: 0,
    })).rejects.toThrow(/tid-zzz/);
  });

  it('pollHarnessInterruptPending 命中时返回 row id', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'intr-001' }] });
    const id = await pollHarnessInterruptPending({
      query,
      taskId: 'tid',
      sinceTs: 0,
      timeoutMin: 1,
    });
    expect(id).toBe('intr-001');
  });

  it('injectInitiativeDeadlineOverdue 仅改 phase=running 行，0 行时抛错', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(injectInitiativeDeadlineOverdue({
      query,
      initiativeId: 'harness-acceptance-v4-2026-05-08',
    })).rejects.toThrow();
    expect(query.mock.calls[0][0]).toMatch(/phase\s*=\s*['"]running['"]/);
  });

  it('injectInitiativeDeadlineOverdue 改了 ≥1 行时返回数', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 'r1' }] });
    const n = await injectInitiativeDeadlineOverdue({
      query,
      initiativeId: 'harness-acceptance-v4-2026-05-08',
    });
    expect(n).toBe(1);
  });

  it('assertWatchdogMarkedFailed 必须 phase=failed AND failure_reason=watchdog_overdue', async () => {
    const queryFailedNoReason = vi.fn().mockResolvedValue({ rows: [{ phase: 'failed', failure_reason: 'natural_error' }] });
    await expect(assertWatchdogMarkedFailed({
      query: queryFailedNoReason,
      initiativeId: 'i1',
      sinceTs: 0,
      timeoutMin: 0,
    })).rejects.toThrow(/watchdog_overdue/);

    const queryRunning = vi.fn().mockResolvedValue({ rows: [{ phase: 'running', failure_reason: null }] });
    await expect(assertWatchdogMarkedFailed({
      query: queryRunning,
      initiativeId: 'i1',
      sinceTs: 0,
      timeoutMin: 0,
    })).rejects.toThrow();

    const queryGood = vi.fn().mockResolvedValue({ rows: [{ phase: 'failed', failure_reason: 'watchdog_overdue' }] });
    await expect(assertWatchdogMarkedFailed({
      query: queryGood,
      initiativeId: 'i1',
      sinceTs: 0,
      timeoutMin: 1,
    })).resolves.toBeDefined();
  });
});
