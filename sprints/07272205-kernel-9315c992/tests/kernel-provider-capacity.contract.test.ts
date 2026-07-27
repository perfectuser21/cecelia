import { describe, expect, it } from 'vitest';

import {
  computeHarnessAccountCapacity,
} from '../../../packages/brain/src/harness-capacity-accounting.js';
import { harnessSlotCheck } from '../../../packages/brain/src/slot-allocator.js';

const NOW = '2026-07-27T22:05:00.000Z';

function account(provider: string, name: string, over: Record<string, unknown> = {}) {
  return {
    provider,
    vendor: provider,
    account: name,
    name,
    available: true,
    safe_concurrency: 2,
    ...over,
  };
}

function fullSnapshot(over: Record<string, unknown> = {}) {
  return {
    sampled_at: NOW,
    cache_ttl_ms: 60_000,
    sentinel: 'ok',
    vendors: {
      claude: {
        poller: 'ok',
        accounts: [account('claude', 'account1'), account('claude', 'account2')],
      },
      codex: {
        poller: 'ok',
        accounts: [
          account('codex', 'team1'),
          account('codex', 'team2'),
          account('codex', 'team3'),
          account('codex', 'team4'),
          account('codex', 'team5'),
        ],
      },
      grok: {
        poller: 'ok',
        accounts: [account('grok', 'grok')],
      },
    },
    ...over,
  };
}

