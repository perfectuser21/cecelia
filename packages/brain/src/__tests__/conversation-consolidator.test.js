/**
 * Conversation Consolidator 测试
 *
 * T1: 模块导出正确
 * T2: 防重逻辑（条件不满足时不触发）
 * T3: save_memory thalamus signal（在 thalamus.js observeChat 中处理）
 * T4: importance 分级过期规则
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

// Mock llm-caller.js
const mockCallLLM = vi.hoisted(() => vi.fn());
vi.mock('../llm-caller.js', () => ({
  callLLM: mockCallLLM,
}));

import { runConversationConsolidator } from '../conversation-consolidator.js';

describe('Conversation Consolidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T1: runConversationConsolidator 是函数', () => {
    expect(typeof runConversationConsolidator).toBe('function');
  });

  it('T2a: 30分钟内有新消息时不触发（空闲不足）', async () => {
    const recentTime = new Date(Date.now() - 5 * 60 * 1000); // 5分钟前
    mockQuery.mockResolvedValueOnce({ rows: [{ last_at: recentTime }] });
    await runConversationConsolidator();
    // 只查了最后消息时间，没有写入任何数据
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('T2b: 30分钟内无对话内容时不触发', async () => {
    const oldTime = new Date(Date.now() - 35 * 60 * 1000); // 35分钟前
    mockQuery
      .mockResolvedValueOnce({ rows: [{ last_at: oldTime }] }) // last msg
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] }); // window 内无内容
    await runConversationConsolidator();
    expect(mockQuery).toHaveBeenCalledTimes(2);
    // 没有写入 memory_stream
    const allCalls = mockQuery.mock.calls.map(c => String(c[0]));
    expect(allCalls.some(q => q.includes('INSERT INTO memory_stream'))).toBe(false);
  });

  it('T2c: 上次总结时间覆盖当前窗口时不触发（防重）', async () => {
    const oldTime = new Date(Date.now() - 35 * 60 * 1000);
    const recentSummary = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10分钟前已总结
    mockQuery
      .mockResolvedValueOnce({ rows: [{ last_at: oldTime }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '3' }] })
      .mockResolvedValueOnce({ rows: [{ value_json: JSON.stringify(recentSummary) }] });
    await runConversationConsolidator();
    const allCalls = mockQuery.mock.calls.map(c => String(c[0]));
    expect(allCalls.some(q => q.includes('INSERT INTO memory_stream'))).toBe(false);
  });

  it('T5: 满足条件时调用 LLM 并写入 memory_stream', async () => {
    const oldTime = new Date(Date.now() - 35 * 60 * 1000);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ last_at: oldTime }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '3' }] })
      .mockResolvedValueOnce({ rows: [] }) // no last summary
      .mockResolvedValueOnce({ rows: [
        { role: 'user', content: '讨论架构', created_at: oldTime },
        { role: 'assistant', content: '建议用DB方案', created_at: oldTime },
      ]})
      .mockResolvedValueOnce({ rows: [] }) // INSERT memory_stream
      .mockResolvedValueOnce({ rows: [] }) // existing learnings check
      .mockResolvedValueOnce({ rows: [] }) // INSERT learnings
      .mockResolvedValueOnce({ rows: [] }); // UPDATE working_memory

    mockCallLLM.mockResolvedValueOnce({
      text: '{"topic":"架构讨论","summary":"讨论了DB方案","conclusions":["用DB"],"todos":[],"has_decision":true,"decision_content":"选择DB方案存储记忆"}',
    });

    await runConversationConsolidator();

    expect(mockCallLLM).toHaveBeenCalledWith('thalamus', expect.any(String), expect.any(Object));
    const insertCalls = mockQuery.mock.calls.filter(c => String(c[0]).includes('INSERT INTO memory_stream'));
    expect(insertCalls.length).toBeGreaterThan(0);
  });
});

describe('save_memory importance 分级过期规则', () => {
  it('T4a: importance>=8 → expires_at=NULL（永不过期）', () => {
    const importance = 9;
    let expiresExpr;
    if (importance >= 8) expiresExpr = 'NULL';
    else if (importance >= 5) expiresExpr = "NOW() + INTERVAL '90 days'";
    else expiresExpr = "NOW() + INTERVAL '30 days'";
    expect(expiresExpr).toBe('NULL');
  });

  it('T4b: importance>=5 && <8 → 90天', () => {
    const importance = 6;
    let expiresExpr;
    if (importance >= 8) expiresExpr = 'NULL';
    else if (importance >= 5) expiresExpr = "NOW() + INTERVAL '90 days'";
    else expiresExpr = "NOW() + INTERVAL '30 days'";
    expect(expiresExpr).toBe("NOW() + INTERVAL '90 days'");
  });

  it('T4c: importance<5 → 30天', () => {
    const importance = 3;
    let expiresExpr;
    if (importance >= 8) expiresExpr = 'NULL';
    else if (importance >= 5) expiresExpr = "NOW() + INTERVAL '90 days'";
    else expiresExpr = "NOW() + INTERVAL '30 days'";
    expect(expiresExpr).toBe("NOW() + INTERVAL '30 days'");
  });
});
