import { describe, it, expect, vi, beforeEach } from 'vitest';

const JOURNEY_DB  = '358c40c2-ba63-8148-bde7-e313d789931a';
const FEATURE_DB  = '358c40c2-ba63-81e3-96c5-d762b3d34dff';
const ISSUES_DB   = 'a17c40c2-ba63-82fb-9888-8152cefe29ec';

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
