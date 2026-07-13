/**
 * arch-review-line-ledger.test.js
 * triggerArchReview 的 line_ledger 摘要注入 + fetchAllLineLedgersDigest 单元测试
 * （从 daily-review-scheduler.test.js 搬出——该文件被 vitest.config.js exclude，
 * 导致这些测试永远不会被 CI 执行）
 */

import { describe, it, expect, vi } from 'vitest';
import {
  fetchAllLineLedgersDigest,
  triggerArchReview,
} from '../daily-review-scheduler.js';

// ============================================================
// triggerArchReview — line_ledger 摘要注入
// ============================================================
describe('triggerArchReview — line_ledger 摘要注入', () => {
  it('创建任务时 prd_summary 追加 line_ledger 摘要段', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })  // hasRecentArchReview -> false
        .mockResolvedValueOnce({ rows: [] })  // 无历史 arch_review → guard 通过
        .mockResolvedValueOnce({              // fetchAllLineLedgersDigest
          rows: [{ title: 'Line A — 24h 账本', content: '摘要A' }],
        })
        .mockResolvedValueOnce({ rows: [{ id: 'ar-with-digest' }] }), // INSERT
    };
    const triggerTime = new Date('2026-03-23T20:00:00Z');
    const result = await triggerArchReview(pool, triggerTime);
    expect(result.triggered).toBe(true);
    const params = pool.query.mock.calls[3][1];
    const payload = JSON.parse(params[1]);
    expect(payload.prd_summary).toContain('Line A — 24h 账本');
    expect(payload.prd_summary).toContain('摘要A');
  });

  it('line_ledger 查询失败时不影响任务创建（catch 兜底）', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })  // hasRecentArchReview -> false
        .mockResolvedValueOnce({ rows: [] })  // guard 通过
        .mockRejectedValueOnce(new Error('line_ledger query failed')) // fetchAllLineLedgersDigest
        .mockResolvedValueOnce({ rows: [{ id: 'ar-digest-fail' }] }), // INSERT
    };
    const triggerTime = new Date('2026-03-23T20:01:00Z');
    const result = await triggerArchReview(pool, triggerTime);
    expect(result.triggered).toBe(true);
    expect(result.task_id).toBe('ar-digest-fail');
  });
});

// ============================================================
// fetchAllLineLedgersDigest（拼接所有 line_ledger 为一段摘要）
// ============================================================
describe('fetchAllLineLedgersDigest — 拼接所有 line_ledger 为一段摘要', () => {
  it('无记录 → 空串', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(fetchAllLineLedgersDigest(pool)).resolves.toBe('');
  });

  it('有记录 → 拼接 title+content', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ title: 'Line A — 24h 账本', content: '摘要A' }, { title: 'Line B — 24h 账本', content: '摘要B' }],
      }),
    };
    const digest = await fetchAllLineLedgersDigest(pool);
    expect(digest).toContain('Line A — 24h 账本');
    expect(digest).toContain('摘要A');
    expect(digest).toContain('Line B — 24h 账本');
  });
});
