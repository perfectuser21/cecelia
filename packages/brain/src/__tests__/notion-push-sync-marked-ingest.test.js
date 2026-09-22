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
    // tenant_id 必须落列，不能只躺在 payload：458 建了列，routes/看板按列过滤，恒 NULL = 租户隔离形同虚设
    const tenantCall = mockQuery.mock.calls.find((c) => /UPDATE tasks SET tenant_id/.test(c[0]));
    expect(tenantCall).toBeDefined();
    expect(tenantCall[1]).toEqual(['15f42776-8d1b-430d-b27a-38a480b93151', 'yueshengyun']);
    // 中文页：任务号 brain:<id> + 状态进行中；英文页：Description 追加 brain:
    const zhPatch = mockNotionReq.mock.calls.find((c) => c[1] === '/pages/11111111-2222-3333-4444-555555555555' && c[2] === 'PATCH')[3];
    expect(zhPatch.properties['OpenClaw任务号'].rich_text[0].text.content).toBe('brain:15f42776-8d1b-430d-b27a-38a480b93151');
    expect(zhPatch.properties['状态'].status.name).toBe('进行中');
    const enPatch = mockNotionReq.mock.calls.find((c) => c[1] === '/pages/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' && c[2] === 'PATCH')[3];
    expect(enPatch.properties.Description.rich_text[0].text.content).toMatch(/brain:15f42776-8d1b-430d-b27a-38a480b93151 ✓已接管$/);
  });

  it('QIUMI_DISPATCH_ENABLED 未开 → 入账写 headed_manual=true（第一道闸，任务落地即不被 tick 抢跑）', async () => {
    mockNotionReq
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce(zhPage)
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValue({});
    mockCreateRoutedTask.mockResolvedValue({ task: { id: 'c1c1c1c1-1111-2222-3333-444444444444' } });
    mockQuery.mockResolvedValue({ rows: [] });
    const { ingestDelegatedPage } = await import('../notion-push-sync.js');
    await ingestDelegatedPage({ query: mockQuery }, 'tok', enPage(`[zh:${ZH32}] opc_department=dev`), { env: {} });
    expect(mockCreateRoutedTask.mock.calls[0][1].metadata.headed_manual).toBe(true);
  });

  it('QIUMI_DISPATCH_ENABLED=true → 入账不再写 headed_manual=true（门放开，PR3 路由接管派发）', async () => {
    mockNotionReq
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce(zhPage)
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValue({});
    mockCreateRoutedTask.mockResolvedValue({ task: { id: 'c2c2c2c2-1111-2222-3333-444444444444' } });
    mockQuery.mockResolvedValue({ rows: [] });
    const { ingestDelegatedPage } = await import('../notion-push-sync.js');
    await ingestDelegatedPage({ query: mockQuery }, 'tok', enPage(`[zh:${ZH32}] opc_department=dev`), {
      env: { QIUMI_DISPATCH_ENABLED: 'true' },
    });
    // 写 false 与不写等价（dispatch-helpers 谓词是 COALESCE(...,'false') <> 'true'），
    // 这里钉住"落地的值不是 true"，实现选哪种都不该让任务被第一道闸拦住。
    expect(mockCreateRoutedTask.mock.calls[0][1].metadata.headed_manual).not.toBe(true);
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

  it('正文为空（Description 只剩同步标记）→ 兜底描述含标题且 ≥20 字符，不会被 pre-flight 判「太短」连吃三振', async () => {
    mockNotionReq
      .mockResolvedValueOnce({ results: [] })  // en 正文为空
      .mockResolvedValueOnce(zhPage)           // GET zh page
      .mockResolvedValueOnce({ results: [] })  // zh 正文为空
      .mockResolvedValue({});
    mockCreateRoutedTask.mockResolvedValue({ task: { id: '15f42776-8d1b-430d-b27a-38a480b93151' } });
    mockQuery.mockResolvedValue({ rows: [] });
    const { ingestDelegatedPage } = await import('../notion-push-sync.js');
    await ingestDelegatedPage({ query: mockQuery }, 'tok', enPage(`[zh:${ZH32}]`), { env: {} });
    const { description } = mockCreateRoutedTask.mock.calls[0][1];
    // pre-flight-check.js: 非系统类型 description.trim().length < 20 即 issue → 三振进 blocked
    expect(description.trim().length).toBeGreaterThanOrEqual(20);
    expect(description).toContain('用 Claude Code 把首页按钮改蓝');
    expect(description).not.toContain(`[zh:${ZH32}]`); // 同步标记不是正文
  });

  it('正文与标题都空（英文 Name 只有 [P1] 前缀、反查不到中文行）→ 兜底描述用页 id 填充，仍 ≥20 字符', async () => {
    mockNotionReq
      .mockResolvedValueOnce({ results: [] })  // en 正文为空
      .mockResolvedValueOnce({ results: [] })  // 中文表 [en:] 反查未命中 → zh=null
      .mockResolvedValue({});
    mockCreateRoutedTask.mockResolvedValue({ task: { id: 'b7efdbff-0ab0-46f3-8009-64c8cb9898d6' } });
    mockQuery.mockResolvedValue({ rows: [] });
    const { ingestDelegatedPage } = await import('../notion-push-sync.js');
    const page = enPage('[en-native]');
    page.properties.Name = { title: [{ plain_text: '[P1]' }] };
    await ingestDelegatedPage({ query: mockQuery }, 'tok', page, { env: {} });
    const { description } = mockCreateRoutedTask.mock.calls[0][1];
    expect(description.trim().length).toBeGreaterThanOrEqual(20);
    expect(description).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
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

  it('writeStatusReceipt：超长正文(8000字)回执必须保留完整 brain: 标记尾巴（不被 1900 截断吃掉），第二轮幂等跳过不再 PATCH', async () => {
    mockNotionReq
      .mockResolvedValueOnce({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: '正文' }] } }] }) // en 正文
      .mockResolvedValueOnce(zhPage)   // GET zh page
      .mockResolvedValueOnce({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: '中文正文' }] } }] }) // zh 正文
      .mockResolvedValue({});          // PATCH zh / PATCH en
    mockCreateRoutedTask.mockResolvedValue({ task: { id: '15f42776-8d1b-430d-b27a-38a480b93151' } });
    mockQuery.mockResolvedValue({ rows: [] });
    const { ingestDelegatedPage, pullMarkedNotionTasks } = await import('../notion-push-sync.js');
    const longBase = `[zh:${ZH32}] ${'A'.repeat(8000)}`;
    await ingestDelegatedPage({ query: mockQuery }, 'tok', enPage(longBase), { env: {} });
    const enPatch = mockNotionReq.mock.calls.find((c) => c[1] === '/pages/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' && c[2] === 'PATCH')[3];
    const content = enPatch.properties.Description.rich_text[0].text.content;
    expect(content.length).toBeLessThanOrEqual(1900);
    expect(content).toMatch(/brain:15f42776-8d1b-430d-b27a-38a480b93151 ✓已接管$/);

    // 第二轮：页面 Description 已是写回后的 content（含完整 brain: 标记）→ 应被幂等跳过，不再 PATCH/建任务
    mockNotionReq.mockReset();
    mockCreateRoutedTask.mockReset();
    mockNotionReq.mockResolvedValueOnce({ results: [enPage(content)] }).mockResolvedValueOnce({ results: [] });
    const r2 = await pullMarkedNotionTasks({ query: mockQuery }, 'tok', { env: {} });
    expect(r2).toEqual({ ingested: 0, skipped: 1 });
    expect(mockCreateRoutedTask).not.toHaveBeenCalled();
    expect(mockNotionReq.mock.calls.some((c) => c[2] === 'PATCH')).toBe(false);
  });
});

