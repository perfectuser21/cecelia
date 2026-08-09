/**
 * notion-verdict-ingest.contract.test.js
 *
 * WS3 合同测试 — 裁决窄口回读（FR-2）
 * 覆盖 INV-1 / INV-2 / INV-3 / INV-4 / INV-6 + 放行/不放行/批注三路径
 *
 * 所有网络与 DB 调用均为 mock。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── mock db.js pool ──────────────────────────────────────────────────────────
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

import pool from '../db.js';

// ─── 动态 import 被测模块 ─────────────────────────────────────────────────────
let consumeVerdictFromNotion;
let getVerdictIngestConfig;
try {
  const mod = await import('../notion-verdict-ingest.js');
  consumeVerdictFromNotion = mod.consumeVerdictFromNotion;
  getVerdictIngestConfig = mod.getVerdictIngestConfig;
} catch {
  consumeVerdictFromNotion = null;
  getVerdictIngestConfig = null;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * 构造标准白名单三字段 Notion 页面对象
 */
function makeVerdictPage({
  pageId = 'notion-page-001',
  approved = false,
  rejected = false,
  annotation = '',
  reviewRequired = false,
  taskId = 'task-uuid-001',
} = {}) {
  return {
    id: pageId,
    object: 'page',
    properties: {
      '放行': { type: 'checkbox', checkbox: approved },
      '不放行': { type: 'checkbox', checkbox: rejected },
      '批注': {
        type: 'rich_text',
        rich_text: annotation ? [{ plain_text: annotation }] : [],
      },
      '需拍板': { type: 'checkbox', checkbox: reviewRequired },
      '任务ID': {
        type: 'rich_text',
        rich_text: [{ plain_text: taskId }],
      },
    },
  };
}

/**
 * 构造含非白名单字段的 Notion 页面（INV-1/INV-2 触发）
 */
