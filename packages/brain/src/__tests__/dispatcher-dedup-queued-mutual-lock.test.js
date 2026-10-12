/**
 * dispatcher-dedup-queued-mutual-lock.test.js — 标题查重不能让两张 queued 任务互相跳过（任务 c8320370）
 *
 * 生产复现（10-12 07:30）：「手机账号巡查运行维护检查 · 2026-10-12 07:30」与「悦升云端增长情报日报 · 2026-10-12 07:30」
 * 同一分钟各由定时引擎建单，标题日期/时间 token 占多数（Jaccard 0.71≥0.6），两张都 queued、互判重复、互相跳过，
 * 谁也派不出去，直到人工收口。规则本意是「让已在办的那个继续走」：
 * 更新的 queued sibling 不挡更早的候选；in_progress 的、更早或同时创建的 queued sibling 照旧挡。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...args) => mockQuery(...args) } }));
vi.mock('../dispatch-stats.js', () => ({ recordDispatchResult: vi.fn(), DISPATCH_STATS_KEY: 'dispatch_stats' }));

import { _internals_findDuplicateTaskSibling } from '../dispatcher.js';

const older = { id: 'monitor', task_type: 'script_run', title: '手机账号巡查运行维护检查 · 2026-10-12 07:30', created_at: '2026-10-11T23:30:02.400Z', payload: {} };
const newer = { id: 'report', task_type: 'script_run', title: '悦升云端增长情报日报 · 2026-10-12 07:30', created_at: '2026-10-11T23:30:02.500Z', payload: {} };
const asRow = (t, status) => ({ id: t.id, title: t.title, sibling_status: status, sibling_created_at: t.created_at });

describe('标题查重不互锁', () => {
  beforeEach(() => mockQuery.mockReset());

  it('更新的 queued sibling 不挡更早的候选（更早的先走）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [asRow(newer, 'queued')] });
    expect(await _internals_findDuplicateTaskSibling(older)).toBeNull();
  });

  it('更早的 queued sibling 照旧挡更新的候选', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [asRow(older, 'queued')] });
    expect((await _internals_findDuplicateTaskSibling(newer))?.id).toBe('monitor');
  });

  it('in_progress 的 sibling 不论新旧都挡', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [asRow(newer, 'in_progress')] });
    expect((await _internals_findDuplicateTaskSibling(older))?.id).toBe('report');
  });

  it('同时创建的 queued sibling 照旧挡（保持原判重）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...asRow(newer, 'queued'), sibling_created_at: older.created_at }] });
    expect((await _internals_findDuplicateTaskSibling(older))?.id).toBe('report');
  });
});
