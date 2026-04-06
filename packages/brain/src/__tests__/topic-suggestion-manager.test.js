/**
 * topic-suggestion-manager.js 单元测试
 * 覆盖 saveSuggestions, autoPromoteSuggestions, getActiveSuggestions
 * DB 操作全部通过 vi.mock 隔离
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js pool（topic-suggestion-manager.js 在模块级导入 pool）
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

let saveSuggestions, getActiveSuggestions, autoPromoteSuggestions, approveSuggestion, rejectSuggestion;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const mod = await import('../topic-suggestion-manager.js');
  saveSuggestions = mod.saveSuggestions;
  getActiveSuggestions = mod.getActiveSuggestions;
  autoPromoteSuggestions = mod.autoPromoteSuggestions;
  approveSuggestion = mod.approveSuggestion;
  rejectSuggestion = mod.rejectSuggestion;
});

// ─── 工具 ──────────────────────────────────────────────────────────────────────

function makeTopic(overrides = {}) {
  return {
    keyword: '一人公司AI提效',
    content_type: 'solo-company-case',
    title_candidates: ['标题A', '标题B', '标题C'],
    hook: '每天节省3小时，你需要这套AI工作流',
    why_hot: '与企业主痛点高度吻合',
    priority_score: 0.85,
    ...overrides,
  };
}

// ─── saveSuggestions ──────────────────────────────────────────────────────────

describe('saveSuggestions', () => {
  it('空数组时直接返回 0', async () => {
    const count = await saveSuggestions({}, []);
    expect(count).toBe(0);
  });

  it('按 priority_score 排序后取 TOP 5', async () => {
    const topics = Array.from({ length: 8 }, (_, i) =>
      makeTopic({ keyword: `关键词${i}`, priority_score: i * 0.1 })
    );
    mockQuery.mockResolvedValue({ rowCount: 1 });
    const dbPool = { query: mockQuery };

    await saveSuggestions(dbPool, topics);

    // 最多调 5 次 INSERT
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it('INSERT 包含正确字段', async () => {
    const topic = makeTopic();
    mockQuery.mockResolvedValue({ rowCount: 1 });
    const dbPool = { query: mockQuery };

    await saveSuggestions(dbPool, [topic], '2026-04-06');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('topic_suggestions');
    expect(params[0]).toBe('2026-04-06');
    expect(params[1]).toBe('一人公司AI提效');
    expect(params[2]).toBe('solo-company-case');
    expect(params[6]).toBeCloseTo(0.85);
  });

  it('INSERT 失败时不抛出，返回 0', async () => {
    mockQuery.mockRejectedValue(new Error('DB 连接失败'));
    const dbPool = { query: mockQuery };

    const count = await saveSuggestions(dbPool, [makeTopic()]);
    expect(count).toBe(0);
  });

  it('rowCount=0 时（ON CONFLICT DO NOTHING）不计入 saved', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0 });
    const dbPool = { query: mockQuery };

    const count = await saveSuggestions(dbPool, [makeTopic()]);
    expect(count).toBe(0);
  });
});

// ─── autoPromoteSuggestions ───────────────────────────────────────────────────

describe('autoPromoteSuggestions', () => {
  it('无待晋级选题时返回 0', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const dbPool = { query: mockQuery };

    const count = await autoPromoteSuggestions(dbPool);
    expect(count).toBe(0);
  });

  it('晋级选题时创建 content-pipeline task 并更新状态', async () => {
    const pendingSuggestion = {
      id: 'sug-001',
      keyword: '待晋级选题',
      content_type: 'solo-company-case',
      title_candidates: [],
      hook: '',
      why_hot: '',
      priority_score: 0.7,
      selected_date: '2026-04-06',
    };

    // 第1次 query: SELECT pending → 返回1条
    // 第2次 query: INSERT tasks → 返回新 task id
    // 第3次 query: UPDATE topic_suggestions status = auto_promoted
    let callCount = 0;
    mockQuery.mockImplementation(async (sql) => {
      callCount++;
      if (sql.trim().startsWith('SELECT id')) return { rows: [pendingSuggestion] };
      if (sql.trim().startsWith('INSERT INTO tasks')) return { rows: [{ id: 'new-task-id' }] };
      return { rows: [] };
    });

    const dbPool = { query: mockQuery };
    const promoted = await autoPromoteSuggestions(dbPool);
    expect(promoted).toBe(1);
  });
});

// ─── approveSuggestion / rejectSuggestion ─────────────────────────────────────

describe('approveSuggestion', () => {
  it('选题不存在时返回 { ok: false }', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const dbPool = { query: mockQuery };

    const result = await approveSuggestion(dbPool, 'nonexistent-id');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('不存在');
  });

  it('选题状态不是 pending 时返回错误', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'sug-1', status: 'approved', keyword: '已审批', selected_date: '2026-04-06' }],
    });
    const dbPool = { query: mockQuery };

    const result = await approveSuggestion(dbPool, 'sug-1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('approved');
  });
});

describe('rejectSuggestion', () => {
  it('选题不存在时返回 { ok: false }', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const dbPool = { query: mockQuery };

    const result = await rejectSuggestion(dbPool, 'nonexistent-id');
    expect(result.ok).toBe(false);
  });

  it('选题状态不是 pending 时返回错误', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'sug-2', status: 'rejected', keyword: '已拒绝', selected_date: '2026-04-06' }],
    });
    const dbPool = { query: mockQuery };

    const result = await rejectSuggestion(dbPool, 'sug-2');
    expect(result.ok).toBe(false);
  });
});
