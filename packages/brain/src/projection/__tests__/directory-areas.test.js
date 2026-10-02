import { describe, expect, it } from 'vitest';
import { readDirectoryAreas } from '../directory-areas.js';
const dbId = '10000000-0000-4000-8000-000000000001';
const rootId = '10000000-0000-4000-8000-000000000002';
const childId = '10000000-0000-4000-8000-000000000003';
const page = (id, name, parent) => ({ id, parent: { database_id: dbId }, properties: {
  Name: { title: [{ text: { content: name } }] }, Archive: { checkbox: false },
  'Parent item': { relation: parent ? [{ id: parent }] : [] },
} });
describe('组织源快照完整读取', () => {
  it('完整分页后才验证跨页父关系，不反写人工属性', async () => {
    const calls = [];
    const notionReq = async (_token, path, method, body) => {
      calls.push({ path, method, body });
      return body.start_cursor ? { results: [page(rootId, 'Cecelia')], has_more: false }
        : { results: [page(childId, '管家', rootId)], has_more: true, next_cursor: 'page2' };
    };
    const rows = await readDirectoryAreas({ dbId, token: 'test', notionReq });
    expect(rows).toHaveLength(2); expect(rows[0].parent_notion_id).toBe(rootId);
    expect(calls).toHaveLength(2); expect(calls[1].body.start_cursor).toBe('page2');
    expect(calls.every(call => call.method === 'POST' && call.path.endsWith('/query'))).toBe(true);
  });
  it('缺has_more时不能声称已经读完组织树', async () => {
    await expect(readDirectoryAreas({ dbId, token: 'test', notionReq: async () => ({ results: [page(rootId, 'Cecelia')] }) }))
      .rejects.toThrow(/pagination/);
  });
  it('空快照不抹除既有组织树', async () => {
    await expect(readDirectoryAreas({ dbId, token: 'test', notionReq: async () => ({ results: [], has_more: false }) }))
      .rejects.toThrow(/empty_snapshot/);
  });
});
