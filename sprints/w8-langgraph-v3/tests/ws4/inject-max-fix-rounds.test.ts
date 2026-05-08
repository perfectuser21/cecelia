import { describe, it, expect, vi } from 'vitest';

// @ts-expect-error: lib not yet implemented (red phase)
import * as injB from '../../../harness-acceptance-v3/lib/evaluator-fail-injector.mjs';

describe('Workstream 4 — 故障注入 B: max_fix_rounds → interrupt → resume(abort) [BEHAVIOR]', () => {
  it('applyOverride() API 200 时不触 DB fallback', async () => {
    const dbCalls: any[] = [];
    const fakeFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const fakePsql = vi.fn(async (sql: string) => { dbCalls.push(sql); return { rowCount: 1 }; });

    await injB.applyOverride({
      taskId: 't-acc-1',
      mode: 'always_fail',
      reason: 'acceptance_v3_inject_B',
      fetch: fakeFetch as any,
      psql: fakePsql as any,
    });
    expect(fakeFetch).toHaveBeenCalled();
    expect(fakePsql).not.toHaveBeenCalled();
  });

  it('applyOverride() API 404 时回落 DB 直写 harness_evaluator_overrides', async () => {
    const fakeFetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'not found' }) }));
    const dbSqls: string[] = [];
    const fakePsql = vi.fn(async (sql: string) => { dbSqls.push(sql); return { rowCount: 1 }; });

    await injB.applyOverride({
      taskId: 't-acc-1',
      mode: 'always_fail',
      reason: 'acceptance_v3_inject_B',
      fetch: fakeFetch as any,
      psql: fakePsql as any,
    });
    expect(fakePsql).toHaveBeenCalled();
    expect(dbSqls.some((s) => /INSERT\s+INTO\s+harness_evaluator_overrides/i.test(s))).toBe(true);
  });

  it('removeOverride() 是幂等的（连续调用两次不抛）', async () => {
    const fakeFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const fakePsql = vi.fn(async () => ({ rowCount: 0 }));
    await injB.removeOverride({ taskId: 't-acc-1', fetch: fakeFetch as any, psql: fakePsql as any });
    await expect(
      injB.removeOverride({ taskId: 't-acc-1', fetch: fakeFetch as any, psql: fakePsql as any }),
    ).resolves.toBeDefined();
  });

  it('resumeWithAbort() body 中 action 严格等于 "abort"，URL 形如 /api/brain/harness-interrupts/<id>/resume', async () => {
    let captured: any = null;
    const fakeFetch = vi.fn(async (url: string, opts: any) => {
      captured = { url, body: JSON.parse(opts.body), method: opts.method };
      return { ok: true, status: 200, json: async () => ({ resumed: true }) };
    });
    await injB.resumeWithAbort('intr-uuid-1', { fetch: fakeFetch as any });
    expect(captured.url).toMatch(/\/api\/brain\/harness-interrupts\/intr-uuid-1\/resume$/);
    expect(captured.method).toBe('POST');
    expect(captured.body).toEqual({ action: 'abort' });
  });

  it('pollInterrupt() 超过 deadline 返回 {ok:false, reason:"timeout"}（不抛）', async () => {
    const fakeQuery = vi.fn(async () => null); // 永远没有 pending 行
    const r = await injB.pollInterrupt({
      taskId: 't-acc-1',
      deadlineMs: 50,
      pollIntervalMs: 10,
      query: fakeQuery,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('timeout');
  });
});
