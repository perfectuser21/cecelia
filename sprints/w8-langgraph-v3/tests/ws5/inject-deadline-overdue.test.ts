import { describe, it, expect, vi } from 'vitest';

// @ts-expect-error: lib not yet implemented (red phase)
import * as injC from '../../../harness-acceptance-v3/lib/inject-deadline-overdue.mjs';

describe('Workstream 5 — 故障注入 C: Deadline 逾期 → watchdog → fresh thread [BEHAVIOR]', () => {
  it('nudgeDeadline() 拒绝 attempt 缺失（throw）', async () => {
    await expect(
      injC.nudgeDeadline({ initiativeId: 'harness-acceptance-v3-2026-05-07' }),
    ).rejects.toThrow(/attempt/i);
  });

  it('nudgeDeadline() 拒绝 initiativeId 通配符如 "%"', async () => {
    await expect(
      injC.nudgeDeadline({ initiativeId: '%', attempt: 1 }),
    ).rejects.toThrow(/wildcard|invalid|initiative/i);
  });

  it('restoreDeadline() 即使 SQL 抛错也不向上传播（吞掉，避免 finally 失败）', async () => {
    const fakePsql = vi.fn(async () => { throw new Error('db down'); });
    await expect(
      injC.restoreDeadline({ initiativeId: 'harness-acceptance-v3-2026-05-07', attempt: 1, psql: fakePsql as any }),
    ).resolves.toBeDefined();
  });

  it('pollWatchdog() 命中 phase=failed/failure_reason=watchdog_overdue 即返回 ok=true', async () => {
    const fakeQuery = vi.fn(async () => ({ phase: 'failed', failure_reason: 'watchdog_overdue' }));
    const r = await injC.pollWatchdog({
      initiativeId: 'harness-acceptance-v3-2026-05-07',
      attempt: 1,
      deadlineMs: 5000,
      pollIntervalMs: 100,
      query: fakeQuery,
    });
    expect(r.ok).toBe(true);
  });

  it('redispatchAndAssertFreshThread() 校验新 attempt = prev+1 且 thread_id 不同', async () => {
    const fakeFetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'task-fresh' }) }));
    const fakeQuery = vi.fn(async () => ({ attempt: 2, thread_id: 'thread-B' }));
    await expect(
      injC.redispatchAndAssertFreshThread({
        initiativeId: 'harness-acceptance-v3-2026-05-07',
        prevAttempt: 1,
        prevThreadId: 'thread-A',
        fetch: fakeFetch as any,
        query: fakeQuery as any,
      }),
    ).resolves.toBeDefined();
  });

  it('redispatchAndAssertFreshThread() 当 thread_id 相同时 throw', async () => {
    const fakeFetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'task-fresh' }) }));
    const fakeQuery = vi.fn(async () => ({ attempt: 2, thread_id: 'thread-A' })); // 同一 thread
    await expect(
      injC.redispatchAndAssertFreshThread({
        initiativeId: 'harness-acceptance-v3-2026-05-07',
        prevAttempt: 1,
        prevThreadId: 'thread-A',
        fetch: fakeFetch as any,
        query: fakeQuery as any,
      }),
    ).rejects.toThrow(/thread.*same|stale thread|fresh.*thread/i);
  });
});
