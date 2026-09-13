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
