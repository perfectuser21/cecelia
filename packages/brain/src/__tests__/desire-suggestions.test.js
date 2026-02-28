/**
 * desire/index.js → suggestion 管道测试（PR-D: self_loop 渠道）
 *
 * 覆盖：DOD-4（act）、DOD-5（warn）、DOD-6（propose）、
 *       DOD-7（follow_up 不创建）、DOD-8（失败不阻塞）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock 设置 ──────────────────────────────────────────────

const mockCreateSuggestion = vi.hoisted(() => vi.fn());
const mockRunPerception = vi.hoisted(() => vi.fn());
const mockRunMemory = vi.hoisted(() => vi.fn());
const mockRunReflection = vi.hoisted(() => vi.fn());
const mockRunDesireFormation = vi.hoisted(() => vi.fn());
const mockRunExpressionDecision = vi.hoisted(() => vi.fn());
const mockRunExpression = vi.hoisted(() => vi.fn());
const mockPublishDesireExpressed = vi.hoisted(() => vi.fn());

vi.mock('../suggestion-triage.js', () => ({
  createSuggestion: mockCreateSuggestion,
}));

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
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ id: 'task-created-001' }] }),
  };
}

// ── 测试 ──────────────────────────────────────────────────

describe('desire → suggestion（PR-D: self_loop 渠道）', () => {
  let pool;

  beforeEach(() => {
    vi.resetAllMocks();
    pool = makePool();

    // 默认：感知/记忆/反思/欲望形成 都返回空/无触发
    mockRunPerception.mockResolvedValue([]);
    mockRunMemory.mockResolvedValue({ written: 0, total_importance: 0 });
    mockRunReflection.mockResolvedValue({ triggered: false });
    mockRunDesireFormation.mockResolvedValue({ created: false });
    mockRunExpressionDecision.mockResolvedValue(null); // 默认不触发
    mockRunExpression.mockResolvedValue({ sent: true });
    mockPublishDesireExpressed.mockResolvedValue(undefined);
    mockCreateSuggestion.mockResolvedValue({ id: 'sug-001', priority_score: 0.75 });
  });

  describe('DOD-4: act desire → createSuggestion', () => {
    it('DOD-4: act desire 创建 task 后，fire-and-forget 调用 createSuggestion', async () => {
      const desire = makeDesire('act');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.85 });

      await runDesireSystem(pool);

      // 等待 fire-and-forget 的 Promise 完成
      await new Promise(r => setTimeout(r, 0));

      expect(mockCreateSuggestion).toHaveBeenCalledWith(expect.objectContaining({
        source: 'desire_system',
        suggestion_type: 'desire_action',
        content: expect.stringContaining('act 欲望内容示例'),
      }));
    });

    it('DOD-4: act desire suggestion 包含 proposed_action', async () => {
      const desire = makeDesire('act');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.85 });

      await runDesireSystem(pool);
      await new Promise(r => setTimeout(r, 0));

      const call = mockCreateSuggestion.mock.calls[0][0];
      expect(call.content).toContain('执行 act 行动');
    });

    it('DOD-4: act desire task 创建失败时，createSuggestion 不被调用（task err 中断）', async () => {
      const desire = makeDesire('act');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.85 });
      // 任务创建失败
      pool.query.mockRejectedValueOnce(new Error('DB insert failed'));

      await runDesireSystem(pool);
      await new Promise(r => setTimeout(r, 0));

      // task 创建失败 → catch 块里没有 createSuggestion 调用
      expect(mockCreateSuggestion).not.toHaveBeenCalled();
    });
  });

  describe('DOD-5: warn desire → createSuggestion', () => {
    it('DOD-5: warn desire 表达后，fire-and-forget 调用 createSuggestion', async () => {
      const desire = makeDesire('warn');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.75 });

      await runDesireSystem(pool);
      await new Promise(r => setTimeout(r, 0));

      expect(mockCreateSuggestion).toHaveBeenCalledWith(expect.objectContaining({
        source: 'desire_system',
        suggestion_type: 'desire_action',
        content: expect.stringContaining('warn 欲望内容示例'),
      }));
    });

    it('DOD-5: warn desire 调用了 runExpression（原有流程不受影响）', async () => {
      const desire = makeDesire('warn');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.75 });

      await runDesireSystem(pool);

      expect(mockRunExpression).toHaveBeenCalledWith(pool, desire);
    });
  });

  describe('DOD-6: propose desire → createSuggestion', () => {
    it('DOD-6: propose desire 表达后，fire-and-forget 调用 createSuggestion', async () => {
      const desire = makeDesire('propose');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.70 });

      await runDesireSystem(pool);
      await new Promise(r => setTimeout(r, 0));

      expect(mockCreateSuggestion).toHaveBeenCalledWith(expect.objectContaining({
        source: 'desire_system',
        suggestion_type: 'desire_action',
        content: expect.stringContaining('propose 欲望内容示例'),
      }));
    });
  });

  describe('DOD-7: follow_up desire → 不创建 suggestion', () => {
    it('DOD-7: follow_up desire 创建 task 但不创建 suggestion', async () => {
      const desire = makeDesire('follow_up');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.80 });

      await runDesireSystem(pool);
      await new Promise(r => setTimeout(r, 0));

      // task 应该被创建（原有流程）
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tasks'),
        expect.any(Array)
      );
      // suggestion 不应该被创建
      expect(mockCreateSuggestion).not.toHaveBeenCalled();
    });

    it('DOD-7: inform desire 走表达层但不创建 suggestion', async () => {
      const desire = makeDesire('inform');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.65 });

      await runDesireSystem(pool);
      await new Promise(r => setTimeout(r, 0));

      expect(mockRunExpression).toHaveBeenCalled(); // 原有流程
      expect(mockCreateSuggestion).not.toHaveBeenCalled(); // 不创建 suggestion
    });
  });

  describe('DOD-8: createSuggestion 失败不阻塞原有流程', () => {
    it('DOD-8: act desire createSuggestion 失败，result.expression.task_created 仍正确', async () => {
      const desire = makeDesire('act');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.85 });
      mockCreateSuggestion.mockRejectedValueOnce(new Error('Suggestion DB error'));

      const result = await runDesireSystem(pool);
      await new Promise(r => setTimeout(r, 0));

      // 主流程返回正确（task created）
      expect(result.expression.triggered).toBe(true);
      expect(result.expression.acted).toBe(true);
      // task_created 字段存在（来自 pool.query returning id）
      expect(result.expression.task_created).toBeDefined();
    });

    it('DOD-8: warn desire createSuggestion 失败，runExpression 结果仍正确返回', async () => {
      const desire = makeDesire('warn');
      mockRunExpressionDecision.mockResolvedValue({ desire, score: 0.75 });
      mockCreateSuggestion.mockRejectedValueOnce(new Error('Suggestion DB error'));
      mockRunExpression.mockResolvedValue({ sent: true });

      const result = await runDesireSystem(pool);
      await new Promise(r => setTimeout(r, 0));

      expect(result.expression.sent).toBe(true); // 原有流程未受影响
    });
  });
});
