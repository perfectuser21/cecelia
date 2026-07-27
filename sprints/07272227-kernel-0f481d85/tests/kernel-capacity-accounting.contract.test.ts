import { describe, it, expect } from 'vitest';

describe('Kernel provider-neutral capacity accounting contract', () => {
  it('selected account free=max(0,safe_limit-active(provider account)) 且 total=4 active=2 free=2 仍放行', async () => {
    const mod = await import('../../../packages/brain/src/slot-allocator.js');

    expect(typeof (mod as any).computeKernelAccountAdmission).toBe('function');

    const decision = await (mod as any).computeKernelAccountAdmission({
      provider: 'codex',
      account: 'team5',
      safe_limit: 4,
      active_attempts: [
        { attempt_id: 'a1', provider: 'codex', account: 'team5', status: 'queued' },
        { attempt_id: 'a2', provider: 'codex', account: 'team5', status: 'running' },
      ],
      legacy_usage_rows: [
        { attempt_id: 'a1', provider: 'codex', account: 'team5', status: 'queued' },
        { attempt_id: 'a2', provider: 'codex', account: 'team5', status: 'running' },
      ],
      memory_ok: true,
      disk_ok: true,
      quota_ok: true,
      hard_seat_ok: true,
    });

    expect(decision).toMatchObject({
      active: 2,
      free: 2,
      allow: true,
      reason: 'ok',
    });
  });

  it('snapshot sampled_at cache_ttl 缺失陈旧 usage API 错误或 candidate unknown 都 fail closed 且只拒当前 candidate', async () => {
    const mod = await import('../../../packages/brain/src/slot-allocator.js');

    expect(typeof (mod as any).computeKernelAccountAdmission).toBe('function');

    for (const snapshot of [
      null,
      { sampled_at: null, cache_ttl_ms: 60000, vendors: {} },
      { sampled_at: '2026-07-20T00:00:00.000Z', cache_ttl_ms: 1, vendors: {} },
      { sampled_at: '2026-07-27T00:00:00.000Z', cache_ttl_ms: 60000, vendors: { codex: { error: 'usage_api_error', accounts: [] } } },
      { sampled_at: '2026-07-27T00:00:00.000Z', cache_ttl_ms: 60000, vendors: { grok: { accounts: [{ account: 'grok', state: 'unknown' }] } } },
    ]) {
      const decision = await (mod as any).computeKernelAccountAdmission({
        provider: 'codex',
        account: 'team5',
        safe_limit: 4,
        active_attempts: [],
        snapshot,
        memory_ok: true,
        disk_ok: true,
        quota_ok: true,
        hard_seat_ok: true,
      });
      expect(decision.allow).toBe(false);
      expect(typeof decision.reason).toBe('string');
      expect(decision.scope).toBe('candidate');
    }
  });
});
