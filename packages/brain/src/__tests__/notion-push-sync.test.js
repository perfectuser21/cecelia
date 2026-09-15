import { describe, it, expect, vi, beforeEach } from 'vitest';

const JOURNEY_DB  = '358c40c2-ba63-8148-bde7-e313d789931a';
const FEATURE_DB  = '358c40c2-ba63-81e3-96c5-d762b3d34dff';
const ISSUES_DB   = 'a17c40c2-ba63-82fb-9888-8152cefe29ec';

const FEATURE_SCHEMA_WITH_PROGRESS = {
  properties: { 'Advancement Progress': { type: 'rich_text' } },
};

const mockQuery    = vi.fn();
const mockNotionReq = vi.fn();

vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../recurring-notion-sync.js', () => ({
  notionReq: mockNotionReq,
  getToken: () => 'fake-token',
}));
const mockCreateRoutedTask = vi.fn();
vi.mock('../work-routing-store.js', () => ({
  createRoutedTask: mockCreateRoutedTask,
}));

describe('runNotionPushSync', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockNotionReq.mockReset();
  });

  it('无待同步行时不调 Notion API', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });

    expect(mockNotionReq).not.toHaveBeenCalled();
  });

  it('有待同步 journey 时调 Notion API 创建页面并更新 notion_synced_at', async () => {
    const journey = {
      id: 'j-uuid',
      name: 'Test Journey',
      journey_type: 'dev_pipeline',
      description: null,
      maturity: 'not_started',
      status: 'active',
      e2e_test_path: null,
      area_notion_id: null,
    };

    mockQuery.mockResolvedValueOnce({ rows: [journey] }); // journeys NULL
    mockQuery.mockResolvedValueOnce({ rows: [] });         // features NULL
    mockQuery.mockResolvedValueOnce({ rows: [] });         // issues NULL
    mockQuery.mockResolvedValueOnce({ rows: [] });         // tasks NULL (2026-09-13 pushTasks 挂链新增档位)
    mockQuery.mockResolvedValue({ rows: [] });             // skill_registry / journey_steps / journey_step_links (new)

    mockNotionReq.mockResolvedValueOnce({ id: 'notion-page-id-1' });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE journeys

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });

    expect(mockNotionReq).toHaveBeenCalledTimes(1);
    expect(mockNotionReq.mock.calls[0][1]).toBe('/pages');
    expect(mockNotionReq.mock.calls[0][2]).toBe('POST');
    expect(mockNotionReq.mock.calls[0][3].parent.database_id).toBe(JOURNEY_DB);

    const updateCall = mockQuery.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE journeys'));
    expect(updateCall).toBeTruthy();
    expect(updateCall[1]).toContain('notion-page-id-1');
  });

  it('Notion API 失败时跳过该行（notion_synced_at 保持 NULL）', async () => {
    const journey = { id: 'j-uuid', name: 'X', journey_type: 'dev_pipeline', description: null, maturity: 'not_started', status: 'active', e2e_test_path: null, area_notion_id: null };
    mockQuery.mockResolvedValueOnce({ rows: [journey] });
    mockQuery.mockResolvedValue({ rows: [] }); // features / issues / skill_registry / journey_steps / journey_step_links + log INSERT

    mockNotionReq.mockRejectedValueOnce(new Error('Notion timeout'));

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await expect(runNotionPushSync({ query: mockQuery })).resolves.not.toThrow();

    const updateCall = mockQuery.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE journeys') && c[0].includes('notion_synced_at')
    );
    expect(updateCall).toBeUndefined();
  });
});

describe('runNotionPushSync — new push functions', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockNotionReq.mockReset();
    // default: no unsync'd rows
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('calls pushSkillRegistry — queries skill_registry WHERE notion_synced_at IS NULL', async () => {
    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });
    const calls = mockQuery.mock.calls.map(c => c[0]);
    const skillQuery = calls.find(q => q && q.includes('skill_registry') && q.includes('notion_synced_at IS NULL'));
    expect(skillQuery).toBeTruthy();
  });

  it('calls pushJourneySteps — queries journey_steps WHERE notion_synced_at IS NULL', async () => {
    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });
    const calls = mockQuery.mock.calls.map(c => c[0]);
    const stepsQuery = calls.find(q => q && q.includes('journey_steps') && q.includes('notion_synced_at IS NULL'));
    expect(stepsQuery).toBeTruthy();
  });

  it('calls pushJourneyStepLinks — queries journey_step_links WHERE notion_synced_at IS NULL', async () => {
    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });
    const calls = mockQuery.mock.calls.map(c => c[0]);
    const linksQuery = calls.find(q => q && q.includes('journey_step_links') && q.includes('notion_synced_at IS NULL'));
    expect(linksQuery).toBeTruthy();
  });

  it('pushJourneyStepLinks SELECT 排除格子行（cell_kind IS NULL）— migration 347/348 后 seed 的 ~120 个格子行不能被当作待推送连接行', async () => {
    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });
    const calls = mockQuery.mock.calls.map(c => c[0]);
    const linksQuery = calls.find(q => q && q.includes('journey_step_links') && q.includes('notion_synced_at IS NULL'));
    expect(linksQuery).toBeTruthy();
    expect(linksQuery).toContain('cell_kind IS NULL');
  });

  it('pushes skill to Notion skill_registry DB when notion_synced_at is null', async () => {
    const mockSkill = {
      id: 'skill-1', name: '/dev', description: 'dev skill',
      status: 'active', location: null, notion_id: null,
    };
    mockNotionReq.mockResolvedValue({ id: 'notion-page-1' });
    mockQuery
      .mockResolvedValueOnce({ rows: [] })            // journeys select
      .mockResolvedValueOnce({ rows: [] })            // features select
      .mockResolvedValueOnce({ rows: [] })            // issues select
      .mockResolvedValueOnce({ rows: [] })            // tasks select (pushTasks 档位)
      .mockResolvedValueOnce({ rows: [mockSkill] })   // skill_registry select
      .mockResolvedValue({ rows: [] });               // journey_steps / journey_step_links + UPDATE

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });

    expect(mockNotionReq).toHaveBeenCalledWith(
      'fake-token', '/pages', 'POST',
      expect.objectContaining({
        parent: { database_id: '353c40c2-ba63-81bf-ae3e-f0e6fa3753d7' },
        properties: expect.objectContaining({
          Name: expect.any(Object),
        }),
      })
    );
  });
});

