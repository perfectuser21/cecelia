import { describe, expect, it, vi } from 'vitest';
vi.mock('../../recurring-notion-sync.js', () => ({ notionReq: vi.fn(), getToken: () => 'tok' }));
vi.mock('../../task-updater.js', () => ({ blockTask: vi.fn(), unblockTask: vi.fn() }));
vi.mock('../../projection/commands.js', () => ({ recordProjectionCommand: vi.fn() }));
const ID = '15f42776-8d1b-430d-b27a-38a480b93151';
const PAGE = '11111111-2222-3333-4444-555555555555';
const text = (value) => [{ plain_text: value }];
const block = (value, extra = {}) => ({ type: 'paragraph', paragraph: { rich_text: text(value) }, ...extra });
function setup(o = {}) {
  const source = { title: '抖音采集', remark: '', body: '设备：未知' };
  const candidate = { id: ID, task_type: 'qiumi_task', status: 'blocked', blocked_reason: 'device_unresolved',
    payload: { notion_zh_page_id: PAGE, qiumi_source: source, qiumi_route: { stale: true }, run_id: 'stale',
      headed_manual: true, next_run_at: '2030-10-04T09:00:00Z', scheduled_start: '2030-10-03T09:00:00Z',
      routing_receipt_id: 'preserved', custom: 'preserved' }, ...o.candidate };
  const page = { id: PAGE, last_edited_time: '2026-10-01T00:00:00Z', properties: {
    '名称': { title: text(o.title ?? source.title) }, '备注': { rich_text: text(o.remark ?? '') },
    '状态': { status: { name: o.status ?? '进行中' } },
    'OpenClaw任务号': { rich_text: text(o.marker ?? `brain:${ID}`) },
  }, ...o.page };
  let reads = 0;
  const notionReq = vi.fn(async (_token, path, method) => {
    if (method === 'POST') return { results: [] };
    if (path.startsWith('/pages/')) { reads += 1; if (o.pageError) throw new Error('Notion unavailable');
      return reads > 1 && o.secondPage ? o.secondPage : page; }
    if (o.blockError && path.includes('start_cursor')) throw new Error('partial failure');
    if (path.includes('/nested/')) return { results: [block(o.nested)] };
    if (path.includes('start_cursor')) return { results: [block(o.body ?? '手机：验收小黄')] };
    return { results: [block('正文前段', { id: 'nested', has_children: !!o.nested })], has_more: true, next_cursor: 'page-2' };
  });
  const phones = o.phones ?? [{ serial: 'test-serial', nickname: '验收小黄', aliases: [], enabled: true,
    douyin_accounts: [{ nickname: '验收小彩', account_id: 'test-account' }] }];
  const query = vi.fn(async (sql) => {
    if (/SELECT.*FROM tasks/s.test(sql)) return { rows: [candidate] };
    if (/FROM phone_registry/.test(sql)) return { rows: phones };
    if (/SELECT/.test(sql)) return { rows: [] };
    if (/UPDATE tasks/.test(sql)) return { rows: o.casLost ? [] : [{ id: ID }] };
    return { rows: [] };
  });
  return { candidate, page, notionReq, query };
}
async function run(o) {
  const { applyOwnerStops } = await import('../../notion-gtd-sync.js');
  const f = setup(o);
  const result = await applyOwnerStops({ query: f.query }, 'tok', { notionReq: f.notionReq });
  return { ...f, result, updates: f.query.mock.calls.filter(([sql]) => /UPDATE tasks/.test(sql)),
    events: f.query.mock.calls.filter(([sql]) => /INSERT INTO task_events/.test(sql)) };
}
describe('原Notion页设备补写自动恢复原task', () => {
  it.each(['进行中', '委派'])('%s完整读分页嵌套后恢复原task', async (status) => {
    const { result, updates, events, notionReq } = await run({ status, nested: '账号：验收小彩' });
    expect(result.rerouted).toBe(1); expect(updates).toHaveLength(1);
    const [sql, args] = updates[0];
    expect(sql).toMatch(/status = 'blocked'/); expect(sql).toMatch(/blocked_reason = 'device_unresolved'/);
    expect(sql).toMatch(/task_type = 'qiumi_task'/); expect(sql).toMatch(/RETURNING id/);
    expect(sql).not.toMatch(/due_at\s*=/); expect(args[0]).toBe(ID);
    expect(args[1]).toEqual(expect.arrayContaining(['qiumi_route', 'run_id']));
    expect(args[1]).not.toContain('headed_manual'); expect(args[1]).not.toContain('next_run_at');
    expect(JSON.parse(args[2]).body).toContain('账号：验收小彩'); expect(JSON.parse(args[2]).body).toContain('手机：验收小黄');
    expect(events).toHaveLength(1); expect(events[0][1][1]).toBe('qiumi_device_rerouted');
    expect(notionReq.mock.calls.filter(([, , method]) => method === 'GET')).toHaveLength(5);
  });
  it.each([{ title: '手机：验收小黄', body: '' }, { remark: '账号：验收小彩', body: '' }])('标题备注有效补写 %#', async (o) => {
    expect((await run(o)).result.rerouted).toBe(1);
  });
  it('正文改动触发；相同内容不反复恢复', async () => {
    expect((await run()).result.rerouted).toBe(1);
    const original = { title: '抖音采集', remark: '', body: '正文前段\n手机：验收小黄' };
    const { result, updates } = await run({ candidate: { payload: { notion_zh_page_id: PAGE, qiumi_source: original } } });
    expect(result.rerouted).toBe(0); expect(updates).toHaveLength(0);
  });
  it.each(['淘汰', '阻塞', '暂停', '完成'])('人工%s不恢复', async (status) => {
    const { result, updates } = await run({ status }); expect(result.rerouted).toBe(0); expect(updates).toHaveLength(0);
  });
  it.each([{ marker: `brain:${ID} extra` }, { marker: 'brain:other' }, { page: { id: 'copy' } },
    { page: { archived: true } }, { page: { in_trash: true } }, { candidate: { task_type: 'data' } },
    { candidate: { status: 'completed' } }, { candidate: { status: 'paused' } }, { candidate: { blocked_reason: 'owner_hold' } },
  ])('归属或状态不匹配 %#', async (o) => {
    const { result, updates } = await run(o); expect(result.rerouted).toBe(0); expect(updates).toHaveLength(0);
  });
  it.each([{ body: '型号：红米Note12' }, { body: '手机：陌生昵称' }, { phones: [] },
    { phones: [{ serial: 'test', nickname: '验收小黄', enabled: false }] },
    { phones: [{ serial: 'one', nickname: '验收小黄' }, { serial: 'two', nickname: '验收小黄' }] },
    { nested: '手机：另一个', phones: [{ serial: 'one', nickname: '验收小黄' }, { serial: 'two', nickname: '另一个' }] },
  ])('不唯一、不完整台账 %#', async (o) => {
    const { result, updates } = await run(o); expect(result.rerouted).toBe(0); expect(updates).toHaveLength(0);
  });
  it.each([{ pageError: true }, { blockError: true, title: '手机：验收小黄' }, { secondPage: { id: PAGE, last_edited_time: 'changed' } }])(
    'Notion失败或读取期间改页 %#', async (o) => {
      const { result, updates } = await run(o); expect(result.rerouted).toBe(0); expect(updates).toHaveLength(0);
    });
  it('CAS零行不能记事件或成功', async () => {
    const { result, updates, events } = await run({ casLost: true });
    expect(result.rerouted).toBe(0); expect(updates).toHaveLength(1); expect(events).toHaveLength(0);
  });
});
