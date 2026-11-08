/**
 * Cecelia 欲望系统（Desire System）测试
 *
 * DoD 覆盖: D7 表达/通知隔离边界
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 统一 LLM 调用层 — 所有 desire 子模块现在通过 callLLM 调用
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({ text: '5', model: 'test', provider: 'test', elapsed_ms: 10 }),
}));

// Fail before any real network or shared database boundary can escape this suite.
const outbound = vi.hoisted(() => ({
  fetch: vi.fn(() => { throw new Error('owned fixture forbids network'); }),
  receipt: vi.fn(() => { throw new Error('owned fixture forbids receipts'); }),
  query: vi.fn(() => { throw new Error('owned fixture forbids shared DB'); }),
}));
vi.mock('../receipt-collector.js', () => ({
  recordActionReceipt: outbound.receipt,
  resolveActionReceipt: outbound.receipt,
}));
vi.mock('../db.js', () => ({ default: { query: outbound.query } }));
vi.mock('../notifier.js', () => ({ sendFeishu: vi.fn().mockResolvedValue(true) }));

// ============================================================
// D7: 表达层测试
// ============================================================

describe('Layer 6: 表达层（Expression）', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('FEISHU_BOT_WEBHOOK', 'https://owned-notification.invalid/webhook');
    vi.stubEnv('BRAIN_MUTED', 'false');
    vi.stubGlobal('fetch', outbound.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    expect({
      fetch: outbound.fetch.mock.calls.length,
      receipt: outbound.receipt.mock.calls.length,
      sharedDb: outbound.query.mock.calls.length,
    }).toEqual({ fetch: 0, receipt: 0, sharedDb: 0 });
  });

  it('D7: runExpression 更新 last_expression_at 和 desire 状态', async () => {
    // mock callLLM 返回格式化消息
    const { callLLM } = await import('../llm-caller.js');
    callLLM.mockResolvedValue({
      text: '**⚠️ 预警**\n\n**观察**：任务失败率上升\n\n**判断**：需要关注\n\n**建议**：检查 executor 日志',
      model: 'test', provider: 'test', elapsed_ms: 10
    });

    const upsertedKeys = [];
    const updatedStatuses = [];

    const mockPool = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (sql.includes('INSERT INTO working_memory') && Array.isArray(params)) {
          upsertedKeys.push({ key: params[0], val: params[1] });
        }
        if (sql.includes('UPDATE desires SET status')) {
          updatedStatuses.push(params);
        }
        return { rows: [] };
      })
    };

    const { runExpression } = await import('../desire/expression.js');
    const desire = {
      id: 'test-desire-1',
      type: 'warn',
      content: '任务失败率上升',
      insight: '失败率超过 30%',
      proposed_action: '检查 executor 日志',
      urgency: 8
    };

    const result = await runExpression(mockPool, desire);
    const { sendFeishu } = await import('../notifier.js');
    expect(vi.isMockFunction(sendFeishu)).toBe(true);
    expect(sendFeishu).toHaveBeenCalledTimes(1);
    expect(sendFeishu).toHaveBeenCalledWith('**⚠️ 预警**\n\n**观察**：任务失败率上升\n\n**判断**：需要关注\n\n**建议**：检查 executor 日志');
    expect(result.message).toBe('**⚠️ 预警**\n\n**观察**：任务失败率上升\n\n**判断**：需要关注\n\n**建议**：检查 executor 日志');
    expect(result.sent).toBe(true);

    // last_expression_at 应该被更新（从 last_feishu_at 改名）
    const exprUpdate = upsertedKeys.find(k => k.key === 'last_expression_at');
    expect(exprUpdate).toBeDefined();
    expect(typeof exprUpdate.val).toBe('string'); // ISO 时间字符串

    // desire 状态应该更新为 expressed
    expect(updatedStatuses).toEqual([[desire.id]]);
  });

  it('D7: 非紧急表达仍更新状态但不调用通知', async () => {
    const { callLLM } = await import('../llm-caller.js');
    callLLM.mockResolvedValue({ text: 'owned routine message' });
    const { sendFeishu } = await import('../notifier.js');
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const { runExpression } = await import('../desire/expression.js');
    const desire = { id: 'owned-routine', type: 'inform', content: 'routine', urgency: 5 };
    const result = await runExpression(pool, desire);
    expect(vi.isMockFunction(sendFeishu)).toBe(true);
    expect(sendFeishu).not.toHaveBeenCalled();
    expect(result.message).toBe('owned routine message');
    expect(pool.query).toHaveBeenCalledWith("UPDATE desires SET status = 'expressed' WHERE id = $1", [desire.id]);
  });
});
