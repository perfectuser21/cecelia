/**
 * verifyAccountTokenLive — 实时 token 有效性探测
 * 200→valid / 401|403→auth_failed / 429|其他|网络错误→unknown / 无token→unknown
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// account-usage.js 的副作用 import 全部 mock 掉
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn(async () => {}) }));
vi.mock('../alerting.js', () => ({ raise: vi.fn(async () => {}) }));
vi.mock('../auth-cache.js', () => ({
  isSpendingCapped: vi.fn(() => false),
  isAuthFailed: vi.fn(() => false),
}));
// getAccessToken 读 ~/.claude-<id>/.credentials.json
vi.mock('fs', () => ({
  readFileSync: vi.fn(() =>
    JSON.stringify({ claudeAiOauth: { accessToken: 'tok-test', expiresAt: Date.now() + 1e9 } })
  ),
}));

import { verifyAccountTokenLive } from '../account-usage.js';

describe('verifyAccountTokenLive', () => {
  let origFetch;
  beforeEach(() => { origFetch = global.fetch; global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = origFetch; });

  it('usage API 200 → valid', async () => {
    global.fetch.mockResolvedValue({ status: 200 });
    expect(await verifyAccountTokenLive('account1')).toBe('valid');
  });

  it('401 → auth_failed', async () => {
    global.fetch.mockResolvedValue({ status: 401 });
    expect(await verifyAccountTokenLive('account1')).toBe('auth_failed');
  });

  it('403 → auth_failed', async () => {
    global.fetch.mockResolvedValue({ status: 403 });
    expect(await verifyAccountTokenLive('account1')).toBe('auth_failed');
  });

  it('429 限流 → unknown（非 auth 失败）', async () => {
    global.fetch.mockResolvedValue({ status: 429 });
    expect(await verifyAccountTokenLive('account1')).toBe('unknown');
  });

  it('网络错误 → unknown', async () => {
    global.fetch.mockRejectedValue(new Error('network'));
    expect(await verifyAccountTokenLive('account1')).toBe('unknown');
  });
});
