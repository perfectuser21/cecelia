import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js 避免真实数据库连接
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn()
  }
}));

// Mock thalamus.js — suggestion-dispatcher 不再直接建任务，改走 processEvent
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn(async () => ({
    level: 0,
    actions: [{ type: 'log_event', params: { event_type: 'suggestion_dispatched' } }],
    rationale: '丘脑创建任务',
    confidence: 0.95,
    safety: false,
    _suggestion_dispatched: true,
  })),
  EVENT_TYPES: {
    SUGGESTION_READY: 'suggestion_ready',
  },
}));

import { dispatchPendingSuggestions } from '../suggestion-dispatcher.js';
import { processEvent } from '../thalamus.js';

/**
 * 构造一个完整的 mock pool，支持候选查询
 */
function buildMockPool({ candidates = [] } = {}) {
  return {
    query: vi.fn(async (sql) => {
      if (sql.includes("status = 'pending'") && sql.includes('priority_score >= 0.68')) {
        return { rows: candidates };
      }
      return { rows: [] };
    }),
    connect: vi.fn(),
  };
}

describe('suggestion-dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('D1: 没有 pending suggestions 时返回 0，不调用 processEvent', async () => {
    const pool = buildMockPool({ candidates: [] });
    const result = await dispatchPendingSuggestions(pool, 2);
    expect(result).toBe(0);
    expect(processEvent).not.toHaveBeenCalled();
  });

  it('D1: 调用 thalamus processEvent 并返回创建数量', async () => {
    const candidates = [
      { id: 'sug-1', content: '优化任务调度性能', priority_score: 0.85, source: 'agent_feedback', agent_id: null },
    ];
    const pool = buildMockPool({ candidates });

    const result = await dispatchPendingSuggestions(pool, 2);
    expect(result).toBe(1);
    expect(processEvent).toHaveBeenCalledTimes(1);

    // 验证 processEvent 接收正确的事件类型和字段
    const callArg = processEvent.mock.calls[0][0];
    expect(callArg.type).toBe('suggestion_ready');
    expect(callArg.suggestion_id).toBe('sug-1');
    expect(callArg.priority_score).toBe(0.85);
    expect(callArg.task_title).toBeDefined();
    expect(callArg.task_description).toBeDefined();
  });

  it('D1: 丘脑跳过（_suggestion_dispatched=false）时不计入 created', async () => {
    processEvent.mockResolvedValueOnce({
      level: 0,
      actions: [{ type: 'no_action', params: {} }],
      rationale: '去重：已有处理中任务',
      confidence: 1.0,
      safety: false,
      _suggestion_dispatched: false,
    });

    const candidates = [
      { id: 'sug-2', content: '重复建议', priority_score: 0.95, source: 'rumination', agent_id: null },
    ];
    const pool = buildMockPool({ candidates });

    const result = await dispatchPendingSuggestions(pool, 2);
    expect(result).toBe(0);
    expect(processEvent).toHaveBeenCalledTimes(1);
  });

  it('D1: 最多处理 limit 条', async () => {
    const candidates = [
      { id: 'sug-3', content: '建议3', priority_score: 0.95, source: 'agent', agent_id: null },
      { id: 'sug-4', content: '建议4', priority_score: 0.90, source: 'agent', agent_id: null },
      { id: 'sug-5', content: '建议5', priority_score: 0.85, source: 'agent', agent_id: null },
    ];
    const pool = buildMockPool({ candidates });

    const result = await dispatchPendingSuggestions(pool, 2); // limit=2
    expect(result).toBe(2);
    expect(processEvent).toHaveBeenCalledTimes(2);
  });

  it('D1: 单个 processEvent 失败不影响后续处理', async () => {
    processEvent
      .mockRejectedValueOnce(new Error('模拟 thalamus 失败'))
      .mockResolvedValueOnce({
        level: 0,
        actions: [{ type: 'log_event', params: { event_type: 'suggestion_dispatched' } }],
        rationale: '创建成功',
        confidence: 0.95,
        safety: false,
        _suggestion_dispatched: true,
      });

    const candidates = [
      { id: 'sug-6', content: '会失败的建议', priority_score: 0.9, source: null, agent_id: null },
      { id: 'sug-7', content: '正常建议', priority_score: 0.85, source: null, agent_id: null },
    ];
    const pool = buildMockPool({ candidates });

    const result = await dispatchPendingSuggestions(pool, 2);
    // 第一条失败，第二条成功 → 返回 1
    expect(result).toBe(1);
  });

  it('D1: task_description 包含 Layer 层级信息', async () => {
    const candidates = [
      { id: 'sug-8', content: '建议新增功能', priority_score: 0.8, source: 'test', agent_id: null },
    ];
    const pool = buildMockPool({ candidates });

    await dispatchPendingSuggestions(pool, 1);

    const callArg = processEvent.mock.calls[0][0];
    expect(callArg.task_description).toContain('Layer 3 KR');
    expect(callArg.task_description).toContain('Layer 7 Task/Pipeline');
  });
});
