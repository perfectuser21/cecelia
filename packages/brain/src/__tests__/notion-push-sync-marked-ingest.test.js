import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockNotionReq = vi.fn();
const mockCreateRoutedTask = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../recurring-notion-sync.js', () => ({ notionReq: mockNotionReq, getToken: () => 'tok' }));
vi.mock('../work-routing-store.js', () => ({ createRoutedTask: mockCreateRoutedTask }));

const ZH32 = '11111111222233334444555555555555';
const enPage = (desc) => ({
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', last_edited_time: '2026-09-23T00:12:00.000Z',
  properties: {
    Name: { title: [{ plain_text: '[P1] 用 Claude Code 把首页按钮改蓝' }] },
    Description: { rich_text: [{ plain_text: desc }] },
    Status: { status: { name: 'Delegated' } },
    'Plan Date': { date: { start: '2026-09-24T09:00:00.000+08:00' } },
  },
});
const zhPage = {
  id: '11111111-2222-3333-4444-555555555555', created_time: '2026-09-23T00:10:00.000Z',
  properties: {
    '名称': { title: [{ plain_text: '用 Claude Code 把首页按钮改蓝' }] },
    '备注': { rich_text: [{ plain_text: 'opc_department=dev' }] },
    '状态': { status: { name: '委派' } },
    'OpenClaw任务号': { rich_text: [{ plain_text: 'en:aaaaaaaabbbbccccddddeeeeeeeeeeee' }] },
    '优先级': { select: { name: '高' } },
    '预期完成日期': { date: { start: '2026-09-24T09:00:00.000+08:00' } },
    '执行通道': { select: null },
    '执行 Agent / Workflow': { relation: [{ id: 'wf-1' }] }, '使用 Skill': { relation: [] }, 'AI 业务任务': { relation: [] },
    '负责人': { people: [{ id: 'u-1' }] }, '归档': { checkbox: false },
  },
};

