/**
 * notion-capture-ingest 测试
 *
 * 单元测试：mock fetch + pool，不依赖真实 DB / Notion API。
 * 集成风格测试：使用真实 Notion API 响应结构的 fixture（不 mock 响应字段名/结构）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveNotionToken,
  resolveInboxDbIds,
  extractPageTitle,
  buildPageContent,
  fetchInboxPages,
  ingestPage,
  runNotionCaptureIngest,
} from '../notion-capture-ingest.js';

// ── Fixtures（真实 Notion API 响应结构，不 mock 字段名） ────────────

const NOTION_PAGE_FIXTURE = {
  id: 'aabbccdd-1234-5678-90ab-cdef01234567',
  object: 'page',
  url: 'https://www.notion.so/aabbccdd12345678',
  last_edited_time: '2026-08-05T10:00:00.000Z',
  properties: {
    title: {
      id: 'title',
      type: 'title',
      title: [
        {
          type: 'text',
          text: { content: '整理产品路线图', link: null },
          plain_text: '整理产品路线图',
          href: null,
        },
      ],
    },
  },
};

const NOTION_PAGE_FIXTURE_2 = {
  id: 'bbcc1234-aaaa-bbbb-cccc-dddd01234567',
  object: 'page',
  url: 'https://www.notion.so/bbcc1234',
  last_edited_time: '2026-08-05T11:00:00.000Z',
  properties: {
    Name: {
      id: 'Name',
      type: 'title',
      title: [{ type: 'text', plain_text: '读书笔记：《原则》', text: { content: '读书笔记：《原则》' } }],
    },
  },
};

/** 真实 Notion 数据库查询响应结构 */
function makeDbQueryResponse(pages, hasMore = false, nextCursor = null) {
  return {
    object: 'list',
    results: pages,
    next_cursor: nextCursor,
    has_more: hasMore,
    type: 'page_or_database',
    page_or_database: {},
  };
}

// ── 工具函数测试 ──────────────────────────────────────────────────

describe('extractPageTitle', () => {
  it('从 title 类型属性提取纯文本', () => {
    expect(extractPageTitle(NOTION_PAGE_FIXTURE)).toBe('整理产品路线图');
  });

  it('从 Name 属性提取纯文本', () => {
    expect(extractPageTitle(NOTION_PAGE_FIXTURE_2)).toBe('读书笔记：《原则》');
  });

  it('无 title 属性时返回空串', () => {
    const page = { id: 'xxx', properties: { Status: { type: 'select', select: { name: 'done' } } } };
    expect(extractPageTitle(page)).toBe('');
  });
});

describe('buildPageContent', () => {
  it('包含标题、最后编辑时间、URL', () => {
    const content = buildPageContent(NOTION_PAGE_FIXTURE);
    expect(content).toContain('整理产品路线图');
    expect(content).toContain('2026-08-05');
    expect(content).toContain('https://');
  });

  it('无标题时用页面 ID 兜底', () => {
    const page = { id: 'fallback-id', properties: {}, url: '', last_edited_time: '' };
    expect(buildPageContent(page)).toContain('fallback-id');
  });
});

// ── 凭据解析 ──────────────────────────────────────────────────────

describe('resolveNotionToken', () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('env 有值时直接返回', async () => {
    process.env.NOTION_API_KEY = 'secret-from-env';
    const token = await resolveNotionToken();
    expect(token).toBe('secret-from-env');
  });

  it('env 无值时从 CCAPI2026.env 文件读取', async () => {
    delete process.env.NOTION_API_KEY;
    const readFileFn = vi.fn().mockResolvedValue('export NOTION_API_KEY=file-token-123\n');
    const token = await resolveNotionToken({ readFileFn });
    expect(token).toBe('file-token-123');
  });

  it('env 和文件都无值时抛错', async () => {
    delete process.env.NOTION_API_KEY;
    const readFileFn = vi.fn().mockRejectedValue(new Error('ENOENT'));
    await expect(resolveNotionToken({ readFileFn })).rejects.toThrow('NOTION_API_KEY 未配置');
  });

  it('文件内容含注释行时正确解析', async () => {
    delete process.env.NOTION_API_KEY;
    const content = [
      '# Notion CCAPI2026 凭据',
      'NOTION_API_KEY=token-xyz',
      'OTHER_VAR=foo',
    ].join('\n');
    const readFileFn = vi.fn().mockResolvedValue(content);
    const token = await resolveNotionToken({ readFileFn });
    expect(token).toBe('token-xyz');
  });
});

