/**
 * notion-inbox-push.contract.test.js
 *
 * WS3 合同测试 — 成品呈报（FR-1）
 * 覆盖 INV-3 / INV-4 / INV-6 + 属性构造完整性 + notion_page_id 回写
 *
 * 所有网络与 DB 调用均为 mock，不依赖真实 Notion API 或 PostgreSQL。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── mock notionRequest（复用 notion-capture-ingest 的工具函数）───────────────
vi.mock('../../../packages/brain/src/notion-capture-ingest.js', () => ({
  notionRequest: vi.fn(),
  getNotionInboxConfig: vi.fn(),
}));

// ─── mock db.js pool ──────────────────────────────────────────────────────────
vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn() },
}));

import { notionRequest, getNotionInboxConfig } from '../../../packages/brain/src/notion-capture-ingest.js';
import pool from '../../../packages/brain/src/db.js';

// ─── 动态 import 被测模块（允许未实现时报 MODULE_NOT_FOUND 被 test 捕获）──────
let pushProductToNotionInbox;
try {
  const mod = await import('../../../packages/brain/src/notion-inbox-push.js');
  pushProductToNotionInbox = mod.pushProductToNotionInbox;
} catch {
  pushProductToNotionInbox = null;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeProduct(overrides = {}) {
  return {
    task_id: 'task-uuid-001',
    product_type: 'proposal',
    title: '测试提案标题',
    summary: '这是一句话总结，不超过200字',
    suggested_direction: '放行',
    confidence: 0.85,
    review_required: false,
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('pushProductToNotionInbox — FR-1 合同测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认凭据配置
    getNotionInboxConfig.mockReturnValue({
      token: 'test-token-xxx',
      dbId: 'test-db-id-xxx',
    });
    // 默认 Notion API 成功响应
    notionRequest.mockResolvedValue({ id: 'notion-page-id-001', object: 'page' });
    // 默认 pool.query 成功
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('[INV-6] 凭据缺失时静默跳过，返回 {skipped:true, reason:"not_configured"}', async () => {
    if (!pushProductToNotionInbox) {
      expect.fail('pushProductToNotionInbox 未实现（notion-inbox-push.js 不存在）');
    }
    getNotionInboxConfig.mockReturnValue({ token: null, dbId: null });
    const result = await pushProductToNotionInbox(pool, makeProduct());
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('not_configured');
    expect(notionRequest).not.toHaveBeenCalled();
  });

  it('[INV-3] review_required=true 且建议去向非放行时，Notion 页面 需拍板=true', async () => {
    if (!pushProductToNotionInbox) {
      expect.fail('pushProductToNotionInbox 未实现');
    }
    const product = makeProduct({ review_required: true, suggested_direction: '待拍板' });
    await pushProductToNotionInbox(pool, product);
    const callArgs = notionRequest.mock.calls[0];
    const body = callArgs[3];
    expect(body?.properties?.['需拍板']?.checkbox).toBe(true);
  });

  it('[INV-4] 相同 task_id + product_type 第二次调用返回 {skipped:true, reason:"already_pushed"}（幂等键去重）', async () => {
    if (!pushProductToNotionInbox) {
      expect.fail('pushProductToNotionInbox 未实现');
    }
    // 模拟 DB 已存在幂等记录（captures 表 dedupe_key 冲突）
    pool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('dedupe_key')) {
        return { rows: [{ id: 'existing-capture', notion_page_id: 'existing-page' }] };
      }
      return { rows: [] };
    });
    const product = makeProduct();
    const result = await pushProductToNotionInbox(pool, product);
    // 应检测到已推送，返回跳过
    expect(result.skipped).toBe(true);
  });

  it('[FR-1] 成功推送时返回 {pushed:1, notion_page_id} 且 pool.query 含 notion_page_id 回写', async () => {
    if (!pushProductToNotionInbox) {
      expect.fail('pushProductToNotionInbox 未实现');
    }
    pool.query.mockResolvedValue({ rows: [] });
    const result = await pushProductToNotionInbox(pool, makeProduct());
    expect(result.pushed).toBe(1);
    expect(result.notion_page_id).toBeTruthy();
    // 断言 pool.query 中有针对 tasks 表的 notion_page_id 更新
    const queryCalls = pool.query.mock.calls.map(c => String(c[0]));
    const hasPageIdUpdate = queryCalls.some(q => q.includes('notion_page_id'));
    expect(hasPageIdUpdate).toBe(true);
  });

  it('[FR-1] Notion 页面属性包含白名单所有必填字段（Title/AI摘要/建议去向/置信度/需拍板/产物类型/任务ID）', async () => {
    if (!pushProductToNotionInbox) {
      expect.fail('pushProductToNotionInbox 未实现');
    }
    await pushProductToNotionInbox(pool, makeProduct());
    expect(notionRequest).toHaveBeenCalled();
    const callArgs = notionRequest.mock.calls[0];
    const body = callArgs[3];
    const props = body?.properties ?? {};
    // 必须包含所有白名单属性
    expect(props).toHaveProperty('Title');
    expect(props).toHaveProperty('AI摘要');
    expect(props).toHaveProperty('建议去向');
    expect(props).toHaveProperty('置信度');
    expect(props).toHaveProperty('需拍板');
    expect(props).toHaveProperty('产物类型');
    expect(props).toHaveProperty('任务ID');
  });

  it('[FR-1] 产物类型不在白名单时拒绝推送', async () => {
    if (!pushProductToNotionInbox) {
      expect.fail('pushProductToNotionInbox 未实现');
    }
    const result = await pushProductToNotionInbox(pool, makeProduct({ product_type: 'invalid_type' }));
    expect(result.skipped).toBe(true);
    expect(notionRequest).not.toHaveBeenCalled();
  });
});
