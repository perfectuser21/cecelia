import { describe, it, expect, vi } from 'vitest';
import { pushProjectRoots, buildProjectProps, PROJECT_STATUS_TO_NOTION } from '../notion-relay-projection.js';
import { brainHuman, humanProps } from '../lib/project-notion-human.js';

const root = { id: '11111111-1111-4111-8111-111111111111', title: '项目', status: 'active', ai_tier: '知情', custom_props: {} };
const snap = { children: [], pending: [], log: [] };
function fixture(row = root) {
  const saved = { ...row, notion_props: { ...row.notion_props } };
  const pool = { query: vi.fn(async (sql, values) => {
    if (/FROM projects/.test(sql)) return { rows: [saved] };
    if (/UPDATE projects SET status/.test(sql)) { saved.notion_props = JSON.parse(values[6]); return { rows: [saved] }; }
    if (/UPDATE projects/.test(sql) && /pending_human_push/.test(sql)) saved.notion_props.pending_human_push = JSON.parse(values[1]);
    if (/UPDATE projects/.test(sql) && /human_baseline/.test(sql)) saved.notion_props.human_baseline = JSON.parse(values[1]);
    return { rows: [] };
  }) };
  const req = vi.fn(async (_t, path, method) => {
    if (method === 'GET' && path.startsWith('/pages/')) return { id: 'page', parent: { database_id: 'd83c40c2-ba63-8323-8dc7-01cc291c4d9b' }, properties: humanProps(brainHuman(saved)), results: [] };
    if (method === 'POST' && path === '/pages') return { id: 'new-page' };
    return { results: [] };
  });
  return { pool, req, saved };
}
describe('项目同步推送回归', () => {
  it('已归档→Discard，规划→In Progress；人工备注与机器进展分列', () => {
    expect(PROJECT_STATUS_TO_NOTION.archived).toBe('Discard');
    expect(PROJECT_STATUS_TO_NOTION.planning).toBe('In Progress');
    const props = buildProjectProps({ ...root, custom_props: { remark: '人的备注' } }, snap);
    expect(props.Remark.rich_text[0].text.content).toBe('人的备注');
    expect(props['AI 进展'].rich_text[0].text.content).toBe('尚无子任务');
    expect(props['AI 参与'].select.name).toBe('知情');
  });
  it('超过30个和较早归档项目也参与推送', async () => {
    const f = fixture();
    await pushProjectRoots(f.pool, 'tok', { notionReq: f.req });
    const sql = f.pool.query.mock.calls.find(([s]) => /FROM projects/.test(s))[0];
    expect(sql).not.toMatch(/LIMIT 30|WHERE status NOT IN/);
  });
  it('Notion 人建项目只改属性，人工正文不删不追加', async () => {
    const f = fixture({ ...root, metadata: { source: 'notion' }, notion_props: { notion_id: 'page', human_baseline: brainHuman(root) } });
    expect((await pushProjectRoots(f.pool, 'tok', { notionReq: f.req })).failed).toBe(0);
    expect(f.req.mock.calls.some(([, p]) => p.startsWith('/blocks/'))).toBe(false);
  });
  it('建页前按 Run ID 找回上轮已创建但未落库的页', async () => {
    const f = fixture();
    f.req.mockImplementation(async (_t, path, method) => {
      if (path.endsWith('/query')) return { results: [{ id: 'recovered', parent: { database_id: 'd83c40c2-ba63-8323-8dc7-01cc291c4d9b' }, properties: humanProps(brainHuman(root)) }] };
      if (method === 'GET') return { results: [] };
      return {};
    });
    await pushProjectRoots(f.pool, 'tok', { notionReq: f.req });
    expect(f.req.mock.calls.some(([, p, m]) => p === '/pages' && m === 'POST')).toBe(false);
    expect(f.req.mock.calls.some(([, p, m]) => p === '/pages/recovered' && m === 'PATCH')).toBe(true);
  });
});
