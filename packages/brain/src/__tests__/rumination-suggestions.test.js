/**
 * rumination.js → suggestion 管道测试（PR-D: self_loop 渠道）
 *
 * 覆盖：DOD-1（[ACTION:] → suggestion）、DOD-2（limit=2）、DOD-3（失败不影响消化）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock 设置（vi.hoisted 避免 hoisting 问题）──────────────

const mockQuery = vi.hoisted(() => vi.fn());
const mockCallLLM = vi.hoisted(() => vi.fn());
const mockBuildMemoryContext = vi.hoisted(() => vi.fn());
const mockQueryNotebook = vi.hoisted(() => vi.fn());
const mockCreateTask = vi.hoisted(() => vi.fn());
const mockUpdateSelfModel = vi.hoisted(() => vi.fn());
const mockCreateSuggestion = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

vi.mock('../llm-caller.js', () => ({
  callLLM: mockCallLLM,
}));

vi.mock('../memory-retriever.js', () => ({
  buildMemoryContext: mockBuildMemoryContext,
}));

vi.mock('../notebook-adapter.js', () => ({
  queryNotebook: mockQueryNotebook,
  addSource: vi.fn(),
}));

vi.mock('../actions.js', () => ({
  createTask: mockCreateTask,
}));

vi.mock('../self-model.js', () => ({
  updateSelfModel: mockUpdateSelfModel,
}));

vi.mock('../suggestion-triage.js', () => ({
  createSuggestion: mockCreateSuggestion,
}));

// ── 导入被测模块 ──────────────────────────────────────────

import { runRumination, _resetState } from '../rumination.js';

// ── Mock DB pool ──────────────────────────────────────────

function createMockPool() {
  return { query: mockQuery };
}

/**
 * 设置 mock 链（idle check + learnings + memory_stream INSERT + N×UPDATE）
 */
function setupIdleAndLearnings(learnings) {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ in_progress: '0', queued: '0' }] }) // idle check
    .mockResolvedValueOnce({ rows: learnings }); // learnings query

  if (learnings.length > 0) {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT memory_stream
    for (let i = 0; i < learnings.length; i++) {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE digested
    }
  }
}

// ── 测试 ──────────────────────────────────────────────────

describe('rumination → suggestion（PR-D: self_loop 渠道）', () => {
  let pool;

  beforeEach(() => {
    vi.resetAllMocks();
    _resetState();
    pool = createMockPool();
    mockBuildMemoryContext.mockResolvedValue({ block: '', meta: {} });
    mockQueryNotebook.mockResolvedValue({ ok: false });
    mockCreateTask.mockResolvedValue({ id: 'task-001' });
    mockUpdateSelfModel.mockResolvedValue(undefined);
    mockCreateSuggestion.mockResolvedValue({ id: 'sug-001', priority_score: 0.75 });
  });

  describe('DOD-1: [ACTION:] 洞察 → createSuggestion', () => {
    it('DOD-1: 有 [ACTION:] 标记时调用 createSuggestion(source=rumination, type=insight_action)', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '深度分析结论 [ACTION: 研究 React Server Components]',
      });

      setupIdleAndLearnings([
        { id: 'l1', title: 'RSC', content: 'React Server Components 介绍', category: 'tech' },
      ]);

      await runRumination(pool);

      expect(mockCreateSuggestion).toHaveBeenCalledWith(expect.objectContaining({
        source: 'rumination',
        suggestion_type: 'insight_action',
        content: expect.stringContaining('研究 React Server Components'),
      }));
    });

    it('DOD-1: suggestion content 包含行动标题和来源洞察', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '模式发现 [ACTION: 优化任务调度器]',
      });

      setupIdleAndLearnings([
        { id: 'l1', title: '调度优化', content: '任务调度器分析', category: 'tech' },
      ]);

      await runRumination(pool);

      const call = mockCreateSuggestion.mock.calls[0][0];
      expect(call.content).toContain('优化任务调度器');
      expect(call.content).toContain('模式发现');
    });

    it('DOD-1: 无 [ACTION:] 标记时不调用 createSuggestion', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '这是一条普通洞察，没有行动建议',
      });

      setupIdleAndLearnings([
        { id: 'l1', title: '普通知识', content: '内容', category: 'tech' },
      ]);

      await runRumination(pool);

      expect(mockCreateSuggestion).not.toHaveBeenCalled();
    });
  });

  describe('DOD-2: limit=2（最多 2 条 suggestion）', () => {
    it('DOD-2: 3 个 [ACTION:] 标记 → 只创建 2 条 suggestion', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '分析结论 [ACTION: 行动一] 另外 [ACTION: 行动二] 还有 [ACTION: 行动三]',
      });

      setupIdleAndLearnings([
        { id: 'l1', title: '前端趋势', content: '内容', category: 'tech' },
      ]);

      await runRumination(pool);

      // createTask 仍然调用 3 次（无 limit）
      expect(mockCreateTask).toHaveBeenCalledTimes(3);
      // createSuggestion 只调用 2 次（limit=2）
      expect(mockCreateSuggestion).toHaveBeenCalledTimes(2);
    });

    it('DOD-2: 恰好 2 个 [ACTION:] → 创建 2 条 suggestion', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '洞察 [ACTION: 第一行动] 以及 [ACTION: 第二行动]',
      });

      setupIdleAndLearnings([
        { id: 'l1', title: '测试', content: '内容', category: 'tech' },
      ]);

      await runRumination(pool);

      expect(mockCreateSuggestion).toHaveBeenCalledTimes(2);
    });

    it('DOD-2: 1 个 [ACTION:] → 创建 1 条 suggestion', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '洞察内容 [ACTION: 唯一行动]',
      });

      setupIdleAndLearnings([
        { id: 'l1', title: '测试', content: '内容', category: 'tech' },
      ]);

      await runRumination(pool);

      expect(mockCreateSuggestion).toHaveBeenCalledTimes(1);
    });
  });

  describe('DOD-3: createSuggestion 失败不影响消化流程', () => {
    it('DOD-3: createSuggestion 抛出异常时消化仍成功', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '洞察 [ACTION: 测试行动]',
      });
      mockCreateSuggestion.mockRejectedValueOnce(new Error('DB error'));

      setupIdleAndLearnings([
        { id: 'l1', title: '测试', content: '内容', category: 'tech' },
      ]);

      const result = await runRumination(pool);

      expect(result.digested).toBe(1);
      expect(result.insights).toHaveLength(1);
    });

    it('DOD-3: createTask 失败时 createSuggestion 仍可被调用', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '洞察 [ACTION: 测试行动]',
      });
      mockCreateTask.mockRejectedValueOnce(new Error('task DB error'));

      setupIdleAndLearnings([
        { id: 'l1', title: '测试', content: '内容', category: 'tech' },
      ]);

      await runRumination(pool);

      // 即使 createTask 失败，createSuggestion 也应该被尝试
      expect(mockCreateSuggestion).toHaveBeenCalledTimes(1);
    });
  });
});