function makeNonWhitelistPage(pageId = 'notion-page-bad') {
  return {
    id: pageId,
    object: 'page',
    properties: {
      '自由文本状态': {
        type: 'rich_text',
        rich_text: [{ plain_text: '已完成请放行' }],
      },
      '日记段落': {
        type: 'paragraph',
        paragraph: { text: [{ plain_text: '这是散文内容' }] },
      },
    },
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('consumeVerdictFromNotion — FR-2 合同测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 pool.query: captures 表未消费（consumed_at IS NULL）
    pool.query.mockResolvedValue({ rows: [{ id: 'cap-1', consumed_at: null, task_id: 'task-uuid-001' }] });

    // 默认 env 凭据
    process.env.NOTION_INBOX_TOKEN = 'test-token-xxx';
    process.env.NOTION_INBOX_DB_ID = 'test-db-id-xxx';
  });

  it('[INV-6] 凭据缺失时静默跳过，返回 {skipped:true, reason:"not_configured"}', async () => {
    if (!consumeVerdictFromNotion) {
      expect.fail('consumeVerdictFromNotion 未实现（notion-verdict-ingest.js 不存在）');
    }
    delete process.env.NOTION_INBOX_TOKEN;
    delete process.env.NOTION_INBOX_DB_ID;

    const result = await consumeVerdictFromNotion(pool, makeVerdictPage());
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('not_configured');
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE'), expect.anything());
  });

  it('[INV-1] 字段解析失败（非白名单字段） = fail-closed，返回 {skipped:true, reason:"non_whitelist"}，不写 DB', async () => {
    if (!consumeVerdictFromNotion) {
      expect.fail('consumeVerdictFromNotion 未实现');
    }
    const page = makeNonWhitelistPage();
    const result = await consumeVerdictFromNotion(pool, page);
    expect(result.skipped).toBe(true);
    // reason 应含 non_whitelist 或类似标识
    expect(result.reason).toMatch(/non_whitelist|no_verdict_fields/i);
    // 不应写 decisions 表
    const writeCalls = pool.query.mock.calls.filter(c => String(c[0]).includes('INSERT INTO decisions'));
    expect(writeCalls.length).toBe(0);
  });

  it('[INV-2] 散文/rich_text/paragraph 字段永不触发状态流转，返回 {skipped:true}', async () => {
    if (!consumeVerdictFromNotion) {
      expect.fail('consumeVerdictFromNotion 未实现');
    }
    // 构造只有 paragraph/rich_text 字段，无 checkbox 字段的页面
    const page = {
      id: 'notion-page-prose',
      object: 'page',
      properties: {
        '状态描述': {
          type: 'rich_text',
          rich_text: [{ plain_text: '已拍板，请放行' }],
        },
      },
    };
    const result = await consumeVerdictFromNotion(pool, page);
    expect(result.skipped).toBe(true);
    // 确保没有 tasks.status 更新
    const statusUpdate = pool.query.mock.calls.filter(c =>
      String(c[0]).includes('status') && String(c[0]).includes('UPDATE')
    );
    expect(statusUpdate.length).toBe(0);
  });

  it('[INV-3] review_required=true 且 放行=false 时，跳过执行，返回 {skipped:true, reason:"awaiting_approval"}', async () => {
    if (!consumeVerdictFromNotion) {
      expect.fail('consumeVerdictFromNotion 未实现');
    }
    const page = makeVerdictPage({ approved: false, reviewRequired: true });
    const result = await consumeVerdictFromNotion(pool, page);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('awaiting_approval');
    // 不应修改 task status
    const statusUpdate = pool.query.mock.calls.filter(c =>
      String(c[0]).includes('completed') || String(c[0]).includes('cancelled')
    );
    expect(statusUpdate.length).toBe(0);
  });

  it('[INV-4] 已消费（consumed_at NOT NULL）时重复调用返回 {skipped:true, reason:"already_consumed"}', async () => {
    if (!consumeVerdictFromNotion) {
      expect.fail('consumeVerdictFromNotion 未实现');
    }
    // 模拟 captures.consumed_at 不为空
    pool.query.mockResolvedValue({
      rows: [{ id: 'cap-1', consumed_at: new Date().toISOString(), task_id: 'task-uuid-001' }],
    });
    const page = makeVerdictPage({ approved: true });
    const result = await consumeVerdictFromNotion(pool, page);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('already_consumed');
    // 不应写 decisions
    const decisions = pool.query.mock.calls.filter(c => String(c[0]).includes('INSERT INTO decisions'));
    expect(decisions.length).toBe(0);
  });

  it('[REGRESSION] 放行只登记 start_requested，不得伪造 completed/in_progress', async () => {
    if (!consumeVerdictFromNotion) {
      expect.fail('consumeVerdictFromNotion 未实现');
    }
    // pool.query: 第1次查 captures（未消费），后续为写操作
    let callCount = 0;
    pool.query.mockImplementation(async (sql) => {
      callCount++;
      if (callCount === 1) {
        return { rows: [{ id: 'cap-1', consumed_at: null, task_id: 'task-uuid-001' }] };
      }
      return { rows: [] };
    });

    const page = makeVerdictPage({ approved: true });
    const result = await consumeVerdictFromNotion(pool, page);

    expect(result.skipped).not.toBe(true);
    expect(result.action).toBe('start_requested');

    const commandInsert = pool.query.mock.calls.find(c =>
      String(c[0]).includes('INSERT INTO projection_commands')
    );
    expect(commandInsert).toBeTruthy();

    const forgedTerminalUpdate = pool.query.mock.calls.find(c =>
      /UPDATE tasks SET status = '(completed|in_progress)'/.test(String(c[0]))
    );
    expect(forgedTerminalUpdate).toBeUndefined();

    // 断言 consumed_at 幂等锚更新
    const consumedUpdate = pool.query.mock.calls.find(c =>
      String(c[0]).includes('consumed_at')
    );
    expect(consumedUpdate).toBeTruthy();
  });

  it('[REGRESSION] 不放行登记 cancel_requested，由 Brain 状态机校验', async () => {
    if (!consumeVerdictFromNotion) {
      expect.fail('consumeVerdictFromNotion 未实现');
    }
    let callCount = 0;
    pool.query.mockImplementation(async (sql) => {
      callCount++;
      if (callCount === 1) {
        return { rows: [{ id: 'cap-1', consumed_at: null, task_id: 'task-uuid-001' }] };
      }
      return { rows: [] };
    });

    const page = makeVerdictPage({ rejected: true });
    const result = await consumeVerdictFromNotion(pool, page);

    expect(result.action).toBe('cancel_requested');
    expect(pool.query.mock.calls.some(c => String(c[0]).includes('INSERT INTO projection_commands'))).toBe(true);
    expect(pool.query.mock.calls.some(c => /UPDATE tasks SET status/.test(String(c[0])))).toBe(false);
    const consumedUpdate = pool.query.mock.calls.find(c =>
      String(c[0]).includes('consumed_at')
    );
    expect(consumedUpdate).toBeTruthy();
  });

  it('[REGRESSION] 批注登记 annotate_requested，不直接改 task', async () => {
    if (!consumeVerdictFromNotion) {
      expect.fail('consumeVerdictFromNotion 未实现');
    }
    let callCount = 0;
    pool.query.mockImplementation(async (sql) => {
      callCount++;
      if (callCount === 1) {
        return { rows: [{ id: 'cap-1', consumed_at: null, task_id: 'task-uuid-001' }] };
      }
      return { rows: [] };
    });

    const page = makeVerdictPage({ annotation: '请重新考虑第3点' });
    const result = await consumeVerdictFromNotion(pool, page);

    expect(result.action).toBe('annotate_requested');
    // 不应出现 completed 或 cancelled status 变更
    const statusChanges = pool.query.mock.calls.filter(c =>
      (String(c[0]).includes('completed') || String(c[0]).includes('cancelled')) &&
      String(c[0]).includes('UPDATE')
    );
    expect(statusChanges.length).toBe(0);
    expect(pool.query.mock.calls.some(c => String(c[0]).includes('INSERT INTO projection_commands'))).toBe(true);
    // consumed_at 应更新
    const consumedUpdate = pool.query.mock.calls.find(c =>
      String(c[0]).includes('consumed_at')
    );
    expect(consumedUpdate).toBeTruthy();
  });
});
