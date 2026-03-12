/**
 * cortex_insight_autocreate — insight → dev task 自动闭合机制测试
 * 覆盖：
 *   - hasCodeFixSignal 关键词检测
 *   - autoCreateTaskFromInsight: 有代码信号 → 创建 task + applied=true
 *   - autoCreateTaskFromInsight: 无代码信号 → 跳过
 *   - autoCreateTaskFromInsight: learning_id 已有 task → 去重，不重复创建
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock 外部依赖（vi.hoisted 确保在模块加载前初始化）───────────────────────
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
vi.mock('../memory-utils.js', () => ({ generateL0Summary: vi.fn().mockReturnValue('') }));
vi.mock('../cortex-quality.js', () => ({
  evaluateQualityInitial: vi.fn().mockResolvedValue({}),
  generateSimilarityHash: vi.fn().mockReturnValue('abc123'),
  checkShouldCreateRCA: vi.fn().mockResolvedValue({ should_create: true }),
}));
vi.mock('../policy-validator.js', () => ({ validatePolicyJson: vi.fn().mockReturnValue({ valid: true }) }));
vi.mock('../circuit-breaker.js', () => ({ recordFailure: vi.fn() }));

import { autoCreateTaskFromInsight, hasCodeFixSignal } from '../cortex.js';

// ─── 测试 ──────────────────────────────────────────────────────────────────────

describe('hasCodeFixSignal', () => {
  it('英文 fix 信号', () => {
    expect(hasCodeFixSignal('We need to fix the broken login flow')).toBe(true);
  });

  it('中文修复信号', () => {
    expect(hasCodeFixSignal('需要修复这个错误')).toBe(true);
  });

  it('implement 信号', () => {
    expect(hasCodeFixSignal('implement the missing retry logic')).toBe(true);
  });

  it('无代码信号 → false', () => {
    expect(hasCodeFixSignal('The system performance looks good overall')).toBe(false);
  });

  it('空字符串 → false', () => {
    expect(hasCodeFixSignal('')).toBe(false);
  });
});

describe('autoCreateTaskFromInsight', () => {
  const LEARNING_ID = 'learn-abc-001';

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('有代码修复信号 → 创建 dev task + applied=true', async () => {
    mockCreateTask.mockResolvedValue({ success: true, task: { id: 'task-001' }, deduplicated: false });
    mockPool.query.mockResolvedValue({ rows: [] });

    await autoCreateTaskFromInsight(
      LEARNING_ID,
      'Cortex Insight: fix memory leak in executor',
      'We need to fix the memory leak in executor.js to prevent OOM crashes'
    );

    // createTask 应被调用一次
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateTask.mock.calls[0][0];
    expect(callArgs.learning_id).toBe(LEARNING_ID);
    expect(callArgs.task_type).toBe('dev');
    expect(callArgs.trigger_source).toBe('cortex');

    // applied=true 应被写入
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE learnings SET applied = true'),
      [LEARNING_ID]
    );
  });

  it('无代码修复信号 → 不创建 task', async () => {
    await autoCreateTaskFromInsight(
      LEARNING_ID,
      'Cortex Insight: system is stable',
      'The overall system performance looks healthy and no concerns'
    );

    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('learning_id 已有 task → 去重，不重复创建，不更新 applied', async () => {
    mockCreateTask.mockResolvedValue({
      success: true,
      task: { id: 'task-existing' },
      deduplicated: true,
    });

    await autoCreateTaskFromInsight(
      LEARNING_ID,
      'Cortex Insight: fix broken retry logic',
      'We need to implement proper retry logic for failed tasks'
    );

    // createTask 被调用（内部去重由 actions.js 处理）
    expect(mockCreateTask).toHaveBeenCalledTimes(1);

    // 因为 deduplicated=true，applied 不应被更新
    const updateCalls = mockPool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('UPDATE learnings')
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('createTask 抛错 → 不让主流程崩溃', async () => {
    mockCreateTask.mockRejectedValue(new Error('DB connection lost'));

    // 不应 throw
    await expect(
      autoCreateTaskFromInsight(
        LEARNING_ID,
        'Cortex Insight: add missing validation',
        'We should add input validation to prevent data corruption'
      )
    ).resolves.toBeUndefined();
  });
});
