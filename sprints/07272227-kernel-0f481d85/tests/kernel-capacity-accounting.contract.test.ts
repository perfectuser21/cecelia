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
        { attempt_id: 'a3', provider: 'claude', account: 'account1', status: 'running' },
      ],
      legacy_usage_rows: [
        { attempt_id: 'a1', provider: 'codex', account: 'team5', status: 'queued', source: 'relay' },
        { attempt_id: 'a2', provider: 'codex', account: 'team5', status: 'running', source: 'kernel' },
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

  it('legacy relay kernel attempt usage 统一归一并按 attempt_id provider account 去重', async () => {
    const mod = await import('../../../packages/brain/src/slot-allocator.js');

    expect(typeof (mod as any).computeKernelAccountAdmission).toBe('function');

    const decision = await (mod as any).computeKernelAccountAdmission({
      provider: 'codex',
      account: 'team5',
      safe_limit: 3,
      active_attempts: [
        { attempt_id: 'dup-1', provider: 'codex', account: 'team5', status: 'running' },
      ],
      legacy_usage_rows: [
        { attempt_id: 'dup-1', provider: 'codex', account: 'team5', status: 'running', source: 'relay' },
        { attempt_id: 'dup-1', provider: 'codex', account: 'team5', status: 'running', source: 'attempt' },
        { attempt_id: 'dup-2', provider: 'codex', account: 'team5', status: 'queued', source: 'kernel' },
      ],
      memory_ok: true,
      disk_ok: true,
      quota_ok: true,
      hard_seat_ok: true,
    });

    expect(decision).toMatchObject({
      active: 2,
      free: 1,
      allow: true,
      deduped_attempt_ids: ['dup-1', 'dup-2'],
    });
  });

  it('snapshot sampled_at cache_ttl 缺失陈旧 usage API 错误或 candidate unknown 都 fail closed 且 reason 稳定', async () => {
    const mod = await import('../../../packages/brain/src/slot-allocator.js');

    expect(typeof (mod as any).computeKernelAccountAdmission).toBe('function');

    const scenarios = [
      {
        name: 'missing_snapshot',
        snapshot: null,
        expectedReason: 'candidate_snapshot_missing',
      },
      {
        name: 'missing_sampled_at',
        snapshot: { sampled_at: null, cache_ttl_ms: 60000, vendors: { codex: { accounts: [] } } },
        expectedReason: 'candidate_snapshot_stale',
      },
      {
        name: 'stale_sample',
        snapshot: { sampled_at: '2026-07-20T00:00:00.000Z', cache_ttl_ms: 1, vendors: { codex: { accounts: [] } } },
        expectedReason: 'candidate_snapshot_stale',
      },
      {
        name: 'usage_api_error',
        snapshot: {
          sampled_at: '2026-07-27T00:00:00.000Z',
          cache_ttl_ms: 60000,
          vendors: { codex: { error: 'usage_api_error', accounts: [] } },
        },
        expectedReason: 'candidate_usage_error',
      },
      {
        name: 'candidate_unknown',
        snapshot: {
          sampled_at: '2026-07-27T00:00:00.000Z',
          cache_ttl_ms: 60000,
          vendors: { codex: { accounts: [{ account: 'team5', free: 1, state: 'unknown' }] } },
        },
        expectedReason: 'candidate_unknown',
      },
      {
        name: 'partial_provider_account_missing',
        snapshot: {
          sampled_at: '2026-07-27T00:00:00.000Z',
          cache_ttl_ms: 60000,
          vendors: { grok: { accounts: [{ account: 'grok', free: 1, state: 'ok' }] } },
        },
        expectedReason: 'candidate_snapshot_missing',
      },
    ];

    for (const scenario of scenarios) {
      const decision = await (mod as any).computeKernelAccountAdmission({
        provider: 'codex',
        account: 'team5',
        safe_limit: 4,
        active_attempts: [],
        snapshot: scenario.snapshot,
        memory_ok: true,
        disk_ok: true,
        quota_ok: true,
        hard_seat_ok: true,
      });
      expect(decision).toMatchObject({
        allow: false,
        scope: 'candidate',
        reason: scenario.expectedReason,
      });
    }
  });
});
