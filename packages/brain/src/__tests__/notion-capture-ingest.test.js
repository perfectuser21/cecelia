/**
 * notion-capture-ingest 单元测试
 *
 * 覆盖：间隔 gate、未配置静默跳过、标题提取、pushCapture 调用参数、幂等 dedupe_key。
 * fetch 为 mock（不发真实网络请求），pool 为 mock（不依赖 DB）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractPageTitle,
  getNotionInboxConfig,
  runNotionCaptureIngest,
  __resetNotionCaptureIngestForTest,
} from '../notion-capture-ingest.js';

// ─── mock capture-inbox pushCapture ──────────────────────────────────────────
vi.mock('../capture-inbox.js', () => ({
  pushCapture: vi.fn().mockResolvedValue({ captureId: 'cap-1', atomId: 'atom-1' }),
}));

// ─── mock pool (db.js) ───────────────────────────────────────────────────────
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

import { pushCapture } from '../capture-inbox.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makePage(id, titleText, lastEdited = '2026-08-05T10:00:00.000Z') {
  return {
    object: 'page',
    id,
    last_edited_time: lastEdited,
    created_time: '2026-08-01T00:00:00.000Z',
    properties: {
      Name: {
        id: 'title',
        type: 'title',
        title: [
          {
            type: 'text',
            text: { content: titleText, link: null },
            plain_text: titleText,
            href: null,
          },
        ],
      },
    },
  };
}

const NOTION_DB_RESPONSE = (pages) => ({
  object: 'list',
  results: pages,
  has_more: false,
  next_cursor: null,
  type: 'page_or_database',
  page_or_database: {},
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe('extractPageTitle', () => {
  it('Name.title 正常提取', () => {
    const page = makePage('page-001', '我的想法');
    expect(extractPageTitle(page)).toBe('我的想法');
  });

  it('Title.title 作为 fallback', () => {
    const page = {
      id: 'page-002',
      properties: {
        Title: { type: 'title', title: [{ plain_text: '另一想法' }] },
      },
    };
    expect(extractPageTitle(page)).toBe('另一想法');
  });

  it('任意 title 类型属性 fallback', () => {
    const page = {
      id: 'page-003',
      properties: {
        自定义: { type: 'title', title: [{ plain_text: '自定义标题' }] },
      },
    };
    expect(extractPageTitle(page)).toBe('自定义标题');
  });

  it('无 title 属性时返回 "Notion page <id>"', () => {
    const page = { id: 'page-004', properties: {} };
    expect(extractPageTitle(page)).toBe('Notion page page-004');
  });

  it('多段 rich_text 合并', () => {
    const page = {
      id: 'page-005',
      properties: {
        Name: {
          type: 'title',
          title: [
            { plain_text: 'hello ' },
            { plain_text: 'world' },
          ],
        },
      },
    };
    expect(extractPageTitle(page)).toBe('hello world');
  });
});

describe('getNotionInboxConfig', () => {
  const origEnv = { ...process.env };
  afterEach(() => { Object.assign(process.env, origEnv); });

  it('返回 env 中的 token 和 dbId', () => {
    process.env.NOTION_INBOX_TOKEN = 'tok-test';
    process.env.NOTION_INBOX_DB_ID = 'db-test';
    const { token, dbId } = getNotionInboxConfig();
    expect(token).toBe('tok-test');
    expect(dbId).toBe('db-test');
  });

  it('未设置时返回 null', () => {
    delete process.env.NOTION_INBOX_TOKEN;
    delete process.env.NOTION_INBOX_DB_ID;
    const { token, dbId } = getNotionInboxConfig();
    expect(token).toBeNull();
    expect(dbId).toBeNull();
  });
});

describe('runNotionCaptureIngest', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    __resetNotionCaptureIngestForTest();
    vi.clearAllMocks();
    process.env.NOTION_INBOX_TOKEN = 'ntn_test_token';
    process.env.NOTION_INBOX_DB_ID = 'db-inbox-001';
  });

  afterEach(() => {
    Object.assign(process.env, origEnv);
    delete process.env.NOTION_INBOX_TOKEN;
    delete process.env.NOTION_INBOX_DB_ID;
  });

  it('未配置时静默跳过，返回 not_configured', async () => {
    delete process.env.NOTION_INBOX_TOKEN;
    const result = await runNotionCaptureIngest({});
    expect(result).toEqual({ skipped: true, reason: 'not_configured' });
    expect(pushCapture).not.toHaveBeenCalled();
  });

  it('5分钟内第二次调用直接跳过（gate）', async () => {
    const page = makePage('p1', '第一页');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => NOTION_DB_RESPONSE([page]),
    });
    const origFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      await runNotionCaptureIngest({});        // 第一次正常跑
      const r = await runNotionCaptureIngest({}); // 第二次被 gate 拦截
      expect(r).toEqual({ skipped: true });
    } finally {
      global.fetch = origFetch;
    }
  });

  it('成功拉取页面后调用 pushCapture（正确参数）', async () => {
    const page = makePage('page-abc', '我的 Inbox 条目');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => NOTION_DB_RESPONSE([page]),
    });
    const origFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      const result = await runNotionCaptureIngest({});
      expect(result.pushed).toBe(1);
      expect(result.errors).toBe(0);
      expect(result.pages).toBe(1);

      expect(pushCapture).toHaveBeenCalledOnce();
      const callArgs = pushCapture.mock.calls[0][1];
      expect(callArgs.source).toBe('notion');
      expect(callArgs.dedupeKey).toBe('notion:inbox:page-abc');
      expect(callArgs.notionPageId).toBe('page-abc');
      expect(callArgs.targetType).toBe('notes');
      expect(callArgs.targetSubtype).toBe('notion_inbox');
      expect(callArgs.content).toBe('我的 Inbox 条目');
    } finally {
      global.fetch = origFetch;
    }
  });

  it('同一页面第二轮（重置 gate）→ pushCapture 再次调用，dedupe_key 不变（幂等由 DB 层保证）', async () => {
    const page = makePage('page-dup', '重复编辑的页面');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => NOTION_DB_RESPONSE([page]),
    });
    const origFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      await runNotionCaptureIngest({});
      __resetNotionCaptureIngestForTest(); // 重置 gate 模拟下一个5min窗口
      await runNotionCaptureIngest({});

      // pushCapture 两次调用的 dedupeKey 相同
      expect(pushCapture.mock.calls).toHaveLength(2);
      expect(pushCapture.mock.calls[0][1].dedupeKey).toBe('notion:inbox:page-dup');
      expect(pushCapture.mock.calls[1][1].dedupeKey).toBe('notion:inbox:page-dup');
    } finally {
      global.fetch = origFetch;
    }
  });

  it('Notion API 返回 HTTP 错误时返回 fatal 字段，不抛出', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized', code: 'unauthorized' }),
    });
    const origFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      const result = await runNotionCaptureIngest({});
      expect(result.fatal).toBeDefined();
      expect(result.pushed).toBe(0);
    } finally {
      global.fetch = origFetch;
    }
  });

  it('单页面 pushCapture 抛出时 errors++ 且继续处理其他页面', async () => {
    const pages = [makePage('p-fail', '失败页'), makePage('p-ok', '成功页')];
    pushCapture
      .mockRejectedValueOnce(new Error('db error'))
      .mockResolvedValueOnce({ captureId: 'cap-2', atomId: 'atom-2' });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => NOTION_DB_RESPONSE(pages),
    });
    const origFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      const result = await runNotionCaptureIngest({});
      expect(result.errors).toBe(1);
      expect(result.pushed).toBe(1);
    } finally {
      global.fetch = origFetch;
    }
  });
});
