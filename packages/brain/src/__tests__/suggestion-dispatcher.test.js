import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js 避免真实数据库连接
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn()
  }
}));

import { dispatchPendingSuggestions } from '../suggestion-dispatcher.js';

/**
 * 构造一个完整的 mock pool，支持 query + connect/transaction
 */
function buildMockPool({
  candidates = [],
  inFlight = [],
  insertedTaskId = 'task-123'
} = {}) {
  const client = {
    query: vi.fn(async (sql, params) => {
      if (sql.trim().startsWith('BEGIN') || sql.trim().startsWith('COMMIT') || sql.trim().startsWith('ROLLBACK')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO tasks')) {
        return { rows: [{ id: insertedTaskId }] };
      }
      if (sql.includes('UPDATE suggestions')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    }),
    release: vi.fn()
  };

  return {
    query: vi.fn(async (sql, params) => {
      // Candidates query
      if (sql.includes("status = 'pending'") && sql.includes('priority_score >= 0.68')) {
        return { rows: candidates };
      }
      // In-flight dedup query
      if (sql.includes("task_type = 'suggestion_plan'") && sql.includes('queued')) {
        return { rows: inFlight };
      }
      return { rows: [] };
    }),
    connect: vi.fn(async () => client),
    _client: client
  };
}

describe('suggestion-dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const result = await dispatchPendingSuggestions(pool, 2);
    expect(result).toBe(1);

    // 验证 INSERT 被调用
    const insertCall = pool._client.query.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeTruthy();

    // 验证 payload 包含 suggestion_id
    const payload = JSON.parse(insertCall[1][2]);
    expect(payload.suggestion_id).toBe('sug-1');
    expect(payload.suggestion_score).toBe(0.85); // priority_score 值
  });

  it('D1: suggestion.status 改为 in_progress', async () => {
    const candidates = [
      { id: 'sug-2', content: '建议新增 KR 监控', priority_score: 0.9, source: 'reflection', agent_id: null },
    ];
    const pool = buildMockPool({ candidates });

    await dispatchPendingSuggestions(pool, 2);

    // 验证 UPDATE suggestions SET status = 'in_progress'
    const updateCall = pool._client.query.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('UPDATE suggestions')
    );
    expect(updateCall).toBeTruthy();
    // 第一个参数是 suggestion id
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
  });

  it('D1: 单个任务失败不影响其他任务', async () => {
    const candidates = [
      { id: 'sug-7', content: '会失败的建议', priority_score: 0.9, source: null, agent_id: null },
      { id: 'sug-8', content: '正常建议', priority_score: 0.85, source: null, agent_id: null },
    ];

    let callCount = 0;
    const client = {
      query: vi.fn(async (sql) => {
        if (sql.trim().startsWith('BEGIN')) {
          callCount++;
          if (callCount === 1) throw new Error('模拟第一次事务失败');
          return { rows: [] };
        }
        if (sql.includes('COMMIT') || sql.includes('ROLLBACK')) return { rows: [] };
        if (sql.includes('INSERT INTO tasks')) return { rows: [{ id: 'task-new' }] };
        if (sql.includes('UPDATE suggestions')) return { rows: [], rowCount: 1 };
        return { rows: [] };
      }),
      release: vi.fn()
    };

    const pool = {
      query: vi.fn(async (sql) => {
        if (sql.includes("status = 'pending'")) return { rows: candidates };
        if (sql.includes("task_type = 'suggestion_plan'")) return { rows: [] };
        return { rows: [] };
      }),
      connect: vi.fn(async () => client)
    };

    const result = await dispatchPendingSuggestions(pool, 2);
    // 第一条失败，第二条成功 → 返回 1
    expect(result).toBe(1);
  });
});
