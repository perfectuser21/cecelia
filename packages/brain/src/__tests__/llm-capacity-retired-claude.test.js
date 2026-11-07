import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ usage: vi.fn(), verdictFor: vi.fn(), degradedReason: null }));
vi.mock('../account-usage.js', () => ({ getAccountUsage: mocks.usage }));
vi.mock('../db.js', () => ({ default: {} }));
vi.mock('../orchestrator/preflight/account-quota-ledger.js', () => ({
  createQuotaLedgerLoader: () => async () => ({ verdictFor: mocks.verdictFor, degradedReason: mocks.degradedReason }),
}));

import { clearLlmCapacityCache, getLlmCapacitySnapshot } from '../llm-capacity.js';

describe('退役 Claude 不影响可执行模型容量快照', () => {
  beforeEach(() => {
    clearLlmCapacityCache();
    mocks.usage.mockReset();
    mocks.verdictFor.mockReset();
    mocks.degradedReason = null;
    mocks.usage.mockResolvedValue({ old: { account_id: 'old', five_hour_pct: 5 } });
    mocks.verdictFor.mockReturnValue({ verdict: 'unusable', reason: 'quota_full', pct: 100 });
  });

  it('只有退休 Claude 可用时报告耗尽，而非健康', async () => {
    const snapshot = await getLlmCapacitySnapshot({ forceRefresh: true });
    expect(snapshot.vendors.claude.available_count).toBe(1);
    expect(snapshot.vendors.codex.available_count).toBe(0);
    expect(snapshot.vendors.grok.available_count).toBe(0);
    expect(snapshot.sentinel).toBe('exhausted');
    expect(snapshot.healthy).toBe(false);
  });

  it('Codex 仍有额度时保持健康', async () => {
    mocks.verdictFor.mockImplementation(name => ({ verdict: name === 'team1' ? 'usable' : 'unusable', reason: 'test', pct: 0 }));
    const snapshot = await getLlmCapacitySnapshot({ forceRefresh: true });
    expect(snapshot.sentinel).toBe('ok');
    expect(snapshot.healthy).toBe(true);
  });

  it('只有 Grok 有额度时保持健康', async () => {
    mocks.verdictFor.mockImplementation(name => ({ verdict: name === 'grok' ? 'usable' : 'unusable', reason: 'test', pct: 0 }));
    const snapshot = await getLlmCapacitySnapshot({ forceRefresh: true });
    expect(snapshot.vendors.codex.available_count).toBe(0);
    expect(snapshot.vendors.grok.available_count).toBe(1);
    expect(snapshot.sentinel).toBe('ok');
  });

  it('现役 Codex 查询失败仍报告降级', async () => {
    mocks.verdictFor.mockImplementation(name => {
      if (name.startsWith('team')) throw new Error('codex_probe_failed');
      return { verdict: 'usable', reason: 'test', pct: 0 };
    });
    const snapshot = await getLlmCapacitySnapshot({ forceRefresh: true });
    expect(snapshot.errors).toContain('codex:codex_probe_failed');
    expect(snapshot.sentinel).toBe('degraded');
    expect(snapshot.healthy).toBe(false);
  });

  it.each(['unknown', 'unusable'])('真实账本降级并给 %s 时健康应为降级，保留原有账号判定', async (verdict) => {
    mocks.degradedReason = 'ledger_unavailable';
    mocks.verdictFor.mockReturnValue({ verdict, reason: 'ledger_unavailable', pct: null });
    const snapshot = await getLlmCapacitySnapshot({ forceRefresh: true });
    expect(snapshot.vendors.codex.poller).toBe('error');
    expect(snapshot.vendors.codex.available_count).toBe(verdict === 'unknown' ? 5 : 0);
    expect(snapshot.vendors.grok.available_count).toBe(verdict === 'unknown' ? 1 : 0);
    expect(snapshot.errors).toEqual(expect.arrayContaining(['codex:ledger_unavailable', 'grok:ledger_unavailable']));
    expect(snapshot.sentinel).toBe('degraded');
    expect(snapshot.healthy).toBe(false);
  });

  it('旧 Claude 采集失败不污染健康状态，但保留错误明细', async () => {
    mocks.usage.mockRejectedValue(new Error('retired_ledger_unreachable'));
    mocks.verdictFor.mockImplementation(name => ({ verdict: name === 'team1' ? 'usable' : 'unusable', reason: 'test', pct: 0 }));
    const snapshot = await getLlmCapacitySnapshot({ forceRefresh: true });
    expect(snapshot.errors).toContain('claude:retired_ledger_unreachable');
    expect(snapshot.vendors.claude.poller).toBe('error');
    expect(snapshot.sentinel).toBe('ok');
    expect(snapshot.healthy).toBe(true);
  });
});
