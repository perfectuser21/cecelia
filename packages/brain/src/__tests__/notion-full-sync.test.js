/**
 * notion-full-sync.test.js
 * 测试四表双向同步逻辑（全 mock，不调真实 Notion API 或 DB）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock fetch ───────────────────────────────────────────────
const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

// ─── Mock DB pool ─────────────────────────────────────────────
const mockQuery   = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { query: mockQuery, connect: mockConnect },
}));

// ─── Import under test ────────────────────────────────────────
import { runFullSync, pushToNotion, handleWebhook, NOTION_DB_IDS } from '../notion-full-sync.js';

// ─── 工具函数 ────────────────────────────────────────────────

function makeNotionPage(overrides = {}) {
  return {
    id: 'notion-page-id-001',
    parent: { database_id: NOTION_DB_IDS.areas.replace(/-/g, '') },
    properties: {
      Name:    { title: [{ plain_text: '测试 Area' }] },
      Domain:  { select: { name: 'Work' } },
      Archive: { checkbox: false },
    },
    ...overrides,
  };
}

function makeClientMock() {
  const client = {
    query:   vi.fn().mockResolvedValue({ rows: [{ id: 'db-uuid-001' }] }),
    release: vi.fn(),
  };
  return client;
}

function notionOkResponse(data) {
  return Promise.resolve({
    ok:     true,
    json:   () => Promise.resolve(data),
    status: 200,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTION_API_KEY = 'ntn_test_token';
});

// ─── NOTION_DB_IDS ────────────────────────────────────────────

describe('NOTION_DB_IDS', () => {
  it('包含四个正确的数据库 ID', () => {
    expect(NOTION_DB_IDS.areas).toBe('afaf229f-2b6f-49e6-b478-da8c6422de87');
    expect(NOTION_DB_IDS.goals).toBe('4d71decf-c169-46ef-b603-d4e6baa5e228');
    expect(NOTION_DB_IDS.projects).toBe('2671de58-8506-4d64-bad7-23fae2737e74');
    expect(NOTION_DB_IDS.tasks).toBe('54fe0d4c-f434-4e91-8bb0-e33967661c42');
  });
});

// ─── handleWebhook ────────────────────────────────────────────

describe('handleWebhook', () => {
  it('无 pageId 时返回 skipped', async () => {
    const result = await handleWebhook({});
    expect(result.skipped).toBe(true);
  });

  it('Area page 成功 upsert', async () => {
    const client = makeClientMock();
    mockConnect.mockResolvedValue(client);
    mockQuery.mockResolvedValue({ rows: [] }); // findDbIdByNotionId → null

    // GET /pages/:id 返回 Area page
    mockFetch.mockResolvedValueOnce(notionOkResponse(makeNotionPage({
      parent: { database_id: NOTION_DB_IDS.areas.replace(/-/g, '') },
    })));

    const mockDb = { query: mockQuery, connect: mockConnect };
    const result = await handleWebhook(
      { entity: { id: 'notion-page-id-001' } },
      mockDb
    );

    expect(result.synced).toBe(true);
    expect(result.table).toBe('area');
  });

  it('页面 404 时软删除', async () => {
    mockFetch.mockResolvedValueOnce({
      ok:     false,
      status: 404,
      json:   () => Promise.resolve({ message: 'Not found' }),
    });

    // 软删除查询返回空
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn(),
    };

    const result = await handleWebhook(
      { entity: { id: 'deleted-page-id' } },
      mockDb
    );
    expect(result.skipped).toBe(true); // areas 无 archived 对应的目标表
  });

  it('未知数据库 id 返回 skipped', async () => {
    mockFetch.mockResolvedValueOnce(notionOkResponse({
      id:     'unknown-page',
      parent: { database_id: 'unknown-db-id' },
      properties: {},
    }));

    const mockDb = { query: vi.fn(), connect: vi.fn() };
    const result = await handleWebhook({ entity: { id: 'unknown-page' } }, mockDb);
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('未知数据库');
  });
});

// ─── pushToNotion ────────────────────────────────────────────

describe('pushToNotion', () => {
  it('area 无 notion_id → 创建 Notion 页面并回写', async () => {
    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'area-db-id', name: '工作', domain: 'Work', archived: false, notion_id: null }] })
        .mockResolvedValueOnce({ rows: [] }), // UPDATE 回写
    };

    mockFetch.mockResolvedValueOnce(notionOkResponse({
      id: 'new-notion-page-id',
    }));

    const result = await pushToNotion('area', 'area-db-id', mockDb);
    expect(result.notionPageId).toBe('new-notion-page-id');
    expect(mockDb.query).toHaveBeenCalledTimes(2);
  });

  it('task 有 notion_id → PATCH 更新页面', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [{
          id: 'task-db-id', title: '测试任务', status: 'queued',
          priority: 'P1', description: null, due_at: null, archived: false,
          notion_id: 'existing-notion-id',
        }],
      }),
    };

    mockFetch.mockResolvedValueOnce(notionOkResponse({ id: 'existing-notion-id' }));

    const result = await pushToNotion('task', 'task-db-id', mockDb);
    expect(result.notionPageId).toBe('existing-notion-id');
    // PATCH 不需要回写 notion_id，所以只查询一次
    expect(mockDb.query).toHaveBeenCalledTimes(1);
  });

  it('未知表名抛出错误', async () => {
    const mockDb = { query: vi.fn() };
    await expect(pushToNotion('unknown', 'some-id', mockDb)).rejects.toThrow('未知表');
  });
});

// ─── runFullSync（轻量冒烟测试）────────────────────────────────

describe('runFullSync', () => {
  it('Notion API 错误时 stats.errors 有记录', async () => {
    // 四次 queryDB 全部失败
    mockFetch.mockRejectedValue(new Error('network error'));

    const mockDb = {
      query:   vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn(),
    };

    const stats = await runFullSync(mockDb);
    expect(stats.errors.length).toBeGreaterThan(0);
    expect(stats.errors[0]).toContain('network error');
  });
});
