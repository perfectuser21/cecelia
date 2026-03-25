import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js 避免真实数据库连接
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn()
  }
}));

// Mock thalamus: suggestion-dispatcher 现在通过丘脑创建任务
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn(),
  EVENT_TYPES: { SUGGESTION_READY: 'suggestion_ready' }
}));

// Mock actions.js: createTask 由丘脑决策驱动
vi.mock('../actions.js', () => ({
  createTask: vi.fn()
}));

// Mock domain-detector.js
vi.mock('../domain-detector.js', () => ({
  detectDomain: vi.fn().mockReturnValue({ domain: 'coding', owner_role: 'cto', confidence: 0.8 })
}));

import { dispatchPendingSuggestions } from '../suggestion-dispatcher.js';
import { processEvent as thalamusProcessEvent } from '../thalamus.js';
import { createTask } from '../actions.js';

function makeThalamusDecision(suggestionId = 'sug-1', score = 0.85) {
  return {
    level: 0,
    actions: [
      {
        type: 'create_task',
        params: {
          title: `[SUGGESTION_PLAN] 层级识别`,
          task_type: 'suggestion_plan',
          priority: 'P2',
          trigger_source: 'suggestion_dispatcher',
          payload: { suggestion_id: String(suggestionId), suggestion_score: score },
        }
      }
    ],
    rationale: 'test',
    confidence: 0.9,
  };
}

/**
 * 构造一个简化 mock pool（新架构不使用 client.connect/transaction）
 */
function buildMockPool({ candidates = [], inFlight = [] } = {}) {
  return {
    query: vi.fn(async (sql) => {
      if (sql.includes("status = 'pending'") && sql.includes('priority_score >= 0.68')) {
        return { rows: candidates };
      }
      if (sql.includes("task_type = 'suggestion_plan'") && sql.includes('queued')) {
        return { rows: inFlight };
      }
      if (sql.includes('UPDATE suggestions')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    }),
  };
}

describe('suggestion-dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认：丘脑返回 create_task 决策
    thalamusProcessEvent.mockResolvedValue(makeThalamusDecision());
    createTask.mockResolvedValue({
      success: true,
      task: { id: 'task-123' },
      deduplicated: false,
    });
  });

  it('D1: 没有 pending suggestions 时返回 0', async () => {
    const pool = buildMockPool({ candidates: [] });
    const result = await dispatchPendingSuggestions(pool, 2);
    expect(result).toBe(0);
  });

  it('D1: 创建 suggestion_plan 任务并返回数量', async () => {
    const candidates = [
      { id: 'sug-1', content: '优化任务调度性能', priority_score: 0.85, source: 'agent_feedback', agent_id: null },
    ];
    const pool = buildMockPool({ candidates });
    thalamusProcessEvent.mockResolvedValue(makeThalamusDecision('sug-1', 0.85));

    const result = await dispatchPendingSuggestions(pool, 2);
    expect(result).toBe(1);

    // 验证丘脑被调用
    expect(thalamusProcessEvent).toHaveBeenCalledOnce();
    expect(createTask).toHaveBeenCalledOnce();

    // 验证 payload 包含 suggestion_id 和 suggestion_score
    const createTaskParams = createTask.mock.calls[0][0];
    expect(createTaskParams.payload.suggestion_id).toBe('sug-1');
    expect(createTaskParams.payload.suggestion_score).toBe(0.85);
  });

  it('D1: suggestion.status 改为 in_progress', async () => {
    const candidates = [
      { id: 'sug-2', content: '建议新增 KR 监控', priority_score: 0.9, source: 'reflection', agent_id: null },
    ];
    const pool = buildMockPool({ candidates });

    await dispatchPendingSuggestions(pool, 2);

    // 验证 UPDATE suggestions SET status = 'in_progress'
    const updateCall = pool.query.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('UPDATE suggestions')
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall[1][0]).toBe('sug-2');
  });

  it('D1: 去重——已有 in_progress 任务的 suggestion 不重复创建', async () => {
    const candidates = [
      { id: 'sug-3', content: '重复建议', priority_score: 0.95, source: 'agent_feedback', agent_id: null },
    ];
    const inFlight = [{ suggestion_id: 'sug-3' }]; // sug-3 已在处理中
    const pool = buildMockPool({ candidates, inFlight });

    const result = await dispatchPendingSuggestions(pool, 2);
    expect(result).toBe(0);
    expect(thalamusProcessEvent).not.toHaveBeenCalled();
  });

  it('D1: 最多处理 limit 条', async () => {
    const candidates = [
      { id: 'sug-4', content: '建议 4', priority_score: 0.95, source: 'agent', agent_id: null },
      { id: 'sug-5', content: '建议 5', priority_score: 0.90, source: 'agent', agent_id: null },
      { id: 'sug-6', content: '建议 6', priority_score: 0.85, source: 'agent', agent_id: null },
    ];
    const pool = buildMockPool({ candidates });

    const result = await dispatchPendingSuggestions(pool, 2); // limit=2
    expect(result).toBe(2); // 只处理前 2 条
    expect(thalamusProcessEvent).toHaveBeenCalledTimes(2);
  });

  it('D1: 单个任务失败不影响其他任务', async () => {
    const candidates = [
      { id: 'sug-7', content: '会失败的建议', priority_score: 0.9, source: null, agent_id: null },
      { id: 'sug-8', content: '正常建议', priority_score: 0.85, source: null, agent_id: null },
    ];
    const pool = buildMockPool({ candidates });

    let callCount = 0;
    thalamusProcessEvent.mockImplementation(async (event) => {
      callCount++;
      if (callCount === 1) throw new Error('模拟丘脑第一次失败');
      return makeThalamusDecision(event.suggestion_id);
    });

    const result = await dispatchPendingSuggestions(pool, 2);
    // 第一条失败，第二条成功 → 返回 1
    expect(result).toBe(1);
  });
});
