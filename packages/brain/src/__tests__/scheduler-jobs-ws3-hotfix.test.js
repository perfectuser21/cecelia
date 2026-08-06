/**
 * scheduler-jobs-ws3-hotfix.test.js
 *
 * TDD Red/Green — WS3 接线空转修复集成测试（task: 3fa3e361-9c89-4a12-844e-566784d420b4）
 *
 * 覆盖：
 *   A1-Red/Green: notion-verdict-ingest.js 导出 runNotionVerdictIngest 函数
 *   A2-Red/Green: notion-inbox-push.js 导出 runNotionProductPush 函数
 *   INV-7: runNotionVerdictIngest 凭据缺失 → {skipped:true, reason:'not_configured'}
 *   INV-8: runNotionProductPush 榜单为空 → {skipped:true, reason:'empty_leaderboard'}
 *   A1行为: runNotionVerdictIngest 调用 Notion DB query，带 放行/不放行 filter
 *   A2行为: runNotionProductPush 读取 triage_officer_leaderboard key
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── mock notion-capture-ingest（notionRequest 工具函数）────────────────────
vi.mock('../notion-capture-ingest.js', () => ({
  notionRequest: vi.fn(),
  getNotionInboxConfig: vi.fn(),
}));

// ─── mock db.js pool ──────────────────────────────────────────────────────────
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

import { notionRequest, getNotionInboxConfig } from '../notion-capture-ingest.js';
import pool from '../db.js';

// ─── 动态 import 被测模块 ──────────────────────────────────────────────────────
let runNotionVerdictIngest;
let getVerdictIngestConfig;
try {
  const mod = await import('../notion-verdict-ingest.js');
  runNotionVerdictIngest = mod.runNotionVerdictIngest;
  getVerdictIngestConfig = mod.getVerdictIngestConfig;
} catch {
  runNotionVerdictIngest = undefined;
  getVerdictIngestConfig = undefined;
}

let runNotionProductPush;
try {
  const mod = await import('../notion-inbox-push.js');
  runNotionProductPush = mod.runNotionProductPush;
} catch {
  runNotionProductPush = undefined;
}

// ─── A1-Red/Green: 函数导出存在性 ─────────────────────────────────────────────

describe('A1: notion-verdict-ingest.js 导出 runNotionVerdictIngest', () => {
  it('runNotionVerdictIngest 应为可调用函数（存在性断言）', () => {
    expect(typeof runNotionVerdictIngest).toBe('function');
  });
});

// ─── A2-Red/Green: 函数导出存在性 ─────────────────────────────────────────────

describe('A2: notion-inbox-push.js 导出 runNotionProductPush', () => {
  it('runNotionProductPush 应为可调用函数（存在性断言）', () => {
    expect(typeof runNotionProductPush).toBe('function');
  });
});

// ─── INV-7: 凭据缺失静默跳过 ──────────────────────────────────────────────────

describe('INV-7: runNotionVerdictIngest 凭据缺失时跳过', () => {
  it('NOTION_INBOX_TOKEN 未配置 → {skipped:true, reason:"not_configured"}', async () => {
    if (typeof runNotionVerdictIngest !== 'function') {
      expect.fail('runNotionVerdictIngest 未导出，需先实现修复');
    }
    // 保存并清除环境变量
    const origToken = process.env.NOTION_INBOX_TOKEN;
    const origDbId = process.env.NOTION_INBOX_DB_ID;
    delete process.env.NOTION_INBOX_TOKEN;
    delete process.env.NOTION_INBOX_DB_ID;

    const mockPool = { query: vi.fn() };
    const result = await runNotionVerdictIngest(mockPool);

    expect(result).toMatchObject({ skipped: true, reason: 'not_configured' });

    // 恢复
    if (origToken !== undefined) process.env.NOTION_INBOX_TOKEN = origToken;
    if (origDbId !== undefined) process.env.NOTION_INBOX_DB_ID = origDbId;
  });
});

// ─── INV-8: 榜单为空时跳过 ────────────────────────────────────────────────────

describe('INV-8: runNotionProductPush 榜单为空时跳过', () => {
  it('working_memory 中 triage_officer_leaderboard 为空数组 → {skipped:true, reason:"empty_leaderboard"}', async () => {
    if (typeof runNotionProductPush !== 'function') {
      expect.fail('runNotionProductPush 未导出，需先实现修复');
    }
    // 凭据正常
    getNotionInboxConfig.mockReturnValue({ token: 'test-token', dbId: 'test-db-id' });

    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ value_json: { leaderboard: [] } }],
      }),
    };

    const result = await runNotionProductPush(mockPool);

    expect(result).toMatchObject({ skipped: true, reason: 'empty_leaderboard' });
  });

  it('working_memory 中无 triage_officer_leaderboard 记录 → {skipped:true, reason:"empty_leaderboard"}', async () => {
    if (typeof runNotionProductPush !== 'function') {
      expect.fail('runNotionProductPush 未导出，需先实现修复');
    }
    getNotionInboxConfig.mockReturnValue({ token: 'test-token', dbId: 'test-db-id' });

    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const result = await runNotionProductPush(mockPool);

    expect(result).toMatchObject({ skipped: true, reason: 'empty_leaderboard' });
  });
});

// ─── A1行为: runNotionVerdictIngest 调用 Notion DB query 含放行/不放行 filter ──

describe('A1行为: runNotionVerdictIngest 查询Notion时携带放行/不放行 filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('调用 notionRequest 时传入包含 放行 和 不放行 字段的 filter', async () => {
    if (typeof runNotionVerdictIngest !== 'function') {
      expect.fail('runNotionVerdictIngest 未导出，需先实现修复');
    }

    // 设置凭据
    const origToken = process.env.NOTION_INBOX_TOKEN;
    const origDbId = process.env.NOTION_INBOX_DB_ID;
    process.env.NOTION_INBOX_TOKEN = 'test-token-xxx';
    process.env.NOTION_INBOX_DB_ID = 'test-db-id-xxx';

    // mock notionRequest 返回空页面列表（没有需要消费的页面）
    notionRequest.mockResolvedValue({ results: [] });

    const mockPool = { query: vi.fn() };
    await runNotionVerdictIngest(mockPool);

    // 验证调用了 Notion DB query
    expect(notionRequest).toHaveBeenCalled();

    // 找到调用 /databases/.../query 的那次调用
    const queryCall = notionRequest.mock.calls.find(
      (args) => typeof args[1] === 'string' && args[1].includes('/query')
    );
    expect(queryCall).toBeDefined();

    // 验证 filter 包含 放行 和 不放行
    const body = queryCall[3];
    const filterStr = JSON.stringify(body?.filter ?? {});
    expect(filterStr).toContain('放行');
    expect(filterStr).toContain('不放行');

    // 恢复
    if (origToken !== undefined) process.env.NOTION_INBOX_TOKEN = origToken;
    else delete process.env.NOTION_INBOX_TOKEN;
    if (origDbId !== undefined) process.env.NOTION_INBOX_DB_ID = origDbId;
    else delete process.env.NOTION_INBOX_DB_ID;
  });
});

// ─── A2行为: runNotionProductPush 读取 triage_officer_leaderboard ─────────────

describe('A2行为: runNotionProductPush 从 working_memory 读取 triage_officer_leaderboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('读取 key=triage_officer_leaderboard 的 working_memory 记录', async () => {
    if (typeof runNotionProductPush !== 'function') {
      expect.fail('runNotionProductPush 未导出，需先实现修复');
    }
    getNotionInboxConfig.mockReturnValue({ token: 'test-token', dbId: 'test-db-id' });

    const leaderboard = [
      { id: 'task-001', title: '任务A', priority: 'P1', journey_name: 'J1' },
      { id: 'task-002', title: '任务B', priority: 'P2', journey_name: 'J2' },
    ];

    const mockPool = {
      query: vi.fn()
        // 第一次调用：读榜单
        .mockResolvedValueOnce({ rows: [{ value_json: { leaderboard } }] })
        // 后续调用：幂等检查（每个 item 各一次）
        .mockResolvedValue({ rows: [] }),
    };

    // mock Notion API
    notionRequest
      // getDbTitleKey 查询 DB schema
      .mockResolvedValueOnce({
        properties: { Ideas: { type: 'title' }, AI摘要: { type: 'rich_text' } },
      })
      // 第一个 item 推送
      .mockResolvedValueOnce({ id: 'notion-page-001' })
      // getDbTitleKey 第二次
      .mockResolvedValueOnce({
        properties: { Ideas: { type: 'title' }, AI摘要: { type: 'rich_text' } },
      })
      // 第二个 item 推送
      .mockResolvedValueOnce({ id: 'notion-page-002' });

    const result = await runNotionProductPush(mockPool);

    // 验证读取了 triage_officer_leaderboard
    const queryCalls = mockPool.query.mock.calls;
    const leaderboardQuery = queryCalls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('triage_officer_leaderboard')
    );
    expect(leaderboardQuery).toBeDefined();

    // 验证推送了 2 个 item
    expect(result).toMatchObject({ pushed: 2, errors: 0 });
  });
});
