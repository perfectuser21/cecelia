/**
 * 回归：Notion 推送两类「每轮必败、永不自愈」的错误（2026-09-29 生产日志实证）
 *  1. PATCH 页面 → 400「Can't edit page on block with an archived ancestor」（页或所在库在回收站）
 *     旧行为：只处理 404 / 错库 400，这种 400 只记日志、每 5 分钟重试一次，永远失败。
 *     期望：视同 404 —— 清 notion_id 与指纹，下轮重建。tasks / skill_registry / 统一引擎 / relay project 四处同病。
 *  2. Issues 推送 → 400「Invalid status option. Status option "Backlog" does not exist」
 *     Notion Issues 库 Status 只有 Open / Triage / In progress / Closed；issues 表里有 Backlog/Done/open/closed。
 *     期望：映射 Backlog→Open、Done→Closed、open→Open、closed→Closed（大小写不敏感），合法值原样，未知→Open。
 */
import { describe, it, expect, vi } from 'vitest';

const mockQuery = vi.fn();
const mockNotionReq = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../recurring-notion-sync.js', () => ({ notionReq: mockNotionReq, getToken: () => 'fake-token' }));
vi.mock('../work-routing-store.js', () => ({ createRoutedTask: vi.fn() }));

const ARCHIVED_MSG = "Notion PATCH /pages/p1 → 400: Can't edit page on block with an archived ancestor. You must unarchive the ancestor before editing page.";

describe('archived ancestor 400 → 视同 404 自愈', () => {
  it('tasks：有本系统指纹的页 PATCH 报 archived ancestor → 清 notion_id 与 pushed_status 指纹', async () => {
    mockQuery.mockReset(); mockNotionReq.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockNotionReq.mockRejectedValue(new Error(ARCHIVED_MSG));
    const mod = await import('../notion-push-sync.js');
    const task = { id: 't-arch', title: 'x', status: 'completed', priority: 'P2', task_type: 'dev',
      notion_id: 'p1', notion_props: { pushed_status: 'in_progress' } };
    await mod.pushTasksForTest({ query: mockQuery }, 'fake-token', [task]);
    const clear = mockQuery.mock.calls.find((c) => /UPDATE tasks SET notion_id=NULL/.test(String(c[0])));
    expect(clear).toBeTruthy();
    expect(clear[1]).toEqual(['t-arch']);
  });

  it('isPageGoneError：404 与 archived ancestor 都算页不可用，普通 400 不算', async () => {
    const { isPageGoneError } = await import('../lib/notion-projection-engine.js');
    expect(isPageGoneError(new Error(ARCHIVED_MSG))).toBe(true);
    expect(isPageGoneError(new Error('Notion PATCH → 404: Could not find page'))).toBe(true);
    expect(isPageGoneError(new Error('Notion PATCH → 400: validation_error body.x'))).toBe(false);
  });

  it('统一引擎：有 notion_id 的行 PATCH 报 archived ancestor → 清 notion_id + notion_digest（cleared）', async () => {
    const { pushRegisteredRows } = await import('../lib/notion-projection-engine.js');
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    const notion = vi.fn(async () => { throw new Error(ARCHIVED_MSG); });
    const res = await pushRegisteredRows(pool, 't', { table: 'issues', dbId: 'db1',
      rows: [{ id: 7, name: 'n', notion_id: 'p1', notion_digest: 'old' }],
      buildProps: (r) => ({ Name: { title: [{ text: { content: r.name } }] } }), notionReq: notion });
    expect(res.cleared).toBe(1);
    expect(res.failed).toBe(0);
    expect(pool.query.mock.calls.some((c) => /SET notion_id = NULL, notion_digest = NULL/.test(c[0]))).toBe(true);
  });

  it('relay project：PATCH 报 archived ancestor → 重建新页并回存新 notion_id', async () => {
    const { pushProjectRoots } = await import('../notion-relay-projection.js');
    const updates = [];
    const root = { id: '11111111-1111-4111-8111-111111111111', title: 'p', description: 'd', status: 'in_progress',
      notion_id: 'p1', notion_props: { project_digest: 'stale' } };
    const pool = { query: vi.fn(async (sql, params) => {
      if (/FROM tasks\s+WHERE task_type = 'project'/.test(sql)) return { rows: [root] };
      if (/UPDATE tasks SET notion_id/.test(sql)) { updates.push(params); return { rows: [] }; }
      return { rows: [] };
    }) };
    const req = vi.fn(async (t, path, method) => {
      if (method === 'PATCH' && path === '/pages/p1') throw new Error(ARCHIVED_MSG);
      if (method === 'POST') return { id: 'page-new' };
      return {};
    });
    const s = await pushProjectRoots(pool, 'tok', { notionReq: req, log: { warn: () => {} } });
    expect(s.pushed).toBe(1);
    expect(s.failed).toBe(0);
    expect(updates[0][1]).toBe('page-new');
  });
});

describe('Issues Status 映射到 Notion 合法选项', () => {
  it('Backlog→Open / Done→Closed / open→Open / closed→Closed，大小写不敏感', async () => {
    const { issueStatusToNotion } = await import('../notion-push-sync.js');
    expect(issueStatusToNotion('Backlog')).toBe('Open');
    expect(issueStatusToNotion('backlog')).toBe('Open');
    expect(issueStatusToNotion('Done')).toBe('Closed');
    expect(issueStatusToNotion('DONE')).toBe('Closed');
    expect(issueStatusToNotion('open')).toBe('Open');
    expect(issueStatusToNotion('closed')).toBe('Closed');
  });
  it('合法值原样（规范大小写），未知值与空值→Open', async () => {
    const { issueStatusToNotion } = await import('../notion-push-sync.js');
    expect(issueStatusToNotion('Open')).toBe('Open');
    expect(issueStatusToNotion('Triage')).toBe('Triage');
    expect(issueStatusToNotion('In progress')).toBe('In progress');
    expect(issueStatusToNotion('in progress')).toBe('In progress');
    expect(issueStatusToNotion('Closed')).toBe('Closed');
    expect(issueStatusToNotion('weird')).toBe('Open');
    expect(issueStatusToNotion(null)).toBe('Open');
  });
  it('pushIssues 实际发送的 Status 走映射（Backlog 行推成 Open）', async () => {
    const { buildIssueNotionProperties } = await import('../notion-push-sync.js');
    const p = buildIssueNotionProperties({ title: 't', priority: 'P1', status: 'Backlog' });
    expect(p.Status.status.name).toBe('Open');
    expect(p.Issue.title[0].text.content).toBe('t');
  });
});
