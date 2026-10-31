import { describe, expect, it, vi } from 'vitest';

const notion = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../recurring-notion-sync.js', () => ({ notionReq: notion.request, getToken: vi.fn() }));
import * as sync from '../notion-push-sync.js';

function backend() {
  const human = { id: 'human', type: 'paragraph', paragraph: { rich_text: [{ text: { content: '原有人工作品' } }] } };
  let blocks = [human], next = 0;
  notion.request.mockReset().mockImplementation(async (_token, path, method, body) => {
    if (path.startsWith('/pages/') && method === 'PATCH') return {};
    if (method === 'DELETE') { blocks = blocks.filter(b => b.id !== path.split('/').pop()); return {}; }
    if (method === 'PATCH') { const added = body.children.map(b => ({ ...b, id: `managed-${++next}` })); blocks.push(...added); return { results: added }; }
    const id = path.match(/\/blocks\/([^/]+)\/children/)?.[1];
    return { results: id === 'page' ? blocks : blocks.find(b => b.id === id)?.toggle?.children || [], has_more: false };
  });
  return { human, get blocks() { return blocks; } };
}

describe('Issue 已创建后的正文投影', () => {
  it('同属性时同步新正文并读回，保留原有人工作品，重复投影幂等', async () => {
    const b = backend();
    const issue = { id: 'issue', notion_id: 'page', title: '抽样合同断裂', priority: 'P1', status: 'In progress', body: '原证据\n项目: https://app.notion.com/p/project\n任务: https://app.notion.com/p/task' };
    const pool = { query: vi.fn(async sql => sql.startsWith('SELECT') ? { rows: [issue] } : { rows: [] }) };
    await sync.pushIssues(pool, 'token');
    expect(b.blocks).toContainEqual(b.human);
    expect(JSON.stringify(b.blocks)).toContain('https://app.notion.com/p/project');
    const writes = notion.request.mock.calls.filter(c => c[2] === 'PATCH' && c[1].includes('/blocks/')).length;
    await sync.pushIssues(pool, 'token');
    expect(notion.request.mock.calls.filter(c => c[2] === 'PATCH' && c[1].includes('/blocks/'))).toHaveLength(writes);
    issue.body = '更新后的事实与下一步';
    await sync.pushIssues(pool, 'token');
    expect(JSON.stringify(b.blocks)).toContain('更新后的事实与下一步');
    expect(JSON.stringify(b.blocks)).not.toContain('https://app.notion.com/p/project');
    expect(b.blocks).toContainEqual(b.human);
    expect(b.blocks.filter(block => block.type === 'toggle')).toHaveLength(1);
  });
  it('正文读回失败时不标记同步完成，保留原有人工作品', async () => {
    const b = backend();
    const original = notion.request.getMockImplementation();
    notion.request.mockImplementation(async (...args) => {
      if (args[1].includes('/blocks/managed-') && args[2] === 'GET') throw new Error('读回失败');
      return original(...args);
    });
    const issue = { id: 'issue', notion_id: 'page', title: '问题', body: '新事实' };
    const pool = { query: vi.fn(async sql => sql.startsWith('SELECT') ? { rows: [issue] } : { rows: [] }) };
    await sync.pushIssues(pool, 'token');
    expect(b.blocks).toContainEqual(b.human);
    expect(pool.query.mock.calls.some(([sql]) => /notion_synced_at=NULL/.test(sql))).toBe(true);
    expect(pool.query.mock.calls.some(([sql]) => /notion_synced_at = NOW\(\)/.test(sql))).toBe(false);
  });
});
