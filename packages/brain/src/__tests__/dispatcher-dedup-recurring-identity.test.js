/**
 * dispatcher-dedup-recurring-identity.test.js — 定时实例的业务身份判重（任务 c8320370）
 *
 * 生产复现（10-12 00:52）：5 个不同定时模板同一时间点各建一张 qiumi_task，标题只差一个 agent 名，
 * 派发前标题查重（Jaccard≥0.6）把它们两两判成「重复」——都还在 queued，互相跳过，谁都派不出去（互锁）。
 * 定时实例的身份 = 模板 + 时间点，且只认路由收据（source=scheduler、source_id=recurring:<模板>:<时间点>），
 * payload 自报可伪造不作数。双方都是已验证定时实例时按身份判；其余仍按原标题规则；script_run 不在此豁免。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...args) => mockQuery(...args) } }));
vi.mock('../dispatch-stats.js', () => ({ recordDispatchResult: vi.fn(), DISPATCH_STATS_KEY: 'dispatch_stats' }));

import { _internals_findDuplicateTaskSibling } from '../dispatcher.js';

const now = new Date().toISOString();
const candidate = {
  id: 'cand-media', task_type: 'qiumi_task', created_at: now,
  title: 'media通道复测 · 2026-10-12 01:22',
  payload: { recurring_task_id: 'tpl-media', recurring_slot: '2026-10-11T17:22:00.000Z', routing_receipt_id: 'rcpt-media' },
};
const CAND_ID = 'recurring:tpl-media:2026-10-11T17:22:00.000Z';
const row = (over) => ({ id: 'sib', title: 'newmedia通道复测 · 2026-10-12 01:22', recurring_identity: null, candidate_recurring_identity: CAND_ID, ...over });

describe('定时实例按路由收据验证的模板+时间点判身份', () => {
  beforeEach(() => mockQuery.mockReset());

  it('双方都是已验证定时实例、模板不同：标题再像也不判重复（防互锁）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row({ recurring_identity: 'recurring:tpl-newmedia:2026-10-11T17:22:00.000Z' })] });
    expect(await _internals_findDuplicateTaskSibling(candidate)).toBeNull();
  });

  it('双方身份相同（同模板同时间点）判重复', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row({ recurring_identity: CAND_ID })] });
    expect(await _internals_findDuplicateTaskSibling(candidate)).toMatchObject({ id: 'sib', duplicate_reason: 'duplicate_recurring_identity_match' });
  });

  it('sibling 不是已验证定时实例（手工建/自报 payload）：仍按标题判重复', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row({ recurring_identity: null })] });
    expect((await _internals_findDuplicateTaskSibling(candidate))?.id).toBe('sib');
  });

  it('候选自报定时 payload 但收据对不上（伪造）：不能获得豁免', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row({ candidate_recurring_identity: null, recurring_identity: 'recurring:tpl-newmedia:2026-10-11T17:22:00.000Z' })] });
    expect((await _internals_findDuplicateTaskSibling(candidate))?.id).toBe('sib');
  });

  it('查询为非 script_run 候选带出收据身份列；script_run 不带（走正式代码身份规则）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await _internals_findDuplicateTaskSibling(candidate);
    expect(mockQuery.mock.calls[0][0]).toContain('candidate_recurring_identity');
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await _internals_findDuplicateTaskSibling({ ...candidate, task_type: 'script_run' });
    expect(mockQuery.mock.calls[1][0]).not.toContain('candidate_recurring_identity');
  });
});
