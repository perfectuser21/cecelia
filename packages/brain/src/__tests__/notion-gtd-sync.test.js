import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNotionReq = vi.fn();
vi.mock('../recurring-notion-sync.js', () => ({ notionReq: mockNotionReq, getToken: () => 'tok' }));

const zhPage = (over = {}) => ({
  id: '11111111-2222-3333-4444-555555555555',
  created_time: '2026-09-23T00:10:00.000Z',
  last_edited_time: '2026-09-23T00:11:00.000Z',
  properties: {
    '名称': { title: [{ plain_text: '用 Claude Code 把首页按钮改蓝' }] },
    '备注': { rich_text: [{ plain_text: 'opc_department=dev' }] },
    '状态': { status: { name: '委派' } },
    'OpenClaw任务号': { rich_text: [] },
    '优先级': { select: { name: '高' } },
    '预期完成日期': { date: { start: '2026-09-24T09:00:00.000+08:00' } },
    '执行通道': { select: null },
    '执行 Agent / Workflow': { relation: [{ id: 'wf-1' }] },
    '使用 Skill': { relation: [] },
    'AI 业务任务': { relation: [] },
    '负责人': { people: [{ id: 'u-1' }] },
    '归档': { checkbox: false },
    '创建时间': { created_time: '2026-09-23T00:10:00.000Z' },
    ...over,
  },
});
const enPage = (over = {}) => ({
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  last_edited_time: '2026-09-23T00:12:00.000Z',
  properties: {
    Name: { title: [{ plain_text: '[P1] 英文原生任务' }] },
    Description: { rich_text: [{ plain_text: '' }] },
    Status: { status: { name: 'Delegated' } },
    'Plan Date': { date: null },
    ...over,
  },
});

describe('notion-gtd-sync 解析', () => {
  it('parseZhPage 提取全部原始信息（优先级映射、relation id、归属）', async () => {
    const { parseZhPage } = await import('../notion-gtd-sync.js');
    const z = parseZhPage(zhPage());
    expect(z).toMatchObject({
      id32: '11111111222233334444555555555555', title: '用 Claude Code 把首页按钮改蓝',
      remark: 'opc_department=dev', status: '委派', taskNo: '', priorityRaw: '高', priority: 'P1',
      dueAt: '2026-09-24T09:00:00.000+08:00', channel: null, agentWorkflowIds: ['wf-1'],
      skillIds: [], businessTaskIds: [], ownerIds: ['u-1'], archived: false,
    });
  });
  it('parseEnPage 识别 [zh:]/[en-native]/brain: 标记', async () => {
    const { parseEnPage } = await import('../notion-gtd-sync.js');
    const e = parseEnPage(enPage({ Description: { rich_text: [{ plain_text: '[zh:11111111222233334444555555555555] opc_department=dev · brain:15f42776-8d1b-430d-b27a-38a480b93151' }] } }));
    expect(e.zhId32).toBe('11111111222233334444555555555555');
    expect(e.brainTaskId).toBe('15f42776-8d1b-430d-b27a-38a480b93151');
    expect(e.enNative).toBe(false);
    expect(parseEnPage(enPage({ Description: { rich_text: [{ plain_text: 'x [en-native]' }] } })).enNative).toBe(true);
  });
  it('buildEnPageFromZh：Name 带 [Pn]、Description 以 [zh:<id32>] 开头、Plan Date 带日期', async () => {
    const { parseZhPage, buildEnPageFromZh, EN_TASKS_DB } = await import('../notion-gtd-sync.js');
    const body = buildEnPageFromZh(parseZhPage(zhPage()), '正文第一行\n正文第二行');
    expect(body.parent).toEqual({ database_id: EN_TASKS_DB });
    expect(body.properties.Name.title[0].text.content).toBe('[P1] 用 Claude Code 把首页按钮改蓝');
    expect(body.properties.Description.rich_text[0].text.content.startsWith('[zh:11111111222233334444555555555555] ')).toBe(true);
    expect(body.properties.Status.status.name).toBe('Delegated');
    expect(body.properties['Plan Date'].date.start).toBe('2026-09-24T09:00:00.000+08:00');
  });
});