// ── resolveInboxDbIds ─────────────────────────────────────────────

describe('resolveInboxDbIds', () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => { process.env = { ...OLD_ENV }; });

  it('NOTION_INBOX_DB_IDS 未配置时返回空数组', () => {
    delete process.env.NOTION_INBOX_DB_IDS;
    expect(resolveInboxDbIds()).toEqual([]);
  });

  it('逗号分隔的多个 DB ID', () => {
    process.env.NOTION_INBOX_DB_IDS = 'db1,db2, db3 ';
    expect(resolveInboxDbIds()).toEqual(['db1', 'db2', 'db3']);
  });
});

// ── fetchInboxPages ───────────────────────────────────────────────

describe('fetchInboxPages', () => {
  it('单页无分页时返回所有结果', async () => {
    const mockResponse = makeDbQueryResponse([NOTION_PAGE_FIXTURE, NOTION_PAGE_FIXTURE_2]);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    const pages = await fetchInboxPages('token', 'db-123', null, { fetchFn });
    expect(pages).toHaveLength(2);
    expect(pages[0].id).toBe(NOTION_PAGE_FIXTURE.id);
  });

  it('有游标时发送 last_edited_time filter', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeDbQueryResponse([]),
    });
    await fetchInboxPages('token', 'db-123', '2026-08-01T00:00:00.000Z', { fetchFn });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.filter).toMatchObject({
      timestamp: 'last_edited_time',
      last_edited_time: { after: '2026-08-01T00:00:00.000Z' },
    });
  });

  it('分页请求正确拼接结果（has_more=true）', async () => {
    let call = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      call++;
      const resp = call === 1
        ? makeDbQueryResponse([NOTION_PAGE_FIXTURE], true, 'cursor-abc')
        : makeDbQueryResponse([NOTION_PAGE_FIXTURE_2], false);
      return Promise.resolve({ ok: true, json: async () => resp });
    });
    const pages = await fetchInboxPages('token', 'db-123', null, { fetchFn });
    expect(pages).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    // 第二次请求带 start_cursor
    const body2 = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(body2.start_cursor).toBe('cursor-abc');
  });

  it('Notion API 返回 4xx 时抛错', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Invalid database ID' }),
    });
    await expect(fetchInboxPages('token', 'bad-db', null, { fetchFn })).rejects.toThrow('400');
  });
});

// ── ingestPage ────────────────────────────────────────────────────

describe('ingestPage', () => {
  function makePool(captureId = 'cap-uuid-1') {
    return {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: captureId }] }) // captures upsert
        .mockResolvedValueOnce({ rows: [] }),                   // capture_atoms insert
    };
  }

  it('新页面：写 captures + capture_atoms，返回 captureId', async () => {
    const pool = makePool('cap-1');
    const result = await ingestPage(pool, NOTION_PAGE_FIXTURE);
    expect(result).toBe('cap-1');
    expect(pool.query).toHaveBeenCalledTimes(2);

    // captures INSERT 含 dedupe_key + notion_page_id
    const [sql1, params1] = pool.query.mock.calls[0];
    expect(sql1).toMatch(/INSERT INTO captures/);
    expect(params1).toContain(`notion:inbox:${NOTION_PAGE_FIXTURE.id}`);
    expect(params1).toContain(NOTION_PAGE_FIXTURE.id);

    // capture_atoms INSERT 含 notion_page_id + ON CONFLICT DO NOTHING
    const [sql2, params2] = pool.query.mock.calls[1];
    expect(sql2).toMatch(/INSERT INTO capture_atoms/);
    expect(sql2).toMatch(/ON CONFLICT.*DO NOTHING/s);
    expect(params2).toContain(NOTION_PAGE_FIXTURE.id);
  });

  it('内容超 2000 字时截断', async () => {
    const longPage = {
      ...NOTION_PAGE_FIXTURE,
      properties: {
        title: {
          type: 'title',
          title: [{ plain_text: 'x'.repeat(3000), text: { content: 'x'.repeat(3000) } }],
        },
      },
    };
    const pool = makePool();
    await ingestPage(pool, longPage);
    const [, params] = pool.query.mock.calls[0];
    expect(params[0].length).toBeLessThanOrEqual(2000);
  });

  it('captures 返回空行时优雅返回 null', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await ingestPage(pool, NOTION_PAGE_FIXTURE);
    expect(result).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1); // atom INSERT 不执行
  });
});

