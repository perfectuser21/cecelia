import { expect, it, vi } from 'vitest';
import { replacePageBody } from '../notion-relay-projection.js';

it('追加遭限流时原项目计划和人工块均保留，供下一轮重试', async () => {
  const original = [{ id: 'old', type: 'paragraph', paragraph: { rich_text: [{ text: { content: '旧计划' } }] } }, { id: 'human', type: 'paragraph', paragraph: { rich_text: [{ text: { content: '人工备注' } }] } }];
  let blocks = [...original];
  const req = vi.fn(async (_t, path, method) => {
    if (method === 'GET') return { results: blocks, has_more: false };
    if (method === 'DELETE') { blocks = blocks.filter(b => b.id !== path.split('/').pop()); return {}; }
    if (method === 'PATCH') throw new Error('429');
  });
  await expect(replacePageBody(req, 'token', 'page', [{ type: 'paragraph', paragraph: { rich_text: [{ text: { content: '新计划' } }] } }])).rejects.toThrow('429');
  expect(blocks).toEqual(original);
  expect(req.mock.calls.some(c => c[2] === 'DELETE')).toBe(false);
});

it('新计划读回后才清旧机器块，人工内容保留且重复推送幂等', async () => {
  const old = { id: 'old-managed', type: 'toggle', toggle: { rich_text: [{ text: { content: '🤖 项目最新进展（机器维护：改事实请改 Brain）' } }], children: [{ type: 'paragraph', paragraph: { rich_text: [{ text: { content: '旧计划' } }] } }] } };
  const human = { id: 'human', type: 'paragraph', paragraph: { rich_text: [{ text: { content: '人工备注' } }] } };
  let blocks = [old, human], verified = false;
  const req = vi.fn(async (_t, path, method, body) => {
    if (method === 'PATCH') { const b = { ...body.children[0], id: 'new-managed' }; blocks.push(b); return { results: [b] }; }
    if (method === 'DELETE') { expect(verified).toBe(true); blocks = blocks.filter(b => b.id !== path.split('/').pop()); return {}; }
    const id = path.match(/\/blocks\/([^/]+)\/children/)?.[1];
    if (id === 'new-managed') verified = true;
    return { results: id === 'page' ? blocks : blocks.find(b => b.id === id)?.toggle?.children || [], has_more: false };
  });
  const next = [{ type: 'paragraph', paragraph: { rich_text: [{ text: { content: '新计划' } }] } }];
  await replacePageBody(req, 'token', 'page', next);
  expect(blocks).toContainEqual(human);
  expect(blocks.map(b => b.id)).toEqual(['human', 'new-managed']);
  expect(JSON.stringify(blocks)).toContain('新计划');
  const writes = req.mock.calls.filter(c => c[2] !== 'GET').length;
  await replacePageBody(req, 'token', 'page', next);
  expect(req.mock.calls.filter(c => c[2] !== 'GET')).toHaveLength(writes);
});
