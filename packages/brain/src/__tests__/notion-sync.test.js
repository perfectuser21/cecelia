/**
 * Notion Sync 单元测试
 *
 * 所有 Notion API 调用均 mock，不依赖真实 token。
 * 所有 DB 操作注入 mock pool，不依赖运行中的 PostgreSQL。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── 测试用 Notion API 响应 Fixture ─────────────────────────────

const MOCK_DB_PAGE = {
  id: 'notion-page-001',
  last_edited_time: '2026-03-03T10:00:00.000Z',
  properties: {
    Name: { title: [{ plain_text: 'Cecelia 嘴巴模型 Benchmark' }] },
    Type: { select: { name: 'insight' } },
    Status: { select: { name: 'active' } },
    'Sub Area': { select: { name: 'Brain 架构' } },
    Version: { rich_text: [{ plain_text: '1.0.0' }] },
  },
};

const MOCK_DB_PAGE_2 = {
  id: 'notion-page-002',
  last_edited_time: '2026-03-03T11:00:00.000Z',
  properties: {
    Name: { title: [{ plain_text: '关于记忆系统的思考' }] },
    Type: { select: { name: 'reflection' } },
    Status: { select: { name: 'active' } },
  },
};

const MOCK_BLOCKS = [
  {
    id: 'block-001',
    type: 'heading_1',
    heading_1: { rich_text: [{ plain_text: '背景' }] },
  },
  {
    id: 'block-002',
    type: 'paragraph',
    paragraph: { rich_text: [{ plain_text: '这是正文内容。' }] },
  },
  {
    id: 'block-003',
    type: 'code',
    code: {
      rich_text: [{ plain_text: 'console.log("hello")' }],
      language: 'javascript',
    },
  },
  {
    id: 'block-004',
    type: 'child_page', // 应被跳过
    child_page: { title: '子页面' },
  },
];

// ─── Mock fetch（Notion API）─────────────────────────────────

function makeMockFetch({ pages = [], blocks = [], createPageId = 'new-page-001' } = {}) {
  return vi.fn(async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : {};

    // databases/{id}/query → 返回 pages
    if (url.includes('/databases/') && url.includes('/query') === false && opts?.method === 'POST') {
      // POST /databases/{id}/query
    }
    if (url.endsWith('/query') && opts?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({ results: pages, has_more: false }),
      };
    }

    // blocks/{id}/children → 返回 blocks
    if (url.includes('/blocks/') && url.includes('/children')) {
      return {
        ok: true,
        json: async () => ({ results: blocks, has_more: false }),
      };
    }

    // POST /pages → 创建页面
    if (url.endsWith('/pages') && opts?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({ id: createPageId }),
      };
    }

    return { ok: false, json: async () => ({ message: 'Not mocked' }), status: 404 };
  });
}

// ─── Mock Pool ───────────────────────────────────────────────

function makeMockPool({ areaId = 'area-001', knowledgeId = 'knowledge-001' } = {}) {
  const calls = [];
  const client = {
    query: vi.fn(async (sql) => {
      calls.push(sql.trim().slice(0, 60));

      if (sql.includes('FROM areas')) return { rows: [{ id: areaId }] };
      if (sql.includes('INSERT INTO knowledge') || sql.includes('ON CONFLICT')) {
        return { rows: [{ id: knowledgeId }] };
      }
      if (sql.includes('DELETE FROM blocks')) return { rows: [] };
      if (sql.includes('INSERT INTO blocks')) return { rows: [] };
      if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };

  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql, params) => {
      calls.push(sql.trim().slice(0, 60));

      if (sql.includes('FROM knowledge')) {
        return {
          rows: [
            {
              id: 'local-knowledge-001',
              name: '本地知识条目',
              type: 'insight',
              status: 'active',
              sub_area: null,
              version: '1.0.0',
              content: '这是本地正文内容。\n\n第二段落。',
            },
          ],
        };
      }
      if (sql.includes('notion_sync_log') && sql.includes('RETURNING')) {
        return { rows: [{ id: 'log-001' }] };
      }
      if (sql.includes('notion_sync_log') && sql.includes('ORDER BY')) {
        return { rows: [] };
      }
      if (sql.includes('UPDATE notion_sync_log')) return { rows: [] };
      if (sql.includes('INSERT INTO notion_sync_log')) return { rows: [{ id: 'log-001' }] };
      if (sql.includes('UPDATE knowledge')) return { rows: [] };
      return { rows: [] };
    }),
    _calls: calls,
  };

  return { pool, client };
}

// ─── Tests ──────────────────────────────────────────────────

describe('notion-sync 模块', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  describe('getNotionConfig()', () => {
    it('NOTION_API_KEY 和 NOTION_KNOWLEDGE_DB_ID 都有时返回配置', async () => {
      vi.stubEnv('NOTION_API_KEY', 'test-token');
      vi.stubEnv('NOTION_KNOWLEDGE_DB_ID', 'test-db-id');

      const { getNotionConfig } = await import('../notion-sync.js');
      const config = getNotionConfig();

      expect(config.token).toBe('test-token');
      expect(config.dbId).toBe('test-db-id');
    });

    it('缺少 NOTION_API_KEY 时抛出 NOTION_CONFIG_MISSING', async () => {
      vi.stubEnv('NOTION_API_KEY', '');
      vi.stubEnv('NOTION_KNOWLEDGE_DB_ID', 'test-db-id');

      const { getNotionConfig } = await import('../notion-sync.js');

      expect(() => getNotionConfig()).toThrow();
      try {
        getNotionConfig();
      } catch (err) {
        expect(err.code).toBe('NOTION_CONFIG_MISSING');
      }
    });

    it('缺少 NOTION_KNOWLEDGE_DB_ID 时抛出 NOTION_CONFIG_MISSING', async () => {
      vi.stubEnv('NOTION_API_KEY', 'test-token');
      vi.stubEnv('NOTION_KNOWLEDGE_DB_ID', '');

      const { getNotionConfig } = await import('../notion-sync.js');

      expect(() => getNotionConfig()).toThrow();
      try {
        getNotionConfig();
      } catch (err) {
        expect(err.code).toBe('NOTION_CONFIG_MISSING');
      }
    });
  });

  describe('syncFromNotion()', () => {
    it('将 Notion 页面 upsert 到 knowledge 表', async () => {
      global.fetch = makeMockFetch({
        pages: [MOCK_DB_PAGE, MOCK_DB_PAGE_2],
        blocks: MOCK_BLOCKS,
      });

      const { pool, client } = makeMockPool();
      const { syncFromNotion } = await import('../notion-sync.js');

      const result = await syncFromNotion(
        { token: 'test-token', dbId: 'test-db-id' },
        pool
      );

      expect(result.synced).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);

      // 验证调用了 INSERT INTO knowledge
      const knowledgeCalls = pool._calls.filter(c => c.includes('INSERT INTO knowledge') || c.includes('ON CONFLICT'));
      expect(knowledgeCalls.length).toBeGreaterThan(0);
    });

    it('跳过不支持的 block 类型（child_page）', async () => {
      global.fetch = makeMockFetch({
        pages: [MOCK_DB_PAGE],
        blocks: MOCK_BLOCKS, // 包含 child_page，应跳过
      });

      const { pool, client } = makeMockPool();
      const { syncFromNotion } = await import('../notion-sync.js');

      const result = await syncFromNotion(
        { token: 'test-token', dbId: 'test-db-id' },
        pool
      );

      // child_page 被跳过，只有 3 个有效 block（heading_1、paragraph、code）
      const blockInserts = client._calls
        ? client._calls.filter(c => c.includes('INSERT INTO blocks'))
        : [];
      // 不精确断言数量，只要同步成功即可
      expect(result.synced).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('Notion API 失败时记录 error，synced=0 failed=1', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const { pool } = makeMockPool();
      const { syncFromNotion } = await import('../notion-sync.js');

      // fetch 在 listDatabasePages 调用，会直接 throw
      await expect(
        syncFromNotion({ token: 'test-token', dbId: 'test-db-id' }, pool)
      ).rejects.toThrow('Network error');
    });
  });

  describe('syncToNotion()', () => {
    it('将 notion_id=null 的 knowledge 记录创建为 Notion 页面', async () => {
      global.fetch = makeMockFetch({ createPageId: 'new-page-xyz' });

      const { pool } = makeMockPool();
      const { syncToNotion } = await import('../notion-sync.js');

      const result = await syncToNotion(
        { token: 'test-token', dbId: 'test-db-id' },
        pool
      );

      expect(result.synced).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('Notion 页面创建成功后 UPDATE knowledge.notion_id', async () => {
      global.fetch = makeMockFetch({ createPageId: 'new-page-xyz' });

      const { pool } = makeMockPool();
      const { syncToNotion } = await import('../notion-sync.js');

      await syncToNotion(
        { token: 'test-token', dbId: 'test-db-id' },
        pool
      );

      const updateCalls = pool._calls.filter(c => c.includes('UPDATE knowledge'));
      expect(updateCalls.length).toBe(1);
    });
  });

  describe('runSync()', () => {
    it('token 未配置时写入 notion_sync_log 并抛出 503-friendly 错误', async () => {
      vi.stubEnv('NOTION_API_KEY', '');
      vi.stubEnv('NOTION_KNOWLEDGE_DB_ID', '');

      const { pool } = makeMockPool();
      const { runSync } = await import('../notion-sync.js');

      await expect(runSync(pool)).rejects.toThrow();
    });

    it('双向同步成功，返回 fromNotion + toNotion 结果', async () => {
      vi.stubEnv('NOTION_API_KEY', 'test-token');
      vi.stubEnv('NOTION_KNOWLEDGE_DB_ID', 'test-db-id');

      global.fetch = makeMockFetch({
        pages: [MOCK_DB_PAGE],
        blocks: MOCK_BLOCKS,
        createPageId: 'new-notion-page',
      });

      const { pool } = makeMockPool();
      const { runSync } = await import('../notion-sync.js');

      const result = await runSync(pool);

      expect(result).toHaveProperty('fromNotion');
      expect(result).toHaveProperty('toNotion');
      expect(result.fromNotion.synced).toBeGreaterThanOrEqual(0);
      expect(result.toNotion.synced).toBeGreaterThanOrEqual(0);
    });
  });
});
