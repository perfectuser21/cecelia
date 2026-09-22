/**
 * 接力棒 PR3 投影 — 失败复现
 *  1. buildProjectProps：Status 映射、Remark 含 n/m 棒 + 待拍板数
 *  2. buildProjectBody：目标/链/待拍板/最近交接四段，≤60 块
 *  3. pushProjectRoots：无 notion_id → POST 建页存指纹；指纹相同 → 跳过；页 404 → 重建
 *  4. pushPendingDecisions：草案属性 + 项目关系；回存 notion_id
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../recurring-notion-sync.js', () => ({ notionReq: vi.fn(), getToken: () => 'tok' }));

import {
  buildProjectProps, buildProjectBody, buildPendingDecisionProps, pushProjectRoots, pushPendingDecisions, digestOf,
  PROJECT_STATUS_TO_NOTION,
} from '../notion-relay-projection.js';

const ROOT = { id: '11111111-1111-4111-8111-111111111111', title: '接力棒：任务留痕与长链', description: '主理人不说也有人动', status: 'in_progress', notion_id: null, notion_props: null };
const SNAP = {
  children: [
    { id: 'c1', title: '第一棒：脊柱', status: 'completed', sequence_no: 1, last_done: '458 真列落地' },
    { id: 'c2', title: '第二棒：接棒', status: 'in_progress', sequence_no: 2, last_done: null },
  ],
  pending: [{ id: 'd1', topic: '4 张无血管表删列？', priority: 'P2' }],
  log: [{ at: '2026-09-23T01:00:00Z', title: '第一棒：脊柱', verdict: 'PASS', done: ['458 真列落地'] }],
};

describe('buildProjectProps / Body', () => {
  it('属性：Status 映射、AI Project、Run ID、Remark 含 1/2 棒 + 待拍板 1', () => {
    const p = buildProjectProps(ROOT, SNAP);
    expect(p.Status.status.name).toBe('In Progress');
    expect(p['AI Project'].checkbox).toBe(true);
    expect(p['Run ID'].rich_text[0].text.content).toBe(`brain:${ROOT.id}`);
    expect(p.Remark.rich_text[0].text.content).toContain('1/2 棒完成');
    expect(p.Remark.rich_text[0].text.content).toContain('待拍板 1');
    expect(PROJECT_STATUS_TO_NOTION.blocked).toBe('On Hold');
    expect(PROJECT_STATUS_TO_NOTION.completed).toBe('Completed');
  });
  it('正文：四段齐全、子任务按序带状态、待拍板带指引、≤60 块', () => {
    const b = buildProjectBody(ROOT, SNAP);
    const txt = JSON.stringify(b);
    expect(txt).toContain('目标');
    expect(txt).toContain('主理人不说也有人动');
    expect(txt).toContain('1. ✅ 第一棒：脊柱 — 458 真列落地');
    expect(txt).toContain('2. 🔄 第二棒：接棒');
    expect(txt).toContain('4 张无血管表删列？');
    expect(txt).toContain('已决定');
    expect(txt).toContain('最近交接');
    expect(txt).toContain('/api/brain/tasks/' + ROOT.id + '/chain');
    expect(b.length).toBeLessThanOrEqual(60);
  });
  it('digestOf 对同内容稳定、对改动敏感', () => {
    const a = digestOf(buildProjectProps(ROOT, SNAP), buildProjectBody(ROOT, SNAP));
    expect(a).toBe(digestOf(buildProjectProps(ROOT, SNAP), buildProjectBody(ROOT, SNAP)));
    expect(a).not.toBe(digestOf(buildProjectProps({ ...ROOT, status: 'completed' }, SNAP), buildProjectBody(ROOT, SNAP)));
  });
});

function poolWith({ roots, snap = SNAP, updates = [] }) {
  return { query: vi.fn(async (sql, params) => {
    if (/FROM tasks\s+WHERE task_type = 'project'/.test(sql)) return { rows: roots };
    if (/WHERE parent_task_id = \$1::uuid/.test(sql)) return { rows: snap.children };
    if (/FROM decisions\s+WHERE status = 'pending'/.test(sql)) return { rows: snap.pending };
    if (/handoff_log/.test(sql)) return { rows: snap.log.map((e) => ({ entry: e })) };
    if (/UPDATE tasks SET notion_id/.test(sql)) { updates.push(params); return { rows: [] }; }
    return { rows: [] };
  }) };
}

describe('pushProjectRoots', () => {
  it('无 notion_id → POST 建页（带正文）→ 存 notion_id + 指纹', async () => {
    const updates = [];
    const pool = poolWith({ roots: [ROOT], updates });
    const req = vi.fn(async (t, path, method, body) => {
      if (method === 'POST' && path === '/pages') { expect(body.children.length).toBeGreaterThan(4); return { id: 'page-1' }; }
      return {};
    });
    const s = await pushProjectRoots(pool, 'tok', { notionReq: req });
    expect(s).toEqual({ pushed: 1, skipped: 0, failed: 0 });
    expect(updates[0][1]).toBe('page-1');
    expect(updates[0][2]).toHaveLength(40);
  });
  it('指纹相同 → 跳过，不碰 Notion', async () => {
    const digest = digestOf(buildProjectProps(ROOT, SNAP), buildProjectBody(ROOT, SNAP));
    const pool = poolWith({ roots: [{ ...ROOT, notion_id: 'page-1', notion_props: { project_digest: digest } }] });
    const req = vi.fn();
    const s = await pushProjectRoots(pool, 'tok', { notionReq: req });
    expect(s.skipped).toBe(1);
    expect(req).not.toHaveBeenCalled();
  });
  it('指纹变了 → PATCH 属性 + 删旧块 + 追加新正文', async () => {
    const pool = poolWith({ roots: [{ ...ROOT, notion_id: 'page-1', notion_props: { project_digest: 'stale' } }] });
    const calls = [];
    const req = vi.fn(async (t, path, method) => { calls.push(`${method} ${path}`); if (method === 'GET') return { results: [{ id: 'b1' }, { id: 'b2' }] }; return {}; });
    await pushProjectRoots(pool, 'tok', { notionReq: req });
    expect(calls).toEqual(['PATCH /pages/page-1', 'GET /blocks/page-1/children?page_size=100', 'DELETE /blocks/b1', 'DELETE /blocks/b2', 'PATCH /blocks/page-1/children']);
  });
  it('页被删（404）→ 重建新页', async () => {
    const updates = [];
    const pool = poolWith({ roots: [{ ...ROOT, notion_id: 'gone', notion_props: { project_digest: 'stale' } }], updates });
    const req = vi.fn(async (t, path, method) => {
      if (method === 'PATCH' && path === '/pages/gone') throw new Error('Notion 404: Could not find page');
      if (method === 'POST') return { id: 'page-new' };
      return {};
    });
    const s = await pushProjectRoots(pool, 'tok', { notionReq: req });
    expect(s.pushed).toBe(1);
    expect(updates[0][1]).toBe('page-new');
  });
});

describe('pushPendingDecisions', () => {
  it('草案属性：状态=草案、类型=项目、结论/背景/来源、项目关系；回存 notion_id', async () => {
    const d = { id: 'd1', topic: '删不删列', decision: '（待主理人拍板）', reason: '接力棒提出', context: { task_id: 't1', root_task_id: ROOT.id, task_title: '第二棒' }, priority: 'P2', root_notion_id: 'proj-page' };
    const props = buildPendingDecisionProps(d, { rootNotionId: 'proj-page' });
    expect(props['状态'].select.name).toBe('草案');
    expect(props['类型'].select.name).toBe('项目');
    expect(props['背景'].rich_text[0].text.content).toContain('来自任务：第二棒');
    expect(props['项目'].relation[0].id).toBe('proj-page');
    expect(props['来源'].url).toContain('/api/brain/tasks/t1');
    const updates = [];
    const pool = { query: vi.fn(async (sql, params) => { if (/FROM decisions d/.test(sql)) return { rows: [d] }; if (/UPDATE decisions SET notion_id/.test(sql)) { updates.push(params); return { rows: [] }; } return { rows: [] }; }) };
    const req = vi.fn(async () => ({ id: 'dec-page' }));
    const s = await pushPendingDecisions(pool, 'tok', { notionReq: req });
    expect(s).toEqual({ pushed: 1, failed: 0 });
    expect(updates[0]).toEqual(['d1', 'dec-page']);
  });
});
