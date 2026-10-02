import { describe, it, expect, vi } from 'vitest';
const api = await import('../directory-projector.js').catch(() => ({}));
const id = '00000000-0000-4000-8000-000000000001';
const dbId = '00000000-0000-4000-8000-000000000002';
const pageId = '00000000-0000-4000-8000-000000000003';
const rich = value => ({ rich_text: [{ text: { content: value } }] });
function fixture({ linked = true, identity = id, parent = dbId, readbackWrong = false, duplicate = false } = {}) {
  let properties = { 'Brain ID': rich(identity) };
  const query = vi.fn(async sql => ({ rows: sql.includes('FROM projection_links') ? (linked ? [{ entity_type: 'workflows', entity_id: id, external_id: pageId }] : []) : [] }));
  const notionReq = vi.fn(async (_token, path, method, body) => {
    if (path.endsWith('/query')) return { results: duplicate ? [{ id: pageId }, { id: 'duplicate' }] : [], has_more: false };
    if (method === 'PATCH' || path === '/pages') properties = { ...properties, ...body.properties };
    return { id: pageId, parent: { database_id: parent }, properties: readbackWrong && method === 'GET' ? { ...properties, Activities: { relation: [] } } : structuredClone(properties) };
  });
  const row = { layer: 'workflows', table: 'workflows', id, pageId: null, allowCreate: true, properties: { 'Brain ID': rich(id) }, relations: {}, gaps: [] };
  return { pool: { query }, query, notionReq, row };
}
describe('严格目录页投影', () => {
  it('导出独立严格页入口', () => expect(api.projectDirectoryPage).toBeTypeOf('function'));
  it('旧合法链接可认领，GET读回之后才写成功receipt', async () => {
    const f = fixture({ identity: '' });
    await api.projectDirectoryPage(f.pool, { token: 'test', dbId, row: f.row, properties: f.row.properties, notionReq: f.notionReq });
    expect(f.notionReq.mock.calls.map(c => c[2])).toEqual(['GET', 'PATCH', 'GET']);
    expect(f.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO projection_links'))).toBe(true);
  });
  it.each([{ parent: 'wrong' }, { identity: 'other' }])('旧页错库或身份冲突保留映射且零PATCH %j', async options => {
    const f = fixture(options);
    await expect(api.projectDirectoryPage(f.pool, { token: 'test', dbId, row: f.row, properties: f.row.properties, notionReq: f.notionReq })).rejects.toThrow();
    expect(f.notionReq.mock.calls.some(c => c[2] === 'PATCH')).toBe(false);
    expect(f.query.mock.calls.some(([sql]) => /UPDATE|INSERT|DELETE/.test(sql))).toBe(false);
  });
  it('关系读回不一致不能记成功', async () => {
    const f = fixture({ readbackWrong: true });
    await expect(api.projectDirectoryPage(f.pool, { token: 'test', dbId, row: f.row, properties: { ...f.row.properties, Activities: { relation: [{ id: pageId }] } }, notionReq: f.notionReq })).rejects.toThrow(/读回/);
    expect(f.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO projection_links'))).toBe(false);
  });
  it('重复Brain ID页拒绝，不按标题抢占或创建第三页', async () => {
    const f = fixture({ linked: false, duplicate: true });
    await expect(api.projectDirectoryPage(f.pool, { token: 'test', dbId, row: f.row, properties: f.row.properties, notionReq: f.notionReq })).rejects.toThrow(/重复/);
    expect(f.notionReq.mock.calls.some(c => c[1] === '/pages')).toBe(false);
  });
});
