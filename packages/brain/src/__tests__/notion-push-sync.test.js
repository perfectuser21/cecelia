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

describe('legacy Notion push scheduler', () => {
  it('默认不创建旧 Workspace 写入定时器，只有显式 true 才启用', async () => {
    const module = await import('../legacy-notion-push-scheduler.js');
    expect(module.scheduleLegacyNotionPush).toBeTypeOf('function');
    const pool = { query: mockQuery };
    const setIntervalFn = vi.fn(() => ({ unref: vi.fn() }));
    const run = vi.fn().mockResolvedValue(undefined);

    const disabled = module.scheduleLegacyNotionPush(pool, {
      env: {}, setIntervalFn, run, logger: { log: vi.fn(), warn: vi.fn() },
    });
    expect(disabled).toEqual({ enabled: false, timer: null });
    expect(setIntervalFn).not.toHaveBeenCalled();

    const enabled = module.scheduleLegacyNotionPush(pool, {
      env: { NOTION_LEGACY_PUSH_ENABLED: 'true' },
      setIntervalFn,
      run,
      logger: { log: vi.fn(), warn: vi.fn() },
    });
    expect(enabled.enabled).toBe(true);
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    const scheduled = setIntervalFn.mock.calls[0][0];
    await scheduled();
    expect(run).toHaveBeenCalledWith(pool);
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
