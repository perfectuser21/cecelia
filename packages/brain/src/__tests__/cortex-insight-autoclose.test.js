/**
 * cortex.js Insight → Task 自动闭合机制测试
 * 验证：
 * 1. 有代码修复信号的 insight 自动创建 dev task
 * 2. 无代码修复信号的 insight 不创建 task
 * 3. 同一 learning_id 已有 task 时不重复创建（去重）
 * 4. 创建 task 后标记 applied=true
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock 外部依赖 ────────────────────────────────────────────────────────────

const { mockPool, mockCreateTask } = vi.hoisted(() => {
  const mockPool = { query: vi.fn() };
  const mockCreateTask = vi.fn();
  return { mockPool, mockCreateTask };
});

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../actions.js', () => ({ createTask: mockCreateTask }));
vi.mock('../thalamus.js', () => ({
  ACTION_WHITELIST: {},
  validateDecision: vi.fn().mockReturnValue({ valid: true }),
  recordLLMError: vi.fn(),
  recordTokenUsage: vi.fn(),
}));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn() }));
vi.mock('../learning.js', () => ({ searchRelevantLearnings: vi.fn().mockResolvedValue([]) }));
vi.mock('../self-model.js', () => ({ getSelfModel: vi.fn().mockResolvedValue({}) }));
vi.mock('../memory-utils.js', () => ({ generateL0Summary: vi.fn().mockReturnValue('summary') }));
vi.mock('../cortex-quality.js', () => ({
  evaluateQualityInitial: vi.fn().mockResolvedValue({}),
  generateSimilarityHash: vi.fn().mockReturnValue('abc123'),
  checkShouldCreateRCA: vi.fn().mockResolvedValue({ should_create: false }),
}));
vi.mock('../policy-validator.js', () => ({ validatePolicyJson: vi.fn().mockReturnValue({ valid: true }) }));
vi.mock('../circuit-breaker.js', () => ({ recordFailure: vi.fn() }));

import { hasCodeFixSignal, maybeCreateInsightTask } from '../cortex.js';

// ─── hasCodeFixSignal 测试 ────────────────────────────────────────────────────

describe('hasCodeFixSignal', () => {
  it('英文 bug 关键词返回 true', () => {
    expect(hasCodeFixSignal('This is a bug in the scheduler')).toBe(true);
  });

  it('中文 修复 关键词返回 true', () => {
    expect(hasCodeFixSignal('需要修复 tick 循环里的问题')).toBe(true);
  });

  it('中文 代码 关键词返回 true', () => {
    expect(hasCodeFixSignal('代码里有一个潜在风险')).toBe(true);
  });

  it('英文 refactor / 重构 关键词返回 true', () => {
    expect(hasCodeFixSignal('应该重构 planner 模块')).toBe(true);
  });

  it('无修复信号的内容返回 false', () => {
    expect(hasCodeFixSignal('今日派发了 10 个任务，系统运行正常')).toBe(false);
  });

  it('空字符串返回 false', () => {
    expect(hasCodeFixSignal('')).toBe(false);
  });
});

// ─── maybeCreateInsightTask 测试 ─────────────────────────────────────────────

describe('maybeCreateInsightTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有代码修复信号时创建 dev task 并标记 applied=true', async () => {
    const learningId = 'learn-uuid-001';
    const content = '发现 bug：planner 在高负载下会崩溃';
    const event = { type: 'systemic_failure' };

    // 去重查询：无重复
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // createTask 成功
    mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'task-001' } });
    // UPDATE learnings applied=true
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

    await maybeCreateInsightTask(learningId, content, event);

    // 应查询去重
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('insight_learning_id'),
      [learningId]
    );

    // 应调用 createTask
    expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      task_type: 'dev',
      trigger_source: 'cortex',
      payload: expect.objectContaining({
        insight_learning_id: learningId,
      }),
    }));

    // 应标记 applied=true
    const updateCall = mockPool.query.mock.calls[1];
    expect(updateCall[0]).toContain('applied = true');
    expect(updateCall[1]).toContain(learningId);
  });

  it('无代码修复信号时不创建 task', async () => {
    const learningId = 'learn-uuid-002';
    const content = '今日系统运行平稳，KR 进度正常';
    const event = { type: 'daily_summary' };

    await maybeCreateInsightTask(learningId, content, event);

    // 不应查询 tasks，不应调用 createTask
    expect(mockPool.query).not.toHaveBeenCalled();
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('已有对应 task（去重）时不重复创建', async () => {
    const learningId = 'learn-uuid-003';
    const content = '需要修复 memory 泄漏问题';
    const event = { type: 'rca_analysis' };

    // 去重查询：已存在
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-task-id' }] });

    await maybeCreateInsightTask(learningId, content, event);

    // 查了去重，但不应创建 task
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('createTask 失败时不抛出（静默错误）', async () => {
    const learningId = 'learn-uuid-004';
    const content = 'bug in executor.js crash loop';
    const event = { type: 'task_failed' };

    // 去重查询：无重复
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // createTask 失败
    mockCreateTask.mockRejectedValueOnce(new Error('DB connection lost'));

    // 不应抛出
    await expect(maybeCreateInsightTask(learningId, content, event)).resolves.toBeUndefined();
  });
});
