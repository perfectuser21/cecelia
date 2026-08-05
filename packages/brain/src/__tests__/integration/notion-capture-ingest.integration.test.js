/**
 * notion-capture-ingest 集成测试
 *
 * 使用真实 Notion API 响应结构（object:'page', properties.Name.title 完整格式），
 * 不 mock Notion 响应格式（DoD④）。fetch 本身被 mock 以避免网络依赖，
 * 但 fixture 与 Notion REST API 2022-06-28 实际返回格式严格对齐。
 *
 * DB：mock pool（隔离 DB 依赖），验证写入调用链路与 dedupe_key 格式。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── 真实 Notion API 响应 Fixture（与 API 2022-06-28 返回结构对齐）────────────

const NOTION_PAGE_FIXTURE = {
  object: 'page',
  id: '1a2b3c4d-5e6f-7890-abcd-ef1234567890',
  created_time: '2026-08-01T08:00:00.000Z',
  last_edited_time: '2026-08-05T09:30:00.000Z',
  created_by: { object: 'user', id: 'user-001' },
  last_edited_by: { object: 'user', id: 'user-001' },
  cover: null,
  icon: null,
  parent: { type: 'database_id', database_id: 'db-inbox-001' },
  archived: false,
  in_trash: false,
  url: 'https://www.notion.so/1a2b3c4d5e6f7890abcdef1234567890',
  public_url: null,
  properties: {
    Name: {
      id: 'title',
      type: 'title',
      title: [
        {
          type: 'text',
          text: { content: '采购新一批打印纸', link: null },
          annotations: {
            bold: false, italic: false, strikethrough: false,
            underline: false, code: false, color: 'default',
          },
          plain_text: '采购新一批打印纸',
          href: null,
        },
      ],
    },
    Status: {
      id: 'Nnmg',
      type: 'status',
      status: { id: 'in-progress', name: 'In Progress', color: 'blue' },
    },
    Tags: {
      id: 'taGs',
      type: 'multi_select',
      multi_select: [{ id: 'tag-1', name: '行政', color: 'gray' }],
    },
    'Created time': {
      id: 'crTm',
      type: 'created_time',
      created_time: '2026-08-01T08:00:00.000Z',
    },
  },
};

const NOTION_PAGE_FIXTURE_2 = {
  ...NOTION_PAGE_FIXTURE,
  id: 'aaaabbbb-cccc-dddd-eeee-ffff00001111',
  last_edited_time: '2026-08-05T10:00:00.000Z',
  url: 'https://www.notion.so/aaaabbbbccccddddeeee ffff00001111',
  properties: {
    ...NOTION_PAGE_FIXTURE.properties,
    Name: {
      id: 'title',
      type: 'title',
      title: [
        {
          type: 'text',
          text: { content: '联系设计师修改 Logo', link: null },
          annotations: {
            bold: false, italic: false, strikethrough: false,
            underline: false, code: false, color: 'default',
          },
          plain_text: '联系设计师修改 Logo',
          href: null,
        },
      ],
    },
  },
};

const NOTION_DB_QUERY_RESPONSE = {
  object: 'list',
  results: [NOTION_PAGE_FIXTURE, NOTION_PAGE_FIXTURE_2],
  next_cursor: null,
  has_more: false,
  type: 'page_or_database',
  page_or_database: {},
  developer_survey: 'https://notionup.typeform.com/to/bllBsoI4',
  request_id: 'req-abc-123',
};

// ─── mock capture-inbox ───────────────────────────────────────────────────────
vi.mock('../../capture-inbox.js', () => ({
  pushCapture: vi.fn().mockResolvedValue({ captureId: 'cap-uuid', atomId: 'atom-uuid' }),
}));
vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));

import { pushCapture } from '../../capture-inbox.js';
import {
  extractPageTitle,
  fetchInboxPages,
  runNotionCaptureIngest,
  __resetNotionCaptureIngestForTest,
} from '../../notion-capture-ingest.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function mockFetch(responseBody, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => responseBody,
  });
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('notion-capture-ingest integration (real Notion response format)', () => {
  beforeEach(() => {
    __resetNotionCaptureIngestForTest();
    vi.clearAllMocks();
    process.env.NOTION_INBOX_TOKEN = 'ntn_ccapi2026_test';
    process.env.NOTION_INBOX_DB_ID = 'db-inbox-001';
  });

  afterEach(() => {
    delete process.env.NOTION_INBOX_TOKEN;
    delete process.env.NOTION_INBOX_DB_ID;
  });

  it('extractPageTitle 正确解析真实 Notion page fixture', () => {
    const title = extractPageTitle(NOTION_PAGE_FIXTURE);
    expect(title).toBe('采购新一批打印纸');
  });

  it('fetchInboxPages 解析完整 Notion DB query 响应（不 mock 结构）', async () => {
    const origFetch = global.fetch;
    global.fetch = mockFetch(NOTION_DB_QUERY_RESPONSE);
    try {
      const pages = await fetchInboxPages('tok', 'db-001', '2026-08-01T00:00:00.000Z');
      expect(pages).toHaveLength(2);
      // 验证原始 Notion 字段完整保留
      expect(pages[0].object).toBe('page');
      expect(pages[0].last_edited_time).toBe('2026-08-05T09:30:00.000Z');
      expect(pages[0].parent.database_id).toBe('db-inbox-001');
      expect(pages[0].properties.Status.status.name).toBe('In Progress');
    } finally {
      global.fetch = origFetch;
    }
  });

  it('全流程：真实结构 fixture → pushCapture 写入含 notion_page_id 的 captures', async () => {
    const origFetch = global.fetch;
    global.fetch = mockFetch(NOTION_DB_QUERY_RESPONSE);
    try {
      const result = await runNotionCaptureIngest({});

      expect(result.pushed).toBe(2);
      expect(result.pages).toBe(2);
      expect(result.errors).toBe(0);

      // 验证第一条写入
      const call0 = pushCapture.mock.calls[0][1];
      expect(call0.source).toBe('notion');
      expect(call0.notionPageId).toBe('1a2b3c4d-5e6f-7890-abcd-ef1234567890');
      expect(call0.dedupeKey).toBe('notion:inbox:1a2b3c4d-5e6f-7890-abcd-ef1234567890');
      expect(call0.content).toBe('采购新一批打印纸');
      expect(call0.targetType).toBe('notes');
      expect(call0.targetSubtype).toBe('notion_inbox');

      // 验证第二条写入
      const call1 = pushCapture.mock.calls[1][1];
      expect(call1.notionPageId).toBe('aaaabbbb-cccc-dddd-eeee-ffff00001111');
      expect(call1.dedupeKey).toBe('notion:inbox:aaaabbbb-cccc-dddd-eeee-ffff00001111');
      expect(call1.content).toBe('联系设计师修改 Logo');
    } finally {
      global.fetch = origFetch;
    }
  });

  it('DoD②: 同一页面重复 push → dedupeKey 恒定（DB 层 ON CONFLICT 保证唯一）', async () => {
    const singlePageResponse = {
      ...NOTION_DB_QUERY_RESPONSE,
      results: [NOTION_PAGE_FIXTURE],
    };
    const origFetch = global.fetch;
    global.fetch = mockFetch(singlePageResponse);
    try {
      // 第一轮
      await runNotionCaptureIngest({});
      __resetNotionCaptureIngestForTest();
      // 第二轮（同一页面再次出现，例如被编辑）
      await runNotionCaptureIngest({});

      const keys = pushCapture.mock.calls.map(c => c[1].dedupeKey);
      expect(keys).toHaveLength(2);
      // 两次调用 dedupeKey 完全相同 → DB ON CONFLICT DO UPDATE，不产生第二条 captures 行
      expect(keys[0]).toBe(keys[1]);
    } finally {
      global.fetch = origFetch;
    }
  });

  it('Notion API 分页（has_more=true）时完整拉取所有页', async () => {
    const page1Response = {
      object: 'list',
      results: [NOTION_PAGE_FIXTURE],
      has_more: true,
      next_cursor: 'cursor-abc',
    };
    const page2Response = {
      object: 'list',
      results: [NOTION_PAGE_FIXTURE_2],
      has_more: false,
      next_cursor: null,
    };
    let callCount = 0;
    const origFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(() => {
      const body = callCount++ === 0 ? page1Response : page2Response;
      return Promise.resolve({ ok: true, json: async () => body });
    });
    try {
      const pages = await fetchInboxPages('tok', 'db-001', null);
      expect(pages).toHaveLength(2);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = origFetch;
    }
  });

  it('Notion 返回 archived=true 的页面也正常处理（由调用方自行决策是否过滤）', async () => {
    const archivedPage = {
      ...NOTION_PAGE_FIXTURE,
      id: 'archived-page-001',
      archived: true,
    };
    const origFetch = global.fetch;
    global.fetch = mockFetch({ ...NOTION_DB_QUERY_RESPONSE, results: [archivedPage] });
    try {
      const result = await runNotionCaptureIngest({});
      // MVP 阶段不过滤 archived，全量写入
      expect(result.pushed).toBe(1);
      expect(pushCapture.mock.calls[0][1].notionPageId).toBe('archived-page-001');
    } finally {
      global.fetch = origFetch;
    }
  });
});
