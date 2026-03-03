/**
 * notion-memory-sync.test.js
 * 测试 Notion Memory 同步模块的导出和基本行为
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// mock pool
const mockPool = {
  query: vi.fn(),
};
vi.mock('../db.js', () => ({ default: mockPool }));

const {
  NOTION_MEMORY_DB_IDS,
  pushFactToNotion,
  pushMemoryToNotion,
  rebuildMemoryDatabases,
  importAllMemoryData,
} = await import('../notion-memory-sync.js');

describe('notion-memory-sync 模块导出', () => {
  it('导出 NOTION_MEMORY_DB_IDS 对象，包含 3 个 DB id', () => {
    expect(NOTION_MEMORY_DB_IDS).toMatchObject({
      ownerProfile: expect.any(String),
      contacts:     expect.any(String),
      diary:        expect.any(String),
    });
    // 确认是真实 UUID 格式
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(NOTION_MEMORY_DB_IDS.ownerProfile).toMatch(uuidRe);
    expect(NOTION_MEMORY_DB_IDS.contacts).toMatch(uuidRe);
    expect(NOTION_MEMORY_DB_IDS.diary).toMatch(uuidRe);
  });

  it('导出的函数类型正确', () => {
    expect(typeof pushFactToNotion).toBe('function');
    expect(typeof pushMemoryToNotion).toBe('function');
    expect(typeof rebuildMemoryDatabases).toBe('function');
    expect(typeof importAllMemoryData).toBe('function');
  });
});

describe('pushFactToNotion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NOTION_API_KEY;
  });

  it('无 NOTION_API_KEY 时抛错，被 catch 吞掉不影响调用', async () => {
    // 不设 NOTION_API_KEY → getToken() 抛错
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    // 不抛出，静默失败
    await expect(pushFactToNotion({ id: 1, category: 'raw', content: 'a: b', key: 'raw.a', source: 'auto' })).resolves.toBeUndefined();
  });

  it('有 NOTION_API_KEY 时，调用 Notion POST /pages（非 contact）', async () => {
    process.env.NOTION_API_KEY = 'test-key';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'page-xyz-123' }),
    });
    mockPool.query.mockResolvedValue({ rows: [] });

    await pushFactToNotion({
      id: 99,
      category: 'background',
      content: 'display_name: Alex',
      key: 'display_name',
      source: 'auto',
      created_at: new Date('2026-01-01'),
    });

    // 验证 fetch 被调用
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('api.notion.com/v1/pages');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body.parent.database_id).toBe(NOTION_MEMORY_DB_IDS.ownerProfile);
    expect(body.properties['键'].title[0].text.content).toBe('display_name');
    expect(body.properties['值'].rich_text[0].text.content).toContain('Alex');

    // 验证 notion_id 写回 DB
    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE user_profile_facts SET notion_id=$1 WHERE id=$2',
      ['page-xyz-123', 99]
    );

    delete process.env.NOTION_API_KEY;
  });

  it('category=other 时，推送到 contacts DB（人脉网络）', async () => {
    process.env.NOTION_API_KEY = 'test-key';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'contact-page-001' }),
    });
    mockPool.query.mockResolvedValue({ rows: [] });

    await pushFactToNotion({
      id: 55,
      category: 'other',
      content: '姓名: 魏嫦娥',
      key: null,
      source: 'import',
      created_at: new Date('2026-01-01'),
    });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.parent.database_id).toBe(NOTION_MEMORY_DB_IDS.contacts);
    expect(body.properties['姓名'].title[0].text.content).toBe('魏嫦娥');

    delete process.env.NOTION_API_KEY;
  });
});

describe('pushMemoryToNotion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有 NOTION_API_KEY 时，推送到 diary DB，包含 page body', async () => {
    process.env.NOTION_API_KEY = 'test-key';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'diary-page-001' }),
    });
    mockPool.query.mockResolvedValue({ rows: [] });

    const fullText = '今天 Cecelia 完成了一项重要任务：Notion Memory 同步功能上线了！';
    await pushMemoryToNotion({
      id: 200,
      source_type: 'episodic',
      content: fullText,
      importance: 8,
      created_at: new Date('2026-03-03'),
    });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.parent.database_id).toBe(NOTION_MEMORY_DB_IDS.diary);
    expect(body.properties['摘要'].title[0].text.content).toBe(fullText.slice(0, 80));
    expect(body.properties['类型'].select.name).toBe('episodic');
    expect(body.properties['重要性'].number).toBe(8);
    // 验证 page body
    expect(body.children).toHaveLength(1);
    expect(body.children[0].paragraph.rich_text[0].text.content).toContain('Notion Memory');

    // notion_id 写回 memory_stream
    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE memory_stream SET notion_id=$1 WHERE id=$2',
      ['diary-page-001', 200]
    );

    delete process.env.NOTION_API_KEY;
  });

  it('无效 source_type 降级为 episodic', async () => {
    process.env.NOTION_API_KEY = 'test-key';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'diary-page-002' }),
    });
    mockPool.query.mockResolvedValue({ rows: [] });

    await pushMemoryToNotion({
      id: 201,
      source_type: 'unknown_type',
      content: '测试',
      importance: 0,
      created_at: new Date(),
    });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.properties['类型'].select.name).toBe('episodic');

    delete process.env.NOTION_API_KEY;
  });
});