describe('syncZhToEn', () => {
  beforeEach(() => mockNotionReq.mockReset());
  it('委派+任务号空 → 建英文行并写回 en:<id32> 占位；任务号非空/归档/早于 since 的行跳过', async () => {
    const { syncZhToEn } = await import('../notion-gtd-sync.js');
    mockNotionReq
      .mockResolvedValueOnce({ results: [
        zhPage(),
        zhPage({ 'OpenClaw任务号': { rich_text: [{ plain_text: 'dept-x' }] } }),
        zhPage({ '归档': { checkbox: true } }),
      ] })                                            // query zh
      .mockResolvedValueOnce({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }) // POST en page
      .mockResolvedValueOnce({});                     // PATCH zh 占位
    const r = await syncZhToEn({ query: vi.fn() }, 'tok', {
      notionReq: mockNotionReq, fetchPageContent: async () => '正文', now: () => new Date('2026-09-23T00:20:00Z'),
      sinceIso: '2026-09-23T00:00:00.000Z',
    });
    expect(r).toEqual({ created: 1, skipped: 2 });
    const queryBody = mockNotionReq.mock.calls[0][3];
    expect(queryBody.filter.and).toEqual(expect.arrayContaining([
      { property: '状态', status: { equals: '委派' } },
      { property: 'OpenClaw任务号', rich_text: { is_empty: true } },
      { property: '归档', checkbox: { equals: false } },
      { timestamp: 'created_time', created_time: { on_or_after: '2026-09-23T00:00:00.000Z' } },
    ]));
    const post = mockNotionReq.mock.calls[1];
    expect(post[1]).toBe('/pages'); expect(post[2]).toBe('POST');
    const patch = mockNotionReq.mock.calls[2];
    expect(patch[1]).toBe('/pages/11111111-2222-3333-4444-555555555555');
    expect(patch[3].properties['OpenClaw任务号'].rich_text[0].text.content).toBe('en:aaaaaaaabbbbccccddddeeeeeeeeeeee');
    expect(patch[3].properties['状态']).toBeUndefined(); // 状态只能由入账/回写改，建行不改
  });
  it('绝不查询/写入人工专属状态（变异守卫）', async () => {
    const { ZH_QUERY_FILTER } = await import('../notion-gtd-sync.js');
    expect(JSON.stringify(ZH_QUERY_FILTER)).not.toMatch(/收集|下一个行动|阻塞|淘汰/);
  });
});

describe('syncEnToZh（反向回填）', () => {
  beforeEach(() => mockNotionReq.mockReset());
  it('英文原生 Delegated 行 → 建中文行（备注 [en:<id32>]、状态委派、任务号 en:占位）+ 英文行追加 [en-native]', async () => {
    const { syncEnToZh } = await import('../notion-gtd-sync.js');
    mockNotionReq
      .mockResolvedValueOnce({ results: [
        enPage(),
        enPage({ Description: { rich_text: [{ plain_text: '[zh:11111111222233334444555555555555]' }] } }),
        enPage({ Description: { rich_text: [{ plain_text: 'y [en-native]' }] } }),
      ] })
      .mockResolvedValueOnce({ id: '99999999-8888-7777-6666-555555555555' }) // POST zh
      .mockResolvedValueOnce({});                                              // PATCH en
    const r = await syncEnToZh({ query: vi.fn() }, 'tok', { notionReq: mockNotionReq, fetchPageContent: async () => '', now: () => new Date() });
    expect(r).toEqual({ created: 1, skipped: 2 });
    const post = mockNotionReq.mock.calls[1][3];
    expect(post.properties['名称'].title[0].text.content).toBe('英文原生任务');
    expect(post.properties['备注'].rich_text[0].text.content.startsWith('[en:aaaaaaaabbbbccccddddeeeeeeeeeeee]')).toBe(true);
    expect(post.properties['状态'].status.name).toBe('委派');
    expect(post.properties['OpenClaw任务号'].rich_text[0].text.content).toBe('en:aaaaaaaabbbbccccddddeeeeeeeeeeee');
    const patch = mockNotionReq.mock.calls[2][3];
    expect(patch.properties.Description.rich_text[0].text.content).toMatch(/\[en-native\]$/);
  });
});
