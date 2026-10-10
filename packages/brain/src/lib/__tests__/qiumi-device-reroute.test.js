import { describe, expect, it, vi } from 'vitest';
import { rerouteUnresolvedDevices } from '../qiumi-device-reroute.js';
vi.mock('../../recurring-notion-sync.js', () => ({ notionReq: vi.fn(), getToken: () => 'tok' }));
vi.mock('../../task-updater.js', () => ({ blockTask: vi.fn(), unblockTask: vi.fn() }));
vi.mock('../../projection/commands.js', () => ({ recordProjectionCommand: vi.fn() }));
const ID = '15f42776-8d1b-430d-b27a-38a480b93151';
const PAGE = '11111111-2222-3333-4444-555555555555';
const AUTHOR = '352c40c2-ba63-81aa-8019-002781f97d73';
const text = (value) => [{ plain_text: value }];
const block = (value, extra = {}) => ({ type: 'paragraph', paragraph: { rich_text: text(value) }, ...extra });
function setup(o = {}) {
  const source = { title: '抖音采集', remark: '', body: '设备：未知' };
  const candidate = { id: ID, task_type: 'qiumi_task', status: 'blocked', blocked_reason: 'device_unresolved',
    payload: { notion_zh_page_id: PAGE, qiumi_source: source, qiumi_route: { stale: true }, run_id: 'stale',
      headed_manual: true, next_run_at: '2030-10-04T09:00:00Z', scheduled_start: '2030-10-03T09:00:00Z',
      routing_receipt_id: 'preserved', custom: 'preserved' }, ...o.candidate };
  const page = { id: PAGE, last_edited_time: '2026-10-01T00:00:00Z', last_edited_by: { object: 'user', id: AUTHOR, type: 'person' }, properties: {
    '名称': { title: text(o.title ?? source.title) }, '备注': { rich_text: text(o.remark ?? '') },
    '状态': { status: { name: o.status ?? '进行中' } },
    'OpenClaw任务号': { rich_text: text(o.marker ?? `brain:${ID}`) },
  }, ...o.page };
  let reads = 0; let userReads = 0;
  const notionReq = vi.fn(async (_token, path, method) => {
    if (method === 'POST') return { results: [] };
    if (path.startsWith('/pages/')) { reads += 1; if (o.pageError) throw new Error('Notion unavailable');
      return reads > 1 && o.secondPage ? o.secondPage : page; }
    if (path.startsWith('/users/')) {
      userReads += 1;
      if (o.userError) throw new Error('author identity unavailable');
      if (o.userPending) return new Promise(() => {});
      if (userReads > 1 && o.secondUser) return o.secondUser;
      return o.user === undefined ? { object: 'user', id: AUTHOR, type: 'person' } : o.user;
    }
    if (o.blockError && path.includes('start_cursor')) throw new Error('partial failure');
    if (path.includes('/nested/')) return { results: [block(o.nested)] };
    if (o.malformed) return { results: [], has_more: true };
    if (o.cycle) return { results: [], has_more: true, next_cursor: 'same' };
    if (path.includes('start_cursor')) return { results: [block(o.body ?? '手机：验收小黄')] };
    return { results: [block('正文前段', { id: 'nested', has_children: !!o.nested })], has_more: true, next_cursor: 'page-2' };
  });
  const phones = o.phones ?? [{ serial: 'test-serial', nickname: '验收小黄', aliases: [], enabled: true,
    douyin_accounts: [{ nickname: '验收小彩', account_id: 'test-account' }] }];
  const execute = async (sql) => {
    if (/SELECT.*FROM tasks/s.test(sql)) return { rows: [candidate] };
    if (/FROM phone_registry/.test(sql)) return { rows: phones };
    if (/SELECT/.test(sql)) return { rows: [] };
    if (/UPDATE tasks/.test(sql)) return { rows: o.casLost ? [] : [{ id: ID }] };
    if (/INSERT INTO task_events/.test(sql) && o.eventError) throw new Error('event insertion failed');
    return { rows: [] };
  };
  const query = vi.fn(execute);
  const client = { query: vi.fn(execute), release: vi.fn() };
  const connect = vi.fn(async () => client);
  return { candidate, page, notionReq, query, client, connect };
}
async function run(o) {
  const { applyOwnerStops, parseZhPage } = await import('../../notion-gtd-sync.js');
  const f = setup(o);
  const result = o?.direct
    ? await rerouteUnresolvedDevices({ query: f.query, connect: f.connect }, 'tok', { notionReq: f.notionReq, parsePage: parseZhPage })
    : await applyOwnerStops({ query: f.query, connect: f.connect }, 'tok', { notionReq: f.notionReq });
  return { ...f, result, updates: [...f.query.mock.calls, ...f.client.query.mock.calls].filter(([sql]) => /UPDATE tasks/.test(sql)),
    events: [...f.query.mock.calls, ...f.client.query.mock.calls].filter(([sql]) => /INSERT INTO task_events/.test(sql)) };
}
describe('qiumi-device-reroute 原Notion页设备补写自动恢复原task', () => {
  it('独立helper与同步入口共享同一台账解析', async () => { expect((await run({ direct: true })).result.rerouted).toBe(1); });
  it.each(['进行中', '委派', '受阻', '排队中'])('%s完整读分页嵌套后恢复原task', async (status) => {
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
    expect(JSON.parse(events[0][1][2])).toMatchObject({ author_id: AUTHOR,
      before: { qiumi_source: { title: '抖音采集', remark: '', body: '设备：未知' } },
      after: { qiumi_source: JSON.parse(args[2]) } });
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
  it.each(['淘汰', '阻塞', '暂停', '完成', '失败', '已完成', '推迟'])('页状态%s不恢复', async (status) => {
    const { result, updates } = await run({ status }); expect(result.rerouted).toBe(0); expect(updates).toHaveLength(0);
  });
  it.each([{ marker: `brain:${ID} extra` }, { marker: 'brain:other' }, { page: { id: 'copy' } },
    { page: { last_edited_by: { type: 'bot' } } }, { page: { archived: true } }, { page: { in_trash: true } }, { candidate: { task_type: 'data' } },
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
  it.each([{ malformed: true }, { cycle: true }, { pageError: true }, { blockError: true, title: '手机：验收小黄' }, { secondPage: { id: PAGE, last_edited_time: 'changed' } }])(
    'Notion失败或读取期间改页 %#', async (o) => {
      const { result, updates } = await run(o); expect(result.rerouted).toBe(0); expect(updates).toHaveLength(0);
    });

  it('正文超过默认20k仍读到末尾账号，不能截断后误选', async () => {
    const o = { body: '文字'.repeat(12000) + '\n手机：验收小黄' };
    const { result, updates } = await run(o);
    expect(result.rerouted).toBe(1); expect(JSON.parse(updates[0][1][2]).body).toContain('手机：验收小黄');
  });
  it('事件失败不能计已恢复，必须独立client回滚且释放', async () => {
    const { result, query, client, connect } = await run({ eventError: true });
    expect(result.rerouted).toBe(0); expect(connect).toHaveBeenCalledOnce();
    expect(client.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT');
    expect(query.mock.calls.map(([sql]) => sql)).not.toContain('BEGIN');
    expect(client.release).toHaveBeenCalledOnce();
  });
  it('CAS零行不能记事件或成功', async () => {
    const { result, updates, events } = await run({ casLost: true });
    expect(result.rerouted).toBe(0); expect(updates).toHaveLength(1); expect(events).toHaveLength(0);
  });
});

describe('Notion partial user 作者身份必须确认后才恢复', () => {
  const partial = { object: 'user', id: AUTHOR };
  it('真实页面只有object/id，users确认bot后保留原退回且不写事件', async () => {
    const f = await run({ page: { last_edited_by: partial }, user: { ...partial, type: 'bot' } });
    expect(f.result.rerouted).toBe(0); expect(f.updates).toHaveLength(0); expect(f.events).toHaveLength(0);
    expect(f.notionReq).toHaveBeenCalledWith('tok', `/users/${AUTHOR}`, 'GET');
  });
  it('partial person经真实users协议确认可恢复，第二次页读再次确认作者', async () => {
    const f = await run({ page: { last_edited_by: partial } });
    expect(f.result.rerouted).toBe(1); expect(f.events).toHaveLength(1);
    expect(f.notionReq.mock.calls.filter(([, path]) => path.startsWith('/users/'))).toEqual([
      ['tok', `/users/${AUTHOR}`, 'GET'], ['tok', `/users/${AUTHOR}`, 'GET'],
    ]);
  });
  it.each([null, {}, partial, { ...partial, type: 'unknown' },
    { ...partial, type: 'person', id: PAGE }, { ...partial, type: 'person', object: 'error' },
  ])('用户响应缺失/未知/错ID或错误对象保留 %#', async (user) => {
    const f = await run({ page: { last_edited_by: partial }, user });
    expect(f.result.rerouted).toBe(0); expect(f.updates).toHaveLength(0); expect(f.events).toHaveLength(0);
  });
  it('身份查询失败保留原状态，不把未确认的作者当作人', async () => {
    const f = await run({ page: { last_edited_by: partial }, userError: true });
    expect(f.result.rerouted).toBe(0); expect(f.updates).toHaveLength(0);
  });
  it.each([undefined, { object: 'user' }, { object: 'user', id: '../pages/other' },
    { object: 'user', id: 'not-a-uuid', type: 'person' }, { ...partial, type: 'unknown' },
  ])('作者缺失/ID无效/类型未知直接保持 %#', async (last_edited_by) => {
    const f = await run({ page: { last_edited_by } });
    expect(f.result.rerouted).toBe(0); expect(f.updates).toHaveLength(0);
    expect(f.notionReq.mock.calls.some(([, path]) => path.startsWith('/users/'))).toBe(false);
  });
  it('显式bot不请求users、不恢复', async () => {
    const f = await run({ page: { last_edited_by: { ...partial, type: 'bot' } } });
    expect(f.result.rerouted).toBe(0);
    expect(f.notionReq.mock.calls.some(([, path]) => path.startsWith('/users/'))).toBe(false);
  });
  it('同一作者第二次确认变为bot，不沿用前一次person结果', async () => {
    const f = await run({ page: { last_edited_by: partial }, secondUser: { ...partial, type: 'bot' } });
    expect(f.result.rerouted).toBe(0); expect(f.updates).toHaveLength(0); expect(f.events).toHaveLength(0);
  });
  it('时间和属性未变但人类作者变化，不能把首次作者记作本次编辑者', async () => {
    const page = setup().page;
    const f = await run({ secondPage: { ...page, last_edited_by: { ...page.last_edited_by, id: PAGE } } });
    expect(f.result.rerouted).toBe(0); expect(f.updates).toHaveLength(0); expect(f.events).toHaveLength(0);
  });
  it('二读作者UUID只变化连字符格式时仍是同一人', async () => {
    const page = setup().page;
    const f = await run({ secondPage: { ...page,
      last_edited_by: { ...page.last_edited_by, id: AUTHOR.replace(/-/g, '') } } });
    expect(f.result.rerouted).toBe(1); expect(f.events).toHaveLength(1);
  });
  it('UUID无连字符与响应规范UUID属于同一作者', async () => {
    const id = AUTHOR.replace(/-/g, '');
    const f = await run({ page: { last_edited_by: { ...partial, id } } });
    expect(f.result.rerouted).toBe(1);
    expect(f.notionReq).toHaveBeenCalledWith('tok', `/users/${id}`, 'GET');
  });
  it('身份请求不响应也有硬期限，保持退回', async () => {
    vi.useFakeTimers();
    try {
      const pending = run({ page: { last_edited_by: partial }, userPending: true });
      await vi.advanceTimersByTimeAsync(30000);
      const f = await pending;
      expect(f.result.rerouted).toBe(0); expect(f.updates).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
});