describe('runNotionPushSync — step_link Order 属性降级回归 [ARTIFACT R4]', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockNotionReq.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('step_link Order 降级：schema 无 Order 时 properties 不含 Order', async () => {
    const stepLink = {
      id: 'sl-regr-1', journey_name: 'R4 J', step_name: 'R4 S',
      step_order: 2, status: 'active',
      journey_notion_id: 'j-notion-r4', step_notion_id: 's-notion-r4',
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [] })          // journeys
      .mockResolvedValueOnce({ rows: [] })          // features
      .mockResolvedValueOnce({ rows: [] })          // issues
      .mockResolvedValueOnce({ rows: [] })          // tasks (pushTasks 档位)
      .mockResolvedValueOnce({ rows: [] })          // skill_registry
      .mockResolvedValueOnce({ rows: [] })          // journey_steps
      .mockResolvedValueOnce({ rows: [stepLink] }) // journey_step_links → 1 行
      .mockResolvedValue({ rows: [] });             // decisions / initiative_contracts / UPDATE

    mockNotionReq
      .mockResolvedValueOnce({ properties: { Name: { type: 'title' }, Status: { type: 'select' } } }) // schema GET（无 Order）
      .mockResolvedValue({ id: 'sl-notion-r4' }); // pages POST

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });

    const createCall = mockNotionReq.mock.calls.find(c => c[2] === 'POST' && c[1] === '/pages');
    expect(createCall).toBeDefined();
    // Order 不在 schema → properties 中不含 Order
    expect(createCall[3].properties).not.toHaveProperty('Order');
    // Name 应存在
    expect(createCall[3].properties).toHaveProperty('Name');
  });
});

describe('runNotionPushSync — feature Status 属性类型回归', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockNotionReq.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('feature 推送 Status 用 status 类型而非 select（Notion Feature 库要求 status 类型，发 select 会 400）', async () => {
    const feature = {
      id: 'f-regr-1', name: 'X feature', kind: 'feature', status: 'done',
      thickness: null, journey_notion_id: null, area_notion_id: null, unit_test_path: null,
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] })        // journeys
      .mockResolvedValueOnce({ rows: [feature] }) // features → 1 行
      .mockResolvedValue({ rows: [] });           // 其余 + UPDATE

    mockNotionReq.mockResolvedValue({ id: 'f-notion-1' }); // pages POST

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });

    const createCall = mockNotionReq.mock.calls.find(c => c[2] === 'POST' && c[1] === '/pages');
    expect(createCall).toBeDefined();
    const props = createCall[3].properties;
    // Status 必须是 status 类型（{ status: { name } }），不能是 select（否则 Notion 400）
    expect(props.Status).toHaveProperty('status');
    expect(props.Status).not.toHaveProperty('select');
    expect(props.Status.status.name).toBe('done');
    // Kind 映射为首字母大写，匹配 Notion select 选项 Ability/Feature
    expect(props.Kind.select.name).toBe('Feature');
  });

  it('feature kind=ability 映射为 Ability', async () => {
    const feature = {
      id: 'f-regr-2', name: 'Y ability', kind: 'ability', status: 'planned',
      thickness: null, journey_notion_id: null, area_notion_id: null, unit_test_path: null,
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [feature] })
      .mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValue({ id: 'f-notion-2' });

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });

    const createCall = mockNotionReq.mock.calls.find(c => c[2] === 'POST' && c[1] === '/pages');
    expect(createCall[3].properties.Kind.select.name).toBe('Ability');
  });
});

describe('runNotionPushSync — pushAdvancementItems', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockNotionReq.mockReset();
  });

  it('advancement_items 有未同步聚合且 Feature 库有 Advancement Progress 属性 → PATCH ability 页面并标记已同步', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // journeys
    mockQuery.mockResolvedValueOnce({ rows: [] }); // features
    mockQuery.mockResolvedValueOnce({ rows: [] }); // issues
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tasks (pushTasks 档位)
    mockQuery.mockResolvedValueOnce({ rows: [] }); // skill_registry
    mockQuery.mockResolvedValueOnce({ rows: [] }); // journey_steps
    mockQuery.mockResolvedValueOnce({ rows: [] }); // journey_step_links
    mockQuery.mockResolvedValueOnce({ rows: [] }); // decisions
    mockQuery.mockResolvedValueOnce({ rows: [] }); // initiative_contracts
    // pushAdvancementItems 内部第一条 query：按 ability 聚合未同步推进项
    mockQuery.mockResolvedValueOnce({
      rows: [{ ability_id: 'ab-1', ability_notion_id: 'notion-ab-1', done: '2', doing: '1', todo: '1' }],
    });
    mockNotionReq.mockResolvedValueOnce(FEATURE_SCHEMA_WITH_PROGRESS); // GET database schema
    mockNotionReq.mockResolvedValueOnce({}); // PATCH page
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE advancement_items
    mockQuery.mockResolvedValueOnce({ rows: [] }); // pushOpsAgents: getOpsNotionDbs（无配置，静默跳过）
    mockQuery.mockResolvedValueOnce({ rows: [] }); // pushOpsSchedules: getOpsNotionDbs（无配置，静默跳过）

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });

    const patchCall = mockNotionReq.mock.calls.find(c => c[2] === 'PATCH');
    expect(patchCall).toBeTruthy();
    expect(patchCall[1]).toBe('/pages/notion-ab-1');
    expect(patchCall[3].properties['Advancement Progress'].rich_text[0].text.content).toContain('2/4');

    const updateCall = mockQuery.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE advancement_items')
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall[1]).toContain('ab-1');

    // 聚合必须覆盖该 ability 全量推进项（累积进度），不能只统计未同步子集——
    // 否则一轮只新增 1 个 todo 就会把之前已推的正确进度覆盖成错误的子集进度
    const selectCall = mockQuery.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('FROM advancement_items ai')
    );
    expect(selectCall).toBeTruthy();
    expect(selectCall[0]).not.toMatch(/WHERE ai\.notion_synced_at IS NULL AND/);
    expect(selectCall[0]).toMatch(/ai\.ability_id IN \(\s*SELECT ability_id FROM advancement_items WHERE notion_synced_at IS NULL\s*\)/);
  });

  it('Feature 库无 Advancement Progress 属性 → 跳过 PATCH 但仍标记已同步（避免死循环重试）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tasks (pushTasks 档位)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ ability_id: 'ab-2', ability_notion_id: 'notion-ab-2', done: '0', doing: '0', todo: '1' }],
    });
    mockNotionReq.mockResolvedValueOnce({ properties: {} }); // GET schema，无目标属性
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE advancement_items
    mockQuery.mockResolvedValueOnce({ rows: [] }); // pushOpsAgents: getOpsNotionDbs（无配置，静默跳过）
    mockQuery.mockResolvedValueOnce({ rows: [] }); // pushOpsSchedules: getOpsNotionDbs（无配置，静默跳过）

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });

    const patchCall = mockNotionReq.mock.calls.find(c => c[2] === 'PATCH');
    expect(patchCall).toBeUndefined();
    const updateCall = mockQuery.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE advancement_items')
    );
    expect(updateCall).toBeTruthy();
  });
});