describe('provider-neutral Harness capacity contract', () => {
  it('provider-neutral acct_cap 覆盖 Claude Codex Grok 且不固定为 4', () => {
    const capacity = computeHarnessAccountCapacity({
      snapshot: fullSnapshot(),
      active_attempts: [],
      candidate: { role: 'generator' },
      mem_cap: 20,
      hard_cap: 20,
      now: NOW,
    });

    expect(capacity.allow).toBe(true);
    expect(capacity.reason).toBe('ok');
    expect(capacity.accounts.map((a: any) => `${a.provider}:${a.account}`).sort()).toEqual([
      'claude:account1',
      'claude:account2',
      'codex:team1',
      'codex:team2',
      'codex:team3',
      'codex:team4',
      'codex:team5',
      'grok:grok',
    ]);
    expect(capacity.acct_cap).toBe(16);
    expect(capacity.effective).toBe(16);
    expect(capacity.acct_cap).toBeGreaterThan(4);
  });

  it('同账号多候选只计一次且固定 role_assignment 耗尽时拒绝该账号', () => {
    const duplicated = fullSnapshot({
      vendors: {
        codex: {
          poller: 'ok',
          accounts: [
            account('codex', 'team1'),
            account('codex', 'team1', { source: 'duplicate_candidate' }),
            account('codex', 'team2'),
          ],
        },
      },
    });

    const duplicateCapacity = computeHarnessAccountCapacity({
      snapshot: duplicated,
      active_attempts: [],
      mem_cap: 20,
      hard_cap: 20,
      now: NOW,
    });
    expect(duplicateCapacity.accounts.map((a: any) => `${a.provider}:${a.account}`).sort()).toEqual([
      'codex:team1',
      'codex:team2',
    ]);
    expect(duplicateCapacity.acct_cap).toBe(4);

    const fixedCandidate = {
      role: 'generator',
      payload: {
        role_assignments: {
          generator: { provider: 'codex', account: 'team1' },
        },
      },
    };
    const exhausted = computeHarnessAccountCapacity({
      snapshot: duplicated,
      active_attempts: [
        { provider: 'codex', account: 'team1', status: 'running' },
        { provider: 'codex', account: 'team1', status: 'starting' },
      ],
      candidate: fixedCandidate,
      mem_cap: 20,
      hard_cap: 20,
      now: NOW,
    });

    expect(exhausted.acct_cap).toBe(2);
    expect(exhausted.candidate_account).toMatchObject({
      provider: 'codex',
      account: 'team1',
      remaining: 0,
    });
    expect(exhausted.allow).toBe(false);
    expect(exhausted.reason).toBe('candidate_account_exhausted');
  });

  it('缺快照 未知 provider 未知并发上限全部 fail-closed', () => {
    expect(computeHarnessAccountCapacity({
      snapshot: null,
      active_attempts: [],
      mem_cap: 20,
      hard_cap: 20,
      now: NOW,
    })).toMatchObject({
      allow: false,
      reason: 'capacity_snapshot_missing',
      acct_cap: 0,
      effective: 0,
    });

    const unknownProvider = computeHarnessAccountCapacity({
      snapshot: {
        sampled_at: NOW,
        cache_ttl_ms: 60_000,
        sentinel: 'ok',
        vendors: {
          llama: { poller: 'ok', accounts: [account('llama', 'llama1')] },
        },
      },
      candidate: { role: 'generator', payload: { role_assignments: { generator: { provider: 'llama', account: 'llama1' } } } },
      active_attempts: [],
      mem_cap: 20,
      hard_cap: 20,
      now: NOW,
    });
    expect(unknownProvider.allow).toBe(false);
    expect(unknownProvider.reason).toBe('unknown_provider');
    expect(unknownProvider.acct_cap).toBe(0);

    const unknownConcurrency = computeHarnessAccountCapacity({
      snapshot: {
        sampled_at: NOW,
        cache_ttl_ms: 60_000,
        sentinel: 'ok',
        vendors: {
          codex: { poller: 'ok', accounts: [account('codex', 'team1', { safe_concurrency: undefined })] },
        },
      },
      candidate: { role: 'generator', payload: { role_assignments: { generator: { provider: 'codex', account: 'team1' } } } },
      active_attempts: [],
      mem_cap: 20,
      hard_cap: 20,
      now: NOW,
    });
    expect(unknownConcurrency.allow).toBe(false);
    expect(unknownConcurrency.reason).toBe('unknown_account_concurrency');
    expect(unknownConcurrency.acct_cap).toBe(0);

    const circuitOpen = computeHarnessAccountCapacity({
      snapshot: {
        sampled_at: NOW,
        cache_ttl_ms: 60_000,
        sentinel: 'ok',
        vendors: {
          codex: { poller: 'ok', accounts: [account('codex', 'team1', { circuit_open: true })] },
        },
      },
      candidate: { role: 'generator', payload: { role_assignments: { generator: { provider: 'codex', account: 'team1' } } } },
      active_attempts: [],
      mem_cap: 20,
      hard_cap: 20,
      now: NOW,
    });
    expect(circuitOpen.allow).toBe(false);
    expect(circuitOpen.reason).toBe('account_unavailable');
    expect(circuitOpen.acct_cap).toBe(0);
  });

  it('harnessSlotCheck 叠加 provider-neutral acct_cap active attempts reserve 和 hard cap', async () => {
    const result = await harnessSlotCheck({
      candidate: {
        id: '9315c992-7061-4d17-8c88-628ed0eb0be2',
        priority: 'P0',
        task_type: 'harness_initiative',
        role: 'generator',
        payload: {
          role_assignments: {
            generator: { provider: 'codex', account: 'team3' },
          },
        },
      },
      _vitalsOverride: {
        sampled_at: Date.now(),
        stale: false,
        error: null,
        relay_count: 4,
        relay_containers: ['cecelia-relay-a', 'cecelia-relay-b', 'cecelia-relay-c', 'cecelia-relay-d'],
        vm_total_mb: 30_000,
        vm_used_mb: 5_000,
        host_disk_pct: 50,
        docker_disk_pct: 50,
      },
      _quotaGuardOverride: { allow: true, priorityFilter: null, reason: 'ok', bestPct: 10 },
      _capacitySnapshotOverride: fullSnapshot(),
      _activeAttemptsOverride: [
        { provider: 'claude', account: 'account1', status: 'running' },
        { provider: 'claude', account: 'account1', status: 'starting' },
        { provider: 'claude', account: 'account2', status: 'running' },
        { provider: 'claude', account: 'account2', status: 'starting' },
      ],
      _inflightOverride: 0,
      _kernelActiveOverride: 0,
      _memHealthOverride: { action: 'ok', reason: 'test' },
      _hardCapOverride: 8,
    });

    expect(result.reason).toBe('ok');
    expect(result.allow).toBe(true);
    expect(result.cap.acct_cap).toBe(12);
    expect(result.cap.acct_cap).toBeGreaterThan(4);
    expect(result.cap.effective).toBe(8);
    expect(result.cap.hard_cap).toBe(8);
    expect(result.account_capacity.candidate_account).toMatchObject({
      provider: 'codex',
      account: 'team3',
      remaining: 2,
    });
  });
});