describe('EN_TASKS_DB 与 NOTION_TASKS_DB 同值守卫（notion-gtd-sync.js 硬编码常量，避免循环依赖，用测试钉住同值）', () => {
  it('notion-gtd-sync.EN_TASKS_DB === notion-push-sync.NOTION_TASKS_DB', async () => {
    const { NOTION_TASKS_DB } = await import('../notion-push-sync.js');
    const { EN_TASKS_DB } = await import('../notion-gtd-sync.js');
    expect(EN_TASKS_DB).toBe(NOTION_TASKS_DB);
  });
});

describe('注册表：qiumi_task 第二道闸 PR3 放开（tick 可选中，改由 dispatchQiumiTask 接管）', () => {
  it('TICK_DISPATCH_EXCLUDED 不再含 qiumi_task', async () => {
    const R = await import('../lib/task-type-registry.js');
    expect(
      R.TICK_DISPATCH_EXCLUDED,
      'qiumi_task 还在 tick 排除名单里——路由接线了也永远选不中这类任务',
    ).not.toContain('qiumi_task');
  });
});

/**
 * 双闸守卫（plan「补充一」）：第二道闸放开之后，qiumi_task 能不能被 tick 选中，
 * 只剩 `payload.headed_manual` 这一道门。这个 describe 把「门」和「读门的谓词」钉在一起：
 * 任何一头被摘掉（入账恒写 false / dispatch-helpers 不再读 headed_manual），
 * QIUMI_DISPATCH_ENABLED 就成了摆设，未放开的机器上任务会被 tick 抢跑。
 */
describe('双闸守卫：QIUMI_DISPATCH_ENABLED 未开时 qiumi_task 不可被 tick 选中', () => {
  it('门关 → 入账产物 payload.headed_manual === true', async () => {
    mockQuery.mockReset(); mockNotionReq.mockReset(); mockCreateRoutedTask.mockReset();
    mockNotionReq
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce(zhPage)
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValue({});
    mockCreateRoutedTask.mockResolvedValue({ task: { id: 'c3c3c3c3-1111-2222-3333-444444444444' } });
    mockQuery.mockResolvedValue({ rows: [] });
    const { ingestDelegatedPage } = await import('../notion-push-sync.js');
    await ingestDelegatedPage({ query: mockQuery }, 'tok', enPage(`[zh:${ZH32}] opc_department=dev`), {
      env: { QIUMI_DISPATCH_ENABLED: 'false' },
    });
    // metadata 即入库 payload（work-routing-store.createRoutedTask：payload = {...metadata, ...task.payload}）
    expect(
      mockCreateRoutedTask.mock.calls[0][1].metadata.headed_manual,
      '门没生效——未放开的机器上任务落地就是可派发的',
    ).toBe(true);
  });

  it('候选 SQL 仍带排除 headed_manual 的谓词（门的读方还在）', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'dispatch-helpers.js'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(--|\/\/|\*|\/\*)/.test(line))
      .join('\n');
    expect(
      src,
      'dispatch-helpers 的候选 SQL 不再读 payload.headed_manual——第一道闸整条失效',
    ).toMatch(/COALESCE\(t\.payload->>'headed_manual', 'false'\)\s*<>\s*'true'/);
  });
});

describe('注册表：qiumi_task 此刀进 VALID_TASK_TYPES', () => {
  it('VALID_TASK_TYPES 含 qiumi_task', async () => {
    const R = await import('../lib/task-type-registry.js');
    expect(R.VALID_TASK_TYPES).toContain('qiumi_task');
  });
});