// ── runNotionCaptureIngest ────────────────────────────────────────

describe('runNotionCaptureIngest', () => {
  function makePool({ lastRun = null } = {}) {
    return {
      query: vi.fn((sql) => {
        if (sql.includes('SELECT value_json') && sql.includes(GATE_KEY_PATTERN)) {
          // gate 检查
          return Promise.resolve({
            rows: lastRun ? [{ value_json: { ts: lastRun } }] : [],
          });
        }
        // 其他 query（working_memory upsert, cursor 读写等）
        return Promise.resolve({ rows: [{ id: 'mock-id' }] });
      }),
    };
  }

  const GATE_KEY_PATTERN = 'notion_capture_ingest:last_run';

  it('自 gate：上次运行 < 5 分钟时跳过', async () => {
    const pool = makePool({ lastRun: new Date(Date.now() - 60_000).toISOString() });
    const result = await runNotionCaptureIngest(pool, { resolveDbIds: () => ['db-1'] });
    expect(result.skipped).toBe(true);
  });

  it('NOTION_INBOX_DB_IDS 为空时跳过（无凭据错误）', async () => {
    const pool = makePool();
    const result = await runNotionCaptureIngest(pool, { resolveDbIds: () => [] });
    expect(result.skipped).toBe(true);
    expect(result.ingested).toBe(0);
  });

  it('凭据加载失败时跳过（non-fatal）', async () => {
    const pool = makePool();
    const resolveNotionTokenFn = async () => { throw new Error('ENOENT'); };
    const result = await runNotionCaptureIngest(pool, {
      resolveDbIds: () => ['db-1'],
      resolveNotionToken: resolveNotionTokenFn,
    });
    expect(result.skipped).toBe(true);
  });

  it('正常采集：ingested 计数正确', async () => {
    // 模拟完整流水：gate 未触发，DB 查询正确
    const calls = { n: 0 };
    const pool = {
      query: vi.fn((sql, params) => {
        calls.n++;
        // gate 检查（首次）→ 无数据
        if (sql.includes('SELECT value_json FROM working_memory') &&
            params?.[0] === GATE_KEY_PATTERN) {
          return Promise.resolve({ rows: [] });
        }
        // cursor 读取 → 无数据
        if (sql.includes('SELECT value_json FROM working_memory')) {
          return Promise.resolve({ rows: [] });
        }
        // INSERT / UPDATE → 返回 id
        return Promise.resolve({ rows: [{ id: `uuid-${calls.n}` }] });
      }),
    };

    const twoPageResp = makeDbQueryResponse([NOTION_PAGE_FIXTURE, NOTION_PAGE_FIXTURE_2]);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => twoPageResp,
    });

    const result = await runNotionCaptureIngest(pool, {
      resolveDbIds: () => ['test-db'],
      resolveNotionToken: async () => 'test-token',
      fetchFn,
    });

    expect(result.skipped).toBe(false);
    expect(result.dbsProcessed).toBe(1);
    expect(result.ingested).toBe(2);
    expect(result.errors).toBe(0);
  });

  it('Notion API 拉取失败时记录 error 但不 throw', async () => {
    const pool = {
      query: vi.fn((sql, params) => {
        if (sql.includes('SELECT value_json FROM working_memory') &&
            params?.[0] === GATE_KEY_PATTERN) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Database not found' }),
    });

    const result = await runNotionCaptureIngest(pool, {
      resolveDbIds: () => ['bad-db'],
      resolveNotionToken: async () => 'token',
      fetchFn,
    });

    expect(result.errors).toBeGreaterThan(0);
    expect(result.ingested).toBe(0);
  });
});
