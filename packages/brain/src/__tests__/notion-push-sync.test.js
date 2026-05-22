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
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    mockNotionReq.mockRejectedValueOnce(new Error('Notion timeout'));
    mockQuery.mockResolvedValueOnce({ rows: [] }); // notion_sync_log INSERT

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await expect(runNotionPushSync({ query: mockQuery })).resolves.not.toThrow();

    const updateCall = mockQuery.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE journeys') && c[0].includes('notion_synced_at')
    );
    expect(updateCall).toBeUndefined();
  });
});