describe('ingestDelegatedPage：[zh:] 标记行 → qiumi_task', () => {
  beforeEach(() => { mockQuery.mockReset(); mockNotionReq.mockReset(); mockCreateRoutedTask.mockReset(); });

  it('createRoutedTask 参数：qiumi_task/none/operations/manual/openclaw-agent/queued，payload 带页id与完整原始信息，不写 notion_id', async () => {
    mockNotionReq
      .mockResolvedValueOnce({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: '正文' }] } }] }) // en 正文
      .mockResolvedValueOnce(zhPage)   // GET zh page
      .mockResolvedValueOnce({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: '中文正文' }] } }] }) // zh 正文
      .mockResolvedValue({});          // PATCH zh / PATCH en
    mockCreateRoutedTask.mockResolvedValue({ task: { id: '15f42776-8d1b-430d-b27a-38a480b93151' } });
    mockQuery.mockResolvedValue({ rows: [] });
    const { ingestDelegatedPage } = await import('../notion-push-sync.js');
    const r = await ingestDelegatedPage({ query: mockQuery }, 'tok', enPage(`[zh:${ZH32}] opc_department=dev`), {
      env: { NOTION_TENANT_MAP: JSON.stringify({ 'c69c40c2-ba63-8271-badf-01c5410d8929': 'yueshengyun' }) },
    });
    expect(r).toEqual({ taskId: '15f42776-8d1b-430d-b27a-38a480b93151', kind: 'qiumi_task' });
    const req = mockCreateRoutedTask.mock.calls[0][1];
    expect(req).toMatchObject({
      source: 'inbox', source_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      requested_task_type: 'qiumi_task', mutation_intent: 'none', declared_domain: 'operations',
      task: { priority: 'P1', status: 'queued', trigger_source: 'manual', executor_kind: 'openclaw-agent' },
    });
    expect(req.metadata).toMatchObject({
      source: 'notion_gtd', origin: 'zh',
      notion_page_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      notion_zh_page_id: '11111111-2222-3333-4444-555555555555',
      dedup_by_notion_page: 'true', // 458 去重豁免键（字符串 'true'，INSERT 即带）
      tenant_id: 'yueshengyun', headed_manual: true,
      qiumi_source: {
        title: '用 Claude Code 把首页按钮改蓝', remark: 'opc_department=dev', body: '中文正文',
        priority_raw: '高', due_at: '2026-09-24T09:00:00.000+08:00', channel: null,
        agent_workflow_ids: ['wf-1'], skill_ids: [], business_task_ids: [], owner_ids: ['u-1'],
      },
    });
    expect(req).not.toHaveProperty('repo_hint');
    expect(req).not.toHaveProperty('declared_change_kind');
    // due_at 落库；绝不 UPDATE notion_id
    const sqls = mockQuery.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => /UPDATE tasks SET due_at/.test(s))).toBe(true);
    expect(sqls.some((s) => /notion_id\s*=/.test(s))).toBe(false);
    // 中文页：任务号 brain:<id> + 状态进行中；英文页：Description 追加 brain:
    const zhPatch = mockNotionReq.mock.calls.find((c) => c[1] === '/pages/11111111-2222-3333-4444-555555555555' && c[2] === 'PATCH')[3];
    expect(zhPatch.properties['OpenClaw任务号'].rich_text[0].text.content).toBe('brain:15f42776-8d1b-430d-b27a-38a480b93151');
    expect(zhPatch.properties['状态'].status.name).toBe('进行中');
    const enPatch = mockNotionReq.mock.calls.find((c) => c[1] === '/pages/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' && c[2] === 'PATCH')[3];
    expect(enPatch.properties.Description.rich_text[0].text.content).toMatch(/brain:15f42776-8d1b-430d-b27a-38a480b93151 ✓已接管$/);
  });

  it('[en-native] 行 → origin=en，中文页 id 从中文表按 [en:<id32>] 反查', async () => {
    mockNotionReq
      .mockResolvedValueOnce({ results: [] })  // en 正文
      .mockResolvedValueOnce({ results: [zhPage] }) // 中文表 query by 备注 contains [en:]
      .mockResolvedValue({});
    mockCreateRoutedTask.mockResolvedValue({ task: { id: 'b7efdbff-0ab0-46f3-8009-64c8cb9898d6' } });
    mockQuery.mockResolvedValue({ rows: [] });
    const { ingestDelegatedPage } = await import('../notion-push-sync.js');
    const r = await ingestDelegatedPage({ query: mockQuery }, 'tok', enPage('英文原生 [en-native]'), { env: {} });
    expect(r.kind).toBe('qiumi_task');
    expect(mockCreateRoutedTask.mock.calls[0][1].metadata).toMatchObject({ origin: 'en', tenant_id: 'default' });
  });

  it('已带 brain: 的行幂等跳过；非标记行仍走原 dev 分支（零行为变化）', async () => {
    const { ingestDelegatedPage } = await import('../notion-push-sync.js');
    expect(await ingestDelegatedPage({ query: mockQuery }, 'tok', enPage(`[zh:${ZH32}] · brain:15f42776-8d1b-430d-b27a-38a480b93151 ✓已接管`), { env: {} }))
      .toEqual({ taskId: null, kind: 'skipped' });
    mockNotionReq.mockResolvedValueOnce({ results: [] }).mockResolvedValue({});
    mockCreateRoutedTask.mockResolvedValue({ task: { id: 'dddddddd-1111-2222-3333-444444444444' } });
    mockQuery.mockResolvedValue({ rows: [] });
    const r = await ingestDelegatedPage({ query: mockQuery }, 'tok', enPage('普通排单'), { env: {} });
    expect(r.kind).toBe('dev');
    expect(mockCreateRoutedTask.mock.calls[0][1]).toMatchObject({ requested_task_type: 'dev', repo_hint: 'cecelia', mutation_intent: 'write' });
    expect(mockCreateRoutedTask.mock.calls[0][1].metadata).not.toHaveProperty('dedup_by_notion_page'); // 存量路径不得进豁免
    expect(mockQuery.mock.calls.some((c) => /status='blocked'/.test(c[0]))).toBe(true); // 原分支落 blocked 不变
  });

  it('pullMarkedNotionTasks 只查带标记的 Delegated 行', async () => {
    mockNotionReq.mockResolvedValueOnce({ results: [] }).mockResolvedValueOnce({ results: [] });
    const { pullMarkedNotionTasks } = await import('../notion-push-sync.js');
    const r = await pullMarkedNotionTasks({ query: mockQuery }, 'tok', { env: {} });
    expect(r).toEqual({ ingested: 0, skipped: 0 });
    const body = mockNotionReq.mock.calls[0][3];
    expect(body.filter.and).toEqual(expect.arrayContaining([{ property: 'Status', status: { equals: 'Delegated' } }]));
    expect(JSON.stringify(body.filter)).toMatch(/\[zh:|\[en-native\]/);
  });
});

describe('注册表：qiumi_task 此刀进 VALID_TASK_TYPES', () => {
  it('VALID_TASK_TYPES 含 qiumi_task', async () => {
    const R = await import('../lib/task-type-registry.js');
    expect(R.VALID_TASK_TYPES).toContain('qiumi_task');
  });
});
