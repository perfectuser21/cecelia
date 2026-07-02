import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../alerting.js', () => ({ raise: vi.fn() }));
vi.mock('fs', () => ({ readFileSync: vi.fn(), existsSync: vi.fn() }));
vi.mock('os', () => ({ homedir: vi.fn(() => '/mock/home') }));

describe('credential-expiry-checker', () => {
  it('exports checkCredentialExpiry function', async () => {
    const { checkCredentialExpiry } = await import('../credential-expiry-checker.js');
    expect(typeof checkCredentialExpiry).toBe('function');
  });

  it('监控账号包含 account1（回归：曾被漏排除导致故障永远无告警，决策 7702b938）', async () => {
    const { existsSync, readFileSync } = await import('fs');
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify({ claudeAiOauth: { expiresAt: Date.now() + 86400000 } }));

    const { checkCredentialExpiry } = await import('../credential-expiry-checker.js');
    const { accounts } = checkCredentialExpiry();
    const names = accounts.map(a => a.account);
    expect(names).toContain('account1');
  });
});
