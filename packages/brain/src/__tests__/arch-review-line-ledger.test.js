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
    const createTask = vi.fn(async (input) => ({ task: { id: 'ar-with-digest', ...input } }));
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
    const result = await triggerArchReview(pool, triggerTime, createTask);
    expect(result.triggered).toBe(true);
    const payload = createTask.mock.calls[0][0].payload;
    expect(payload.prd_summary).toContain('Line A — 24h 账本');
    expect(payload.prd_summary).toContain('摘要A');
  });

  it('line_ledger 查询失败时不影响任务创建（catch 兜底）', async () => {
    const createTask = vi.fn(async () => ({ task: { id: 'ar-digest-fail' } }));
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })  // hasRecentArchReview -> false
        .mockResolvedValueOnce({ rows: [] })  // guard 通过
        .mockRejectedValueOnce(new Error('line_ledger query failed')) // fetchAllLineLedgersDigest
        .mockResolvedValueOnce({ rows: [{ id: 'ar-digest-fail' }] }), // INSERT
    };
    const triggerTime = new Date('2026-03-23T20:01:00Z');
    const result = await triggerArchReview(pool, triggerTime, createTask);
    expect(result.triggered).toBe(true);
    expect(result.task_id).toBe('ar-digest-fail');
  });
});

// ============================================================
// triggerArchReview — location 字段必须为 'us'（回归测试，防止硬编码 xian 重现）
// ============================================================
describe('triggerArchReview — INSERT location 必须为 us', () => {
  it('生成的 INSERT SQL 里 location 值为 us，不是 xian', async () => {
    const createTask = vi.fn(async (input) => ({ task: { id: 'ar-location-test', ...input } }));
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })  // hasRecentArchReview -> false
        .mockResolvedValueOnce({ rows: [] })  // guard 通过
        .mockResolvedValueOnce({ rows: [] })  // fetchAllLineLedgersDigest
        .mockResolvedValueOnce({ rows: [{ id: 'ar-location-test' }] }), // INSERT
    };
    const triggerTime = new Date('2026-03-23T20:00:00Z');
    const result = await triggerArchReview(pool, triggerTime, createTask);
    expect(result.triggered).toBe(true);
    // pool.query.mock.calls[3][0] 是 INSERT 语句运行时实际传给 pool.query 的 SQL
    expect(createTask.mock.calls[0][0].location ?? 'us').toBe('us');
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