// 2026-09-13 回归锁：SUB_AREA_NOTION_IDS 曾整表 404（页面不存在的死 ID 烙在代码里），
// 每条 brain/engine issue 推送 404 → 被静默标已同步（notion_id 空）= 无声丢弃两天。
// 真 ID 实查自 Sub Area 库 300c40c2-ba63-82d5-9ec1-81990d181950；此处锁死当前取值，
// 防止死 ID 回归（网络探活无法进 CI，用取值锁 + 部署后 push 日志作运行时验证）。
describe('SUB_AREA_NOTION_IDS 死 ID 回归锁', () => {
  const REAL_PAGES = {
    cecelia: '7e7c40c2-ba63-839d-b0bc-017f1cc7d49d',
    zenithjoy: 'cf5c40c2-ba63-82c8-a00a-015c593f6268',
    dashboard: 'a17c40c2-ba63-83e2-b922-8197b09af030',
  };
  const DEAD_IDS = [
    '5c0c40c2-ba63-8184-bc3d-f1c5e48caee4',
    '64bc40c2-ba63-81b0-a7e2-c2f7bb3b2e31',
    '7e7c40c2-ba63-8117-8d5d-e3e18a3c6b04',
    '8acc40c2-ba63-810b-8e07-c5c3d34d8e13',
    'cf5c40c2-ba63-8182-9b3e-f2d1a4e5c6f0',
    'a17c40c2-ba63-83e2-9c3d-b4e2f1a5c7d8',
  ];

  it('映射只允许指向实查存在的页面，死 ID 一个不许出现', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      new URL('../notion-push-sync.js', import.meta.url),
      'utf8',
    );
    for (const dead of DEAD_IDS) {
      expect(src.includes(dead), `死 ID ${dead} 不得回归`).toBe(false);
    }
    for (const real of Object.values(REAL_PAGES)) {
      expect(src.includes(real), `真页面 ${real} 必须在映射中`).toBe(true);
    }
    // notion-create-issue.js 的 sub-area 枚举全部要有映射（否则该区 issue 无 Sub Area 关系）
    for (const key of ['brain', 'engine', 'dashboard', 'zenithjoy', 'multi-agent']) {
      expect(src).toMatch(new RegExp(`['"]?${key}['"]?:\\s*'[0-9a-f-]{36}'`));
    }
  });
});

