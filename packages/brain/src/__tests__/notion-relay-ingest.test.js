/**
 * 接力棒 PR3 — 待拍板回灌：Brain 推出去的草案被主理人改成「已决定」
 *  → 更新同一行（不新插）为 active/made_by=user → 自动登记「执行拍板」子任务挂根 → 收据落 receipts
 */
import { describe, it, expect, vi } from 'vitest';

const created = [];
vi.mock('../work-routing-store.js', () => ({
  createRoutedTask: vi.fn(async (_pool, req) => { created.push(req); return { task: { id: 'exec-1', title: req.title } }; }),
}));
vi.mock('../recurring-notion-sync.js', () => ({ notionReq: vi.fn(), getToken: () => 'tok' }));

import { ingestDecisionsInlet } from '../notion-inlet-ingest.js';

const PAGE = {
  id: 'page-dec-1', last_edited_time: '2026-09-23T02:00:00Z',
  properties: {
    '决策': { type: 'title', title: [{ plain_text: '4 张无血管表删列？' }] },
    '状态': { type: 'select', select: { name: '已决定' } },
    '类型': { type: 'select', select: { name: '项目' } },
    '结论': { type: 'rich_text', rich_text: [{ plain_text: '删列，别接血管' }] },
    '理由': { type: 'rich_text', rich_text: [{ plain_text: '没人看' }] },
    '决策日期': { type: 'date', date: { start: '2026-09-23' } },
  },
};

describe('待拍板 → 已决定 回灌', () => {
  it('命中 pending 行 → UPDATE 同一行、不 INSERT、登记执行子任务挂根、写收据', async () => {
    const sqls = [];
    const pool = { query: vi.fn(async (sql, params) => {
      sqls.push(sql);
      if (/FROM notion_ingest_receipts/.test(sql)) return { rows: [] };
      if (/FROM decisions WHERE notion_id = \$1 AND status = 'pending'/.test(sql)) {
        return { rows: [{ id: 'd-pending', priority: 'P1', context: { root_task_id: 'root-1', task_id: 't-2' } }] };
      }
      if (/UPDATE decisions SET status = 'active'/.test(sql)) { expect(params[0]).toBe('d-pending'); expect(params[2]).toBe('删列，别接血管'); return { rows: [] }; }
      return { rows: [] };
    }) };
    const notionReq = vi.fn(async () => ({ results: [PAGE], has_more: false }));
    const stat = await ingestDecisionsInlet(pool, 'tok', { dbId: 'f93e', notionReq, log: { warn: vi.fn() } });
    expect(stat.resolved).toBe(1);
    expect(stat.inserted).toBe(0);
    expect(sqls.some((s) => /INSERT INTO decisions/.test(s))).toBe(false);
    expect(sqls.some((s) => /UPDATE decisions SET status = 'active'/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO notion_ingest_receipts/.test(s))).toBe(true);
    expect(created[0]).toMatchObject({ source: 'child', source_id: 'decision:d-pending', parent_task_id: 'root-1', requested_task_type: 'data' });
    expect(created[0].title).toContain('执行拍板：4 张无血管表删列？');
    expect(created[0].metadata).toMatchObject({ lane: 'AI', from_decision: 'd-pending' });
  });
  it('不是 Brain 推的页（无 pending 命中）→ 走原路：INSERT 新行', async () => {
    const sqls = [];
    const pool = { query: vi.fn(async (sql) => {
      sqls.push(sql);
      if (/INSERT INTO decisions/.test(sql)) return { rows: [{ id: 'd-new' }] };
      return { rows: [] };
    }) };
    const notionReq = vi.fn(async () => ({ results: [PAGE], has_more: false }));
    const stat = await ingestDecisionsInlet(pool, 'tok', { dbId: 'f93e', notionReq, log: { warn: vi.fn() } });
    expect(stat.inserted).toBe(1);
    expect(stat.resolved).toBe(0);
  });
});
