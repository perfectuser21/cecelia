/**
 * desire/index.js → 信号源测试（架构：所有信号接 L1，不走 suggestion）
 *
 * 覆盖：act/follow_up 仍直接创建任务；warn/propose 走 runExpression；
 *       任何 desire 类型都不再创建 suggestion
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock 设置 ──────────────────────────────────────────────

const mockRunPerception = vi.hoisted(() => vi.fn());
const mockRunMemory = vi.hoisted(() => vi.fn());
const mockRunReflection = vi.hoisted(() => vi.fn());
const mockRunDesireFormation = vi.hoisted(() => vi.fn());
const mockRunExpressionDecision = vi.hoisted(() => vi.fn());
const mockRunExpression = vi.hoisted(() => vi.fn());
const mockPublishDesireExpressed = vi.hoisted(() => vi.fn());

vi.mock('../desire/perception.js', () => ({
  runPerception: mockRunPerception,
}));

vi.mock('../desire/memory.js', () => ({
  runMemory: mockRunMemory,
}));

vi.mock('../desire/reflection.js', () => ({
  runReflection: mockRunReflection,
}));

vi.mock('../desire/desire-formation.js', () => ({
  runDesireFormation: mockRunDesireFormation,
}));

vi.mock('../desire/expression-decision.js', () => ({
  runExpressionDecision: mockRunExpressionDecision,
}));

vi.mock('../desire/expression.js', () => ({
  runExpression: mockRunExpression,
}));

vi.mock('../events/taskEvents.js', () => ({
  publishDesireExpressed: mockPublishDesireExpressed,
}));

// ── 导入被测模块 ──────────────────────────────────────────

import { runDesireSystem } from '../desire/index.js';

// ── 辅助函数 ──────────────────────────────────────────────

function makeDesire(type, overrides = {}) {
  return {
    id: `desire-${type}-001`,
    type,
    content: `${type} 欲望内容示例`,
    proposed_action: `执行 ${type} 行动`,
    urgency: 7,
    insight: '相关洞察',
    evidence: {},
    expires_at: new Date(Date.now() + 3600 * 1000),
    ...overrides,
  };
}

function makePool() {
  const queryMock = vi.fn().mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('trigger_source') && sql.includes('initiative_plan')) {
      return Promise.resolve({ rows: [] }); // 无活跃任务，允许创建
    }
    return Promise.resolve({ rows: [{ id: 'task-created-001' }] });
  });
  return { query: queryMock };
}

// ── 测试 ──────────────────────────────────────────────────

describe('desire → 直接创建任务（不走 suggestion）', () => {
  let pool;

  beforeEach(() => {
    vi.resetAllMocks();
    pool = makePool();

    mockRunPerception.mockResolvedValue([]);
    mockRunMemory.mockResolvedValue({ written: 0, total_importance: 0 });
    mockRunReflection.mockResolvedValue({ triggered: false });
    mockRunDesireFormation.mockResolvedValue({ created: false });
    mockRunExpressionDecision.mockResolvedValue(null);
    mockRunExpression.mockResolvedValue({ sent: true });
    mockPublishDesireExpressed.mockResolvedValue(undefined);
  });

  describe('DOD-4: act desire → 直接创建 initiative_plan 任务', () => {
    it('DOD-4: act desire 创建任务（不创建 suggestion）', async () => {
      const desire = makeDesire('act');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.85 });

      const result = await runDesireSystem(pool);
      await new Promise(r => setTimeout(r, 0));

      expect(result.expression.triggered).toBe(true);
      expect(result.expression.acted).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tasks'),
        expect.any(Array)
      );
    });

    it('DOD-4: act desire task 创建失败时，系统不崩溃', async () => {
      const desire = makeDesire('act');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.85 });
      pool.query.mockRejectedValueOnce(new Error('DB insert failed'));

      const result = await runDesireSystem(pool);

      expect(result.expression.triggered).toBe(true);
    });
  });

  describe('DOD-5: warn desire → runExpression（不创建 suggestion）', () => {
    it('DOD-5: warn desire 调用 runExpression 且不创建 suggestion', async () => {
      const desire = makeDesire('warn');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.75 });

      const result = await runDesireSystem(pool);
      await new Promise(r => setTimeout(r, 0));

      expect(mockRunExpression).toHaveBeenCalledWith(pool, desire);
      expect(result.expression.sent).toBe(true);
    });
  });

  describe('DOD-6: propose desire → runExpression（不创建 suggestion）', () => {
    it('DOD-6: propose desire 调用 runExpression 且不创建 suggestion', async () => {
      const desire = makeDesire('propose');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.70 });

      const result = await runDesireSystem(pool);
      await new Promise(r => setTimeout(r, 0));

      expect(mockRunExpression).toHaveBeenCalled();
      expect(result.expression.sent).toBe(true);
    });
  });

  describe('DOD-7: follow_up desire → 直接创建 review 任务', () => {
    it('DOD-7: follow_up desire 创建 review 任务', async () => {
      const desire = makeDesire('follow_up');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.80 });

      await runDesireSystem(pool);
      await new Promise(r => setTimeout(r, 0));

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tasks'),
        expect.any(Array)
      );
    });
  });

  describe('DOD-8: 主流程不被 desire 类型中断', () => {
    it('DOD-8: act desire 任务创建成功后返回正确结果', async () => {
      const desire = makeDesire('act');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.85 });

      const result = await runDesireSystem(pool);
      await new Promise(r => setTimeout(r, 0));

      expect(result.expression.triggered).toBe(true);
      expect(result.expression.acted).toBe(true);
      expect(result.expression.task_created).toBeDefined();
    });

    it('DOD-8: warn desire expression 正常返回', async () => {
      const desire = makeDesire('warn');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.75 });
      mockRunExpression.mockResolvedValue({ sent: true });

      const result = await runDesireSystem(pool);
      await new Promise(r => setTimeout(r, 0));

      expect(result.expression.sent).toBe(true);
    });
  });
});