// ── 2026-09-13 Tasks 推送（Notion 任务编排双向·push 半边）──────────────
// Notion Tasks 库 d5bc40c2 早已存在（Status/Plan Date/Area 字段齐）但 Brain 从未接线。
// 设计要点：
//  1. 只推「活任务(queued/in_progress/blocked) + 近7天终态」，历史不进驾驶舱
//  2. 幂等指纹 notion_props.pushed_status：tasks.updated_at 被 tick 定时 touch
//     （memory brain-status-drift），不能当增量判据；status 没变就不重推
//  3. 13483 条历史 notion_id 是旧时代遗产指向别处——仅当 notion_props 带本系统
//     指纹才允许 PATCH，否则一律 create 新页并覆盖（防打错对象）
describe('pushTasks — Brain tasks → Notion Tasks 库', () => {
  const TASKS_DB = 'd5bc40c2-ba63-82ef-965a-8153b7ad81a0';

  beforeEach(() => {
    mockQuery.mockReset();
    mockNotionReq.mockReset();
  });

  function drainOthers() {
    // runNotionPushSync 里 pushTasks 之前/之后的其他 push 全部空转
    mockQuery.mockResolvedValue({ rows: [] });
  }

  it('活任务无本系统指纹 → 即使有历史 notion_id 也 create 新页（禁 PATCH 旧对象）', async () => {
    const task = {
      id: 't-uuid-1', title: '修复 X', status: 'queued', priority: 'P1',
      task_type: 'dev', notion_id: 'legacy-old-page-id', notion_props: null,
    };
    drainOthers();
    const mod = await import('../notion-push-sync.js');
    mockNotionReq.mockResolvedValue({ id: 'new-task-page-1' });
    await mod.pushTasksForTest({ query: mockQuery }, 'fake-token', [task]);
    const create = mockNotionReq.mock.calls.find((c) => c[1] === '/pages' && c[2] === 'POST');
    expect(create).toBeTruthy();
    expect(create[3].parent.database_id).toBe(TASKS_DB);
    expect(create[3].properties.Status.status.name).toBe('Delegated'); // queued→Delegated
    expect(create[3].properties.Name.title[0].text.content).toContain('[P1]');
    const patched = mockNotionReq.mock.calls.find((c) => String(c[1]).includes('legacy-old-page-id'));
    expect(patched).toBeUndefined();
  });

  it('带本系统指纹且 status 变化 → PATCH 更新既有页', async () => {
    const task = {
      id: 't-uuid-2', title: '跑批', status: 'completed', priority: 'P2',
      task_type: 'dev', notion_id: 'our-page-2',
      notion_props: { pushed_status: 'in_progress' },
    };
    const mod = await import('../notion-push-sync.js');
    mockNotionReq.mockResolvedValue({ id: 'our-page-2' });
    await mod.pushTasksForTest({ query: mockQuery }, 'fake-token', [task]);
    const patch = mockNotionReq.mock.calls.find((c) => c[1] === '/pages/our-page-2' && c[2] === 'PATCH');
    expect(patch).toBeTruthy();
    expect(patch[3].properties.Status.status.name).toBe('Done'); // completed→Done
  });

  it('status 映射全表：blocked→Planned / failed→Cancelled / in_progress→In Progress', async () => {
    const mod = await import('../notion-push-sync.js');
    expect(mod.TASK_STATUS_TO_NOTION.blocked).toBe('Planned');
    expect(mod.TASK_STATUS_TO_NOTION.failed).toBe('Cancelled');
    expect(mod.TASK_STATUS_TO_NOTION.in_progress).toBe('In Progress');
    expect(mod.TASK_STATUS_TO_NOTION.queued).toBe('Delegated');
    expect(mod.TASK_STATUS_TO_NOTION.completed).toBe('Done');
  });

  it('推送成功后写回幂等指纹（notion_props.pushed_status=当前 status）', async () => {
    const task = {
      id: 't-uuid-3', title: 'Y', status: 'queued', priority: 'P2',
      task_type: 'dev', notion_id: null, notion_props: null,
    };
    const mod = await import('../notion-push-sync.js');
    mockNotionReq.mockResolvedValue({ id: 'new-3' });
    await mod.pushTasksForTest({ query: mockQuery }, 'fake-token', [task]);
    const upd = mockQuery.mock.calls.find((c) => /UPDATE tasks/.test(c[0]) && /notion_props/.test(c[0]));
    expect(upd).toBeTruthy();
    expect(upd[1]).toContain('t-uuid-3');
  });
});

// ── 2026-09-14 Tasks 拉取（双向·pull 半边）────────────────────────────
// 主理人在 Notion Tasks 库新建行并把 Status 拖到 Delegated → Brain 接手：
// 在 tasks 表建任务并把 `brain:<id> ✓已接管` 回执写进该页 Description。
// 纪律：
//  1. 只认 Status=Delegated 且 Description 不含 brain: 标记的页（幂等，防重复接手）
//  2. 接手任务先落 status='blocked'（error_message 注明等待执行路由）——map 扫描器
//     未迁 us-vps 前 kernel 准入不通，直接 queued 会被 tick 抓去撞墙三连 autoblock；
//     notion_props.pushed_status 同步写入=当前 status，防 pushTasks 反手改用户的 Delegated
//  3. Name 前缀 [P0-3] 解析为 priority，缺省 P2
describe('pullNotionTasks — Notion Delegated → Brain 接手', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockNotionReq.mockReset();
    mockCreateRoutedTask.mockReset();
  });

  function notionPage({ id, name, desc = '' }) {
    return {
      id,
      properties: {
        Name: { type: 'title', title: [{ plain_text: name, text: { content: name } }] },
        Description: { type: 'rich_text', rich_text: desc ? [{ plain_text: desc, text: { content: desc } }] : [] },
        Status: { type: 'status', status: { name: 'Delegated' } },
      },
    };
  }

  it('Delegated 无 brain 标记 → INSERT 任务(blocked) + PATCH 回执进 Description', async () => {
    const mod = await import('../notion-push-sync.js');
    mockNotionReq.mockImplementation(async (token, path, method) => {
      if (String(path).includes('/query')) {
        return { results: [notionPage({ id: 'np-1', name: '[P1] 测试：给我修个东西' })] };
      }
      return {};
    });
    mockQuery.mockResolvedValue({ rows: [] });
    mockCreateRoutedTask.mockResolvedValue({ task: { id: 'new-task-uuid-1' } });

    await mod.pullNotionTasksForTest({ query: mockQuery }, 'fake-token');

    // 建任务必须走原子路由账房（task-creation-inventory 守卫）
    expect(mockCreateRoutedTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source_id: 'np-1',
        title: '测试：给我修个东西', // 去掉 [P1] 前缀
        task: expect.objectContaining({ priority: 'P1' }),
      }),
    );
    // 接手后落 blocked 等执行路由
    const upd = mockQuery.mock.calls.find((c) => /UPDATE tasks SET status='blocked'/.test(c[0]));
    expect(upd).toBeTruthy();
    expect(upd[1]).toContain('new-task-uuid-1');
    const patch = mockNotionReq.mock.calls.find((c) => c[1] === '/pages/np-1' && c[2] === 'PATCH');
    expect(patch).toBeTruthy();
    const descText = JSON.stringify(patch[3]);
    expect(descText).toContain('brain:new-task-uuid-1');
  });

  it('Description 已含 brain: 标记 → 幂等跳过（不重复建任务）', async () => {
    const mod = await import('../notion-push-sync.js');
    mockNotionReq.mockImplementation(async (token, path) => {
      if (String(path).includes('/query')) {
        return { results: [notionPage({ id: 'np-2', name: '旧单', desc: 'brain:existing-id ✓已接管' })] };
      }
      return {};
    });
    await mod.pullNotionTasksForTest({ query: mockQuery }, 'fake-token');
    expect(mockCreateRoutedTask).not.toHaveBeenCalled();
  });

  it('无前缀标题 → priority 缺省 P2，标题原样', async () => {
    const mod = await import('../notion-push-sync.js');
    mockNotionReq.mockImplementation(async (token, path) => {
      if (String(path).includes('/query')) {
        return { results: [notionPage({ id: 'np-3', name: '随手排的活' })] };
      }
      return {};
    });
    mockQuery.mockResolvedValue({ rows: [] });
    mockCreateRoutedTask.mockResolvedValue({ task: { id: 'new-task-uuid-3' } });
    await mod.pullNotionTasksForTest({ query: mockQuery }, 'fake-token');
    expect(mockCreateRoutedTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: '随手排的活',
        task: expect.objectContaining({ priority: 'P2' }),
      }),
    );
  });

  it('排单必须带齐 work-router 硬校验参数（实吃首单 c90a6ce4 逐个踩出）', async () => {
    // ①source 枚举无 notion_tasks_db → inbox ②mutation_intent 必填
    // ③repo_hint 缺失即 repo_unknown ④blocked 落库须带 blocked_at（chk 约束）
    const mod = await import('../notion-push-sync.js');
    mockNotionReq.mockImplementation(async (token, path) => {
      if (String(path).includes('/query')) {
        return { results: [notionPage({ id: 'np-4', name: '参数完备单' })] };
      }
      return {};
    });
    mockQuery.mockResolvedValue({ rows: [] });
    mockCreateRoutedTask.mockResolvedValue({ task: { id: 'new-task-uuid-4' } });
    await mod.pullNotionTasksForTest({ query: mockQuery }, 'fake-token');
    expect(mockCreateRoutedTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: 'inbox',
        mutation_intent: 'write',
        repo_hint: 'cecelia',
      }),
    );
    const upd = mockQuery.mock.calls.find((c) => /UPDATE tasks SET status='blocked'/.test(c[0]));
    expect(upd[0]).toMatch(/blocked_at=NOW\(\)/);
  });
});

