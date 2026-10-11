/**
 * dispatcher-dedup-recurring-identity.test.js — 定时实例的业务身份判重（任务 c8320370）
 *
 * 生产复现（10-12 00:52）：5 个不同定时模板同一时间点各建一张 qiumi_task，标题只差一个 agent 名，
 * 派发前标题查重（Jaccard≥0.6）把它们两两判成「重复」——都还在 queued，互相跳过，谁都派不出去（互锁）。
 * 定时实例的身份是「模板 + 时间点」（source_id=recurring:<id>:<slot>，同模板叠单由引擎挡），
 * 不同模板或不同时间点的定时实例一律不是重复；与非定时任务之间仍按原标题规则判。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...args) => mockQuery(...args) } }));
vi.mock('../dispatch-stats.js', () => ({ recordDispatchResult: vi.fn(), DISPATCH_STATS_KEY: 'dispatch_stats' }));

import { _internals_findDuplicateTaskSibling } from '../dispatcher.js';

const now = new Date().toISOString();
const recurringCandidate = {
  id: 'cand-media', task_type: 'qiumi_task', created_at: now,
  title: '[通道自检] Brain定时→media · 2026-10-12 00:52',
  payload: { recurring_task_id: 'tpl-media', recurring_slot: '2026-10-11T16:52:00.000Z' },
};

describe('定时实例按模板+时间点判身份，不按标题相似', () => {
  beforeEach(() => mockQuery.mockReset());

  it('不同模板的同批定时实例标题再像也不判重复（防互锁）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 'sib-main', title: '[通道自检] Brain定时→main · 2026-10-12 00:52', recurring_task_id: 'tpl-main', recurring_slot: '2026-10-11T16:52:00.000Z' },
    ] });
    expect(await _internals_findDuplicateTaskSibling(recurringCandidate)).toBeNull();
  });

  it('同模板不同时间点的定时实例也不是重复', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 'sib-prev', title: '[通道自检] Brain定时→media · 2026-10-12 00:22', recurring_task_id: 'tpl-media', recurring_slot: '2026-10-11T16:22:00.000Z' },
    ] });
    expect(await _internals_findDuplicateTaskSibling(recurringCandidate)).toBeNull();
  });

  it('定时实例与手工建的高相似任务之间仍按标题判重复', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 'sib-manual', title: '[通道自检] Brain定时→media · 2026-10-12 00:52', recurring_task_id: null, recurring_slot: null },
    ] });
    const dup = await _internals_findDuplicateTaskSibling(recurringCandidate);
    expect(dup?.id).toBe('sib-manual');
  });

  it('非定时候选不受影响：仍按标题判重复', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 'sib-rec', title: '[通道自检] Brain定时→main · 2026-10-12 00:52', recurring_task_id: 'tpl-main', recurring_slot: '2026-10-11T16:52:00.000Z' },
    ] });
    const manual = { ...recurringCandidate, id: 'cand-manual', payload: {} };
    const dup = await _internals_findDuplicateTaskSibling(manual);
    expect(dup?.id).toBe('sib-rec');
  });
});
