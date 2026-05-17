/**
 * cortex.js Build #4 单元测试
 * 验证 analyzeDeep 在 RCA 时注入跨任务同类失败模式（cross_task_failure_patterns）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock 外部依赖（vi.hoisted 确保在模块加载前初始化）───────────────────────

const { mockPool, mockCallLLM } = vi.hoisted(() => {
  const mockPool = { query: vi.fn() };
  const mockCallLLM = vi.fn();
  return { mockPool, mockCallLLM };
});

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../llm-caller.js', () => ({ callLLM: mockCallLLM }));
vi.mock('../thalamus.js', () => ({
  ACTION_WHITELIST: {
    request_human_review: { dangerous: false, description: '请求人工审查' },
    adjust_strategy: { dangerous: false, description: '调整策略' },
    record_learning: { dangerous: false, description: '记录学习' },
    create_rca_report: { dangerous: false, description: '创建 RCA 报告' },
  },
  validateDecision: vi.fn().mockReturnValue({ valid: true }),
  recordLLMError: vi.fn(),
  recordTokenUsage: vi.fn(),
}));
vi.mock('../learning.js', () => ({ searchRelevantLearnings: vi.fn().mockResolvedValue([]) }));
vi.mock('../self-model.js', () => ({ getSelfModel: vi.fn().mockResolvedValue({}) }));
vi.mock('../memory-utils.js', () => ({ generateL0Summary: vi.fn().mockResolvedValue('') }));
vi.mock('../cortex-quality.js', () => ({
  evaluateQualityInitial: vi.fn().mockResolvedValue({}),
  generateSimilarityHash: vi.fn().mockReturnValue('abc123'),
  checkShouldCreateRCA: vi.fn().mockResolvedValue({ should_create: true }),
}));
vi.mock('../policy-validator.js', () => ({ validatePolicyJson: vi.fn().mockReturnValue({ valid: true }) }));
vi.mock('../circuit-breaker.js', () => ({ recordFailure: vi.fn() }));

// 导入被测模块（必须在 vi.mock 之后）
import { analyzeDeep } from '../cortex.js';

// ─── 合法的最小 Cortex 决策 JSON ─────────────────────────────────────────────

const VALID_CORTEX_DECISION = JSON.stringify({
  level: 2,
  analysis: { root_cause: '测试根因', contributing_factors: [], impact_assessment: 'low' },
  actions: [],
  strategy_updates: [],
  learnings: [],
  rationale: '测试理由',
  confidence: 0.8,
  safety: true,
});

// ─── pool.query 路由器：按 SQL 关键词返回不同结果 ─────────────────────────────

function buildPoolQueryMock(failurePatternRows = []) {
  return vi.fn().mockImplementation((sql) => {
    const s = typeof sql === 'string' ? sql : '';
    // Build #4 跨任务失败模式查询（精确匹配 WHERE category）
    if (s.includes("category = 'failure_pattern'")) {
      return Promise.resolve({ rows: failurePatternRows });
    }
    if (s.includes('working_memory')) {
      return Promise.resolve({ rows: [] });
    }
    if (s.includes('decision_log')) {
      return Promise.resolve({ rows: [] });
    }
    if (s.includes('tasks_in_progress') || s.includes('recent_failures')) {
      return Promise.resolve({ rows: [{ tasks_in_progress: '0', recent_failures: '0', active_goals: '0' }] });
    }
    // cortex_analyses, learnings (其他查询)
    return Promise.resolve({ rows: [] });
  });
}

// 每个测试用唯一 task_type，确保反思熔断 hash 不同（阈值=2，同 hash 第2次即熔断）
let taskTypeCounter = 0;
function makeEvent() {
  taskTypeCounter += 1;
  return {
    type: 'rca_request',
    failed_task: { task_type: `dev_test_${taskTypeCounter}` },
    failure_history: [],
    timestamp: new Date().toISOString(),
  };
}

// ─── 测试 ─────────────────────────────────────────────────────────────────────

describe('cortex.js Build #4 — 跨任务失败模式注入', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLLM.mockResolvedValue({ text: VALID_CORTEX_DECISION });
  });

  it('有数据时：pool.query 被调用时携带 failure_pattern SQL', async () => {
    const patternRows = [
      { content: '第一次同类失败：超时', created_at: new Date('2026-03-10T10:00:00Z') },
      { content: '第二次同类失败：OOM', created_at: new Date('2026-03-09T10:00:00Z') },
    ];
    mockPool.query = buildPoolQueryMock(patternRows);

    await analyzeDeep(makeEvent(), null);

    const allCalls = mockPool.query.mock.calls.map(([sql]) => (typeof sql === 'string' ? sql : ''));
    const patternCall = allCalls.find(s => s.includes("category = 'failure_pattern'"));
    expect(patternCall).toBeDefined();
    expect(patternCall).toContain('LIMIT 10');
  });

  it('有数据时：LLM prompt 包含 cross_task_failure_patterns 和 count', async () => {
    const patternRows = [
      { content: '历史失败模式A', created_at: new Date('2026-03-10T10:00:00Z') },
    ];
    mockPool.query = buildPoolQueryMock(patternRows);

    await analyzeDeep(makeEvent(), null);

    const promptArg = mockCallLLM.mock.calls[0]?.[1] ?? '';
    expect(promptArg).toContain('cross_task_failure_patterns');
    expect(promptArg).toContain('"count": 1');
    expect(promptArg).toContain('系统历史同类失败');
  });

  it('无数据时：注入 count=0 和 暂无历史同类失败记录', async () => {
    mockPool.query = buildPoolQueryMock([]);

    await analyzeDeep(makeEvent(), null);

    const promptArg = mockCallLLM.mock.calls[0]?.[1] ?? '';
    expect(promptArg).toContain('cross_task_failure_patterns');
    expect(promptArg).toContain('"count": 0');
    expect(promptArg).toContain('暂无历史同类失败记录');
  });

  it('数据库查询失败时：降级不抛出，analyzeDeep 正常返回', async () => {
    mockPool.query = vi.fn().mockImplementation((sql) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes("category = 'failure_pattern'")) {
        return Promise.reject(new Error('DB error'));
      }
      if (s.includes('working_memory')) return Promise.resolve({ rows: [] });
      if (s.includes('decision_log')) return Promise.resolve({ rows: [] });
      if (s.includes('tasks_in_progress') || s.includes('recent_failures')) {
        return Promise.resolve({ rows: [{ tasks_in_progress: '0', recent_failures: '0', active_goals: '0' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(analyzeDeep(makeEvent(), null)).resolves.toBeDefined();
  });
});