// ── 2026-09-14 排单分流 OpenClaw（relation 数据驱动版）─────────────────
// Notion Tasks relation「Workflow」「Agent」指向运行舱四表的真实 Notion 行；
// pull 反查 ops_workflows/ops_agents.notion_id（归一去杠）取 dispatch 人工列
// （webhook_url / template），注入 run_id 后 POST webhook；缺配置写 ⚠ 回执。
// run_id 内嵌完整 page id（去横杠 32 位）供终态同步反解页面。
describe('pullNotionTasks — Workflow relation 分流 OpenClaw', () => {
  const WF_NOTION = 'aaaa40c2-ba63-8001-9001-000000000001';
  const AGENT_NOTION = 'bbbb40c2-ba63-8002-9002-000000000002';

  beforeEach(() => {
    mockQuery.mockReset();
    mockNotionReq.mockReset();
    mockCreateRoutedTask.mockReset();
    vi.unstubAllGlobals();
  });

  function relationPage({ withAgent = true } = {}) {
    return {
      id: '3dbc40c2-ba63-8093-92bf-dc952f9a1079',
      properties: {
        Name: { type: 'title', title: [{ plain_text: '今天跑一轮获客', text: { content: '今天跑一轮获客' } }] },
        Description: { type: 'rich_text', rich_text: [] },
        Status: { type: 'status', status: { name: 'Delegated' } },
        Workflow: { type: 'relation', relation: [{ id: WF_NOTION }] },
        Agent: { type: 'relation', relation: withAgent ? [{ id: AGENT_NOTION }] : [] },
      },
    };
  }

  /** mockQuery 按 SQL 分流：ops_workflows/ops_agents 反查返回 dispatch 行 */
  function stubOpsLookup({ wfRow, agentRow } = {}) {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM ops_workflows/.test(sql)) return { rows: wfRow ? [wfRow] : [] };
      if (/FROM ops_agents/.test(sql)) return { rows: agentRow ? [agentRow] : [] };
      return { rows: [] };
    });
  }

  it('选 Workflow+Agent relation → 反查 ops 两表 dispatch，POST webhook 注入 run_id，不建编码任务', async () => {
    const mod = await import('../notion-push-sync.js');
    const fetchCalls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      fetchCalls.push([url, JSON.parse(init.body)]);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
    stubOpsLookup({
      wfRow: { wf_id: 'AwrSocialLeadgenV4', name: 'Social Leadgen V4', dispatch: { webhook_url: 'https://hk.example:8444/webhook/agentic-workflow-runner-v4/run' } },
      agentRow: { name: 'affine-yuesheng', dispatch: { template: 'yueshengyun-daily.json' } },
    });
    const readCalls = [];
    mockNotionReq.mockImplementation(async (t, path) => (
      String(path).includes('/query') ? { results: [relationPage()] } : {}
    ));
    await mod.pullNotionTasksForTest({ query: mockQuery }, 'fake-token', {
      env: { OPENCLAW_DISPATCH_DIR: '/nonexistent-for-test' },
      readTemplateFn: (dir, file) => {
        readCalls.push(file);
        return { mode: 'daily', tenant_id: 'yueshengyun', control_token: 'ct', task_request: { task_name: 'x' } };
      },
    });
    // 走 workflow_run 账而非编码路线（2026-09-14 决策 2dbabb48 后建账是预期行为）
    const routed = mockCreateRoutedTask.mock.calls.map((c) => c[1]);
    expect(routed.every((r) => r.requested_task_type === 'workflow_run')).toBe(true);
    expect(routed.some((r) => r.requested_task_type === 'dev')).toBe(false);
    expect(readCalls).toEqual(['yueshengyun-daily.json']); // 模板来自 agent.dispatch（数据行，非代码枚举）
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0][0]).toContain('agentic-workflow-runner-v4/run'); // 入口来自 workflow.dispatch.webhook_url
    const body = fetchCalls[0][1];
    expect(body.tenant_id).toBe('yueshengyun');
    expect(body.attempt_id).toBe('a1');
    expect(body.run_id).toMatch(/^notion-3dbc40c2ba63809392bfdc952f9a1079-\d+$/); // 内嵌 pageid32
    const patch = mockNotionReq.mock.calls.find((c) => c[2] === 'PATCH');
    const pj = JSON.stringify(patch[3]);
    expect(pj).toContain('已派发');
    expect(pj).toContain('Social Leadgen V4·affine-yuesheng'); // 回执标签=真实行名
    expect(pj).toContain('In Progress');
  });

  it('所选 Workflow 不在 ops_workflows 账上 → ⚠ 回执不派发，不建编码任务', async () => {
    const mod = await import('../notion-push-sync.js');
    vi.stubGlobal('fetch', vi.fn());
    stubOpsLookup({}); // 反查空
    mockNotionReq.mockImplementation(async (t, path) => (
      String(path).includes('/query') ? { results: [relationPage({ withAgent: false })] } : {}
    ));
    await mod.pullNotionTasksForTest({ query: mockQuery }, 'fake-token', {
      env: {}, readTemplateFn: () => ({}),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockCreateRoutedTask).not.toHaveBeenCalled();
    const patch = mockNotionReq.mock.calls.find((c) => c[2] === 'PATCH');
    expect(JSON.stringify(patch[3])).toContain('workflow_not_in_ops');
  });

  it('Agent 未选且 workflow 无 default_template → ⚠ 回执提示配置缺口', async () => {
    const mod = await import('../notion-push-sync.js');
    vi.stubGlobal('fetch', vi.fn());
    stubOpsLookup({
      wfRow: { wf_id: 'AwrSocialLeadgenV4', name: 'Social Leadgen V4', dispatch: { webhook_url: 'https://x/run' } },
    });
    mockNotionReq.mockImplementation(async (t, path) => (
      String(path).includes('/query') ? { results: [relationPage({ withAgent: false })] } : {}
    ));
    await mod.pullNotionTasksForTest({ query: mockQuery }, 'fake-token', {
      env: {}, readTemplateFn: () => ({}),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const patch = mockNotionReq.mock.calls.find((c) => c[2] === 'PATCH');
    expect(JSON.stringify(patch[3])).toContain('no_template');
  });

  it('Description 已含派发标记 run:notion- → 幂等跳过', async () => {
    const mod = await import('../notion-push-sync.js');
    const page = relationPage();
    page.properties.Description.rich_text = [{ plain_text: '▶ 已派发 run:notion-abc-1', text: { content: 'x' } }];
    vi.stubGlobal('fetch', vi.fn());
    stubOpsLookup({ wfRow: { wf_id: 'X', name: 'X', dispatch: {} } });
    mockNotionReq.mockImplementation(async (t, path) => (
      String(path).includes('/query') ? { results: [page] } : {}
    ));
    await mod.pullNotionTasksForTest({ query: mockQuery }, 'fake-token', {
      env: { N8N_V4_WEBHOOK_URL: 'https://x/run' },
      readTemplateFn: () => ({}),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('syncOpenClawRuns 的 SQL 只用 ops_runs 真实列（stopped_at，不存在 finished_at）', async () => {
    // 2026-09-14 生产实证：finished_at 列不存在 → 查询次次抛错被 catch，终态同步腿从未生效
    const mod = await import('../notion-push-sync.js');
    const sqls = [];
    mockQuery.mockImplementation(async (sql) => { sqls.push(String(sql)); return { rows: [] }; });
    await mod.syncOpenClawRunsForTest({ query: mockQuery }, 'fake-token');
    const runsSql = sqls.find((q) => /FROM ops_runs/.test(q));
    expect(runsSql).toBeTruthy();
    expect(runsSql).not.toContain('finished_at');
    expect(runsSql).toContain('stopped_at');
  });

  it('ssh 直派通道：dispatch.channel=ssh → ssh 目标机 nohup 执行，不 POST webhook，入账带 machine', async () => {
    // 决策 2026-09-15：任务默认自动填机器直接下派——直驾线（cron+adb 脚本）接进排单
    const mod = await import('../notion-push-sync.js');
    vi.stubGlobal('fetch', vi.fn());
    stubOpsLookup({
      wfRow: { wf_id: 'JinoHarvestDirect', name: '金诺采收·直驾', dispatch: {
        channel: 'ssh', machine: 'xian-mac-m4',
        command: 'zsh ~/bin-harvest/batch-harvest.sh jinoshengyuan-work ~/words.txt rvX',
      } },
    });
    mockCreateRoutedTask.mockResolvedValue({ task: { id: 'wf-task-ssh' } });
    const execCalls = [];
    mockNotionReq.mockImplementation(async (t, path) => (
      String(path).includes('/query') ? { results: [relationPage({ withAgent: false })] } : {}
    ));
    await mod.pullNotionTasksForTest({ query: mockQuery }, 'fake-token', {
      env: {}, readTemplateFn: () => ({}),
      execFn: (args) => { execCalls.push(Array.isArray(args) ? args.join(' ') : args); return 'DISPATCHED'; },
    });
    expect(globalThis.fetch).not.toHaveBeenCalled(); // 不走 webhook
    expect(execCalls.length).toBe(1);
    const cmd = execCalls[0];
    expect(cmd).toContain('jinnuoshengyuan@100.86.57.69'); // machine-registry 路由出目标
    expect(cmd).toContain('nohup');
    expect(cmd).toContain('batch-harvest.sh');
    expect(cmd).toMatch(/brain-runs\/notion-[0-9a-f]+-\d+\.exit/); // exit 回执文件
    const req = mockCreateRoutedTask.mock.calls[0][1];
    expect(req.requested_task_type).toBe('workflow_run');
    expect(req.metadata.channel).toBe('ssh');
    expect(req.metadata.machine).toBe('xian-mac-m4');
    const patch = mockNotionReq.mock.calls.find((c) => c[2] === 'PATCH');
    const pj = JSON.stringify(patch[3]);
    expect(pj).toContain('已派发');
    expect(pj).toContain('In Progress');
  });

  it('ssh 直派缺 command → ⚠ 回执提示配置缺口，不执行', async () => {
    const mod = await import('../notion-push-sync.js');
    vi.stubGlobal('fetch', vi.fn());
    stubOpsLookup({ wfRow: { wf_id: 'X', name: 'X', dispatch: { channel: 'ssh', machine: 'xian-mac-m4' } } });
    const execCalls = [];
    mockNotionReq.mockImplementation(async (t, path) => (
      String(path).includes('/query') ? { results: [relationPage({ withAgent: false })] } : {}
    ));
    await mod.pullNotionTasksForTest({ query: mockQuery }, 'fake-token', {
      env: {}, readTemplateFn: () => ({}), execFn: (args) => { execCalls.push(args); return ''; },
    });
    expect(execCalls.length).toBe(0);
    expect(mockCreateRoutedTask).not.toHaveBeenCalled();
    const patch = mockNotionReq.mock.calls.find((c) => c[2] === 'PATCH');
    expect(JSON.stringify(patch[3])).toContain('no_command');
  });

  it('ssh 直派收割：exit=0 → task completed + Notion Done；exit=1 → failed + Cancelled', async () => {
    const mod = await import('../notion-push-sync.js');
    const sqls = [];
    const pageOk = '3dbc40c2ba63809392bfdc952f9a1079';
    const pageBad = '3dbc40c2ba63809392bfdc952f9a1080';
    mockQuery.mockImplementation(async (sql, params) => {
      sqls.push({ sql: String(sql), params });
      if (/payload->>'channel' = 'ssh'/.test(sql) && /SELECT/.test(sql)) {
        return { rows: [
          { id: 't-ok', run_id: `notion-${pageOk}-1`, machine: 'xian-mac-m4', notion_page_id: '3dbc40c2-ba63-8093-92bf-dc952f9a1079', created_at: new Date().toISOString() },
          { id: 't-bad', run_id: `notion-${pageBad}-1`, machine: 'xian-mac-m4', notion_page_id: '3dbc40c2-ba63-8093-92bf-dc952f9a1080', created_at: new Date().toISOString() },
        ] };
      }
      return { rows: [] };
    });
    const execFn = (args) => {
      const cmd = args.join(' ');
      if (cmd.includes(pageOk)) return '0\n';
      if (cmd.includes(pageBad)) return '1\n';
      return '';
    };
    await mod.reapSshWorkflowRunsForTest({ query: mockQuery }, 'fake-token', { execFn });
    const updOk = sqls.find((q) => /UPDATE tasks/.test(q.sql) && q.params?.includes('t-ok'));
    expect(updOk.params).toContain('completed');
    const updBad = sqls.find((q) => /UPDATE tasks/.test(q.sql) && q.params?.includes('t-bad'));
    expect(updBad.params).toContain('failed');
    const patches = mockNotionReq.mock.calls.filter((c) => c[2] === 'PATCH');
    expect(JSON.stringify(patches.find((c) => c[1].includes('1079'))[3])).toContain('Done');
    expect(JSON.stringify(patches.find((c) => c[1].includes('1080'))[3])).toContain('Cancelled');
  });

  it('ssh 直派收割：无 exit 文件未超时不动；超 6 小时判 failed(timeout)', async () => {
    const mod = await import('../notion-push-sync.js');
    const sqls = [];
    mockQuery.mockImplementation(async (sql, params) => {
      sqls.push({ sql: String(sql), params });
      if (/payload->>'channel' = 'ssh'/.test(sql) && /SELECT/.test(sql)) {
        return { rows: [
          { id: 't-young', run_id: 'notion-aaaa-1', machine: 'xian-mac-m4', notion_page_id: null, created_at: new Date().toISOString() },
          { id: 't-stale', run_id: 'notion-bbbb-1', machine: 'xian-mac-m4', notion_page_id: null, created_at: new Date(Date.now() - 7 * 3600_000).toISOString() },
        ] };
      }
      return { rows: [] };
    });
    await mod.reapSshWorkflowRunsForTest({ query: mockQuery }, 'fake-token', { execFn: () => 'NO_EXIT' });
    expect(sqls.some((q) => /UPDATE tasks/.test(q.sql) && q.params?.includes('t-young'))).toBe(false);
    const stale = sqls.find((q) => /UPDATE tasks/.test(q.sql) && q.params?.includes('t-stale'));
    expect(stale.params).toContain('failed');
  });

  it('派发成功即入 tasks 账：workflow_run task（operations 路线，payload 含 run_id/wf_id）', async () => {
    // 一切执行进 tasks 账（决策 2dbabb48）：OpenClaw run 不再绕账
    const mod = await import('../notion-push-sync.js');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
    stubOpsLookup({
      wfRow: { wf_id: 'AwrSocialLeadgenV4', name: 'Social Leadgen V4', dispatch: { webhook_url: 'https://x/run' } },
      agentRow: { name: 'affine-yuesheng', dispatch: { template: 'yueshengyun-daily.json' } },
    });
    mockCreateRoutedTask.mockResolvedValue({ task: { id: 'wf-task-1' } });
    mockNotionReq.mockImplementation(async (t, path) => (
      String(path).includes('/query') ? { results: [relationPage()] } : {}
    ));
    await mod.pullNotionTasksForTest({ query: mockQuery }, 'fake-token', {
      env: {}, readTemplateFn: () => ({ tenant_id: 'yueshengyun' }),
    });
    expect(mockCreateRoutedTask).toHaveBeenCalledTimes(1);
    const req = mockCreateRoutedTask.mock.calls[0][1];
    expect(req.requested_task_type).toBe('workflow_run');
    expect(req.declared_domain).toBe('operations');
    expect(req.mutation_intent).not.toBe('write'); // 不得误入编码路线
    expect(req.metadata.wf_id).toBe('AwrSocialLeadgenV4');
    expect(req.metadata.run_id).toMatch(/^notion-/);
    expect(req.metadata.notion_page_id).toBe(relationPage().id);
    expect(req.task.status).toBe('in_progress'); // 派发即在跑
  });

  it('排班员v1·在途互斥：同 workflow 已有 in_progress run → 不派发、⏸ 排队回执', async () => {
    const mod = await import('../notion-push-sync.js');
    vi.stubGlobal('fetch', vi.fn());
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM ops_workflows/.test(sql)) return { rows: [{ wf_id: 'AwrSocialLeadgenV4', name: 'Social Leadgen V4', dispatch: { webhook_url: 'https://x/run' } }] };
      if (/FROM ops_agents/.test(sql)) return { rows: [{ name: 'affine-yuesheng', dispatch: { template: 'a.json' } }] };
      if (/task_type='workflow_run'/.test(sql) && /in_progress/.test(sql)) {
        return { rows: [{ id: 'busy-task', run_id: 'notion-busy-1' }] };
      }
      return { rows: [] };
    });
    mockNotionReq.mockImplementation(async (t, path) => (
      String(path).includes('/query') ? { results: [relationPage()] } : {}
    ));
    await mod.pullNotionTasksForTest({ query: mockQuery }, 'fake-token', {
      env: {}, readTemplateFn: () => ({}),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockCreateRoutedTask).not.toHaveBeenCalled();
    const patch = mockNotionReq.mock.calls.find((c) => c[2] === 'PATCH');
    expect(JSON.stringify(patch[3])).toContain('⏸ 排队');
  });

  it('⏸ 排队回执不得含 run:notion- 幂等标记（防队列死锁）', async () => {
    // 2026-09-14 生产实证死锁：回执写 run:<run_id>（notion-…）命中 pull 幂等跳过
    // 正则 /run:notion-/，排队行被当作已派发永不重试——资源释放后死等。
    const mod = await import('../notion-push-sync.js');
    vi.stubGlobal('fetch', vi.fn());
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM ops_workflows/.test(sql)) return { rows: [{ wf_id: 'AwrSocialLeadgenV4', name: 'Social Leadgen V4', dispatch: { webhook_url: 'https://x/run' } }] };
      if (/task_type='workflow_run'/.test(sql) && /in_progress/.test(sql)) {
        return { rows: [{ id: 'busy-task', run_id: 'notion-busy-1' }] };
      }
      return { rows: [] };
    });
    mockNotionReq.mockImplementation(async (t, path) => (
      String(path).includes('/query') ? { results: [relationPage({ withAgent: false })] } : {}
    ));
    await mod.pullNotionTasksForTest({ query: mockQuery }, 'fake-token', {
      env: {}, readTemplateFn: () => ({}),
    });
    const patch = mockNotionReq.mock.calls.find((c) => c[2] === 'PATCH');
    expect(JSON.stringify(patch[3])).not.toContain('run:notion-');
  });

  it('排班员v1·时间窗：Plan Date 在未来 → 不派发、🕐 排期回执', async () => {
    const mod = await import('../notion-push-sync.js');
    vi.stubGlobal('fetch', vi.fn());
    stubOpsLookup({ wfRow: { wf_id: 'X', name: 'X', dispatch: { webhook_url: 'https://x/run' } } });
    const page = relationPage();
    const future = new Date(Date.now() + 3600_000).toISOString();
    page.properties['Plan Date'] = { type: 'date', date: { start: future } };
    mockNotionReq.mockImplementation(async (t, path) => (
      String(path).includes('/query') ? { results: [page] } : {}
    ));
    await mod.pullNotionTasksForTest({ query: mockQuery }, 'fake-token', {
      env: {}, readTemplateFn: () => ({}),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const patch = mockNotionReq.mock.calls.find((c) => c[2] === 'PATCH');
    expect(JSON.stringify(patch[3])).toContain('🕐');
  });

  it('状态回执不滚雪球：desc 已含旧状态尾巴时剥离后再拼', async () => {
    const mod = await import('../notion-push-sync.js');
    vi.stubGlobal('fetch', vi.fn());
    stubOpsLookup({}); // workflow 反查空 → ⚠ 回执
    const page = relationPage({ withAgent: false });
    page.properties.Description.rich_text = [{ plain_text: '给客户跑一轮 · ⚠ 派发未成(旧错误)', text: { content: 'x' } }];
    mockNotionReq.mockImplementation(async (t, path) => (
      String(path).includes('/query') ? { results: [page] } : {}
    ));
    await mod.pullNotionTasksForTest({ query: mockQuery }, 'fake-token', {
      env: {}, readTemplateFn: () => ({}),
    });
    const patch = mockNotionReq.mock.calls.find((c) => c[2] === 'PATCH');
    const text = patch[3].properties.Description.rich_text[0].text.content;
    expect(text).toContain('给客户跑一轮');
    expect((text.match(/⚠/g) || []).length).toBe(1); // 旧 ⚠ 被剥离，不叠加
  });

  it('syncOpenClawRuns 终态回写 workflow_run task：success→completed', async () => {
    const mod = await import('../notion-push-sync.js');
    const sqls = [];
    mockQuery.mockImplementation(async (sql, params) => {
      sqls.push({ sql: String(sql), params });
      if (/FROM ops_runs/.test(sql)) {
        return { rows: [{ run_id: 'notion-3dbc40c2ba63809392bfdc952f9a1079-1757800000000', status: 'success' }] };
      }
      return { rows: [] };
    });
    await mod.syncOpenClawRunsForTest({ query: mockQuery }, 'fake-token');
    const upd = sqls.find((q) => /UPDATE tasks/.test(q.sql) && /workflow_run/.test(q.sql));
    expect(upd).toBeTruthy();
    expect(upd.params).toContain('completed');
    expect(upd.params).toContain('notion-3dbc40c2ba63809392bfdc952f9a1079-1757800000000');
  });

  it('syncOpenClawRuns：ops_runs 终态 → 反解 page id 推 Status Done', async () => {
    const mod = await import('../notion-push-sync.js');
    mockQuery.mockResolvedValueOnce({
      rows: [{ run_id: 'notion-3dbc40c2ba63809392bfdc952f9a1079-1757800000000', status: 'success' }],
    });
    mockQuery.mockResolvedValue({ rows: [] });
    await mod.syncOpenClawRunsForTest({ query: mockQuery }, 'fake-token');
    const patch = mockNotionReq.mock.calls.find((c) => c[2] === 'PATCH');
    expect(patch[1]).toBe('/pages/3dbc40c2-ba63-8093-92bf-dc952f9a1079');
    expect(JSON.stringify(patch[3])).toContain('Done');
  });
});
