import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClaim = vi.fn();
vi.mock('../lib/dedupe.js', () => ({
  claimDedupeKey: (...a) => mockClaim(...a),
  releaseDedupeKey: vi.fn(),
}));
vi.mock('../muted-guard.js', () => ({ isMuted: () => false }));

const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 200 }) });
global.fetch = mockFetch;
process.env.FEISHU_BOT_WEBHOOK = 'https://example.com/hook';

const { sendFeishu } = await import('../notifier.js');

describe('notifier dedupeKey（opt-in）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('不传 dedupeKey：不查 dedupe，直接发（老路径回归）', async () => {
    await sendFeishu('hello');
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('传 dedupeKey 且 claim 成功 → 发送', async () => {
    mockClaim.mockResolvedValueOnce({ claimed: true });
    const ok = await sendFeishu('hello', { dedupeKey: 'evt-1', dedupeTtlSec: 600 });
    expect(mockClaim).toHaveBeenCalledWith('notify', 'evt-1', 600);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it('传 dedupeKey 且已被占 → 跳过发送，返回 false', async () => {
    mockClaim.mockResolvedValueOnce({ claimed: false });
    const ok = await sendFeishu('hello', { dedupeKey: 'evt-2' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it('claim 抛错（never breaks main flow）→ 照发', async () => {
    mockClaim.mockRejectedValueOnce(new Error('boom'));
    const ok = await sendFeishu('hello', { dedupeKey: 'evt-3' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });
});
