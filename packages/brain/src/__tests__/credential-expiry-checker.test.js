import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../alerting.js', () => ({ raise: vi.fn() }));

describe('credential-expiry-checker', () => {
  it('exports checkCredentialExpiry function', async () => {
    const { checkCredentialExpiry } = await import('../credential-expiry-checker.js');
    expect(typeof checkCredentialExpiry).toBe('function');
  });
});
