/**
 * rumination.js → L1 丘脑信号测试
 *
 * 覆盖：DOD-1（[ACTION:] → RUMINATION_RESULT 事件含 actions）、
 *       DOD-2（processEvent 被调用，不再直接创建任务/suggestion）、
 *       DOD-3（processEvent 失败不影响消化流程）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock 设置（vi.hoisted 避免 hoisting 问题）──────────────

const mockQuery = vi.hoisted(() => vi.fn());
const mockCallLLM = vi.hoisted(() => vi.fn());
const mockBuildMemoryContext = vi.hoisted(() => vi.fn());
const mockQueryNotebook = vi.hoisted(() => vi.fn());
const mockAddTextSource = vi.hoisted(() => vi.fn());
const mockUpdateSelfModel = vi.hoisted(() => vi.fn());
const mockProcessEvent = vi.hoisted(() => vi.fn());

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
  addTextSource: mockAddTextSource,
}));

vi.mock('../self-model.js', () => ({
  updateSelfModel: mockUpdateSelfModel,
}));

vi.mock('../thalamus.js', () => ({
  processEvent: mockProcessEvent,
  EVENT_TYPES: {
    RUMINATION_RESULT: 'rumination_result',
  },
}));

// ── 导入被测模块 ──────────────────────────────────────────

import { runRumination, _resetState } from '../rumination.js';

// ── Mock DB pool ──────────────────────────────────────────

function createMockPool() {
  return { query: mockQuery };
}

function setupIdleAndLearnings(learnings) {
  mockQuery
    .mockResolvedValueOnce({ rows: [] }) // rumination_invoke INSERT（result ignored）
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

describe('rumination → L1 丘脑信号', () => {
  let pool;

  beforeEach(() => {
    vi.resetAllMocks();
    _resetState();
    pool = createMockPool();
    mockBuildMemoryContext.mockResolvedValue({ block: '', meta: {} });
    mockQueryNotebook.mockResolvedValue({ ok: false });
    mockAddTextSource.mockResolvedValue({ ok: true });
    mockUpdateSelfModel.mockResolvedValue(undefined);
    mockProcessEvent.mockResolvedValue({ level: 0, actions: [], rationale: 'ok', confidence: 0.8, safety: false });
  });

  describe('DOD-1: JSON actions → RUMINATION_RESULT 事件含 actions', () => {
    it('DOD-1: JSON actions 时，processEvent 的 event.actions 包含行动标题', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '{"insight":"深度分析结论，React Server Components 改变了前端渲染模式。","actions":[{"title":"研究 React Server Components","create_task":true,"task_type":"research"}]}',
      });

      setupIdleAndLearnings([
        { id: 'l1', title: 'RSC', content: 'React Server Components 介绍', category: 'tech' },
      ]);

      await runRumination(pool);

      expect(mockProcessEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'rumination_result',
        actions: expect.arrayContaining(['研究 React Server Components']),
      }));
    });

    it('DOD-1: JSON actions 为空时，event.actions 为空数组', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '{"insight":"这是一条普通洞察，没有行动建议，仅作记录。","actions":[]}',
      });

      setupIdleAndLearnings([
        { id: 'l1', title: '普通知识', content: '内容', category: 'tech' },
      ]);

      await runRumination(pool);

      expect(mockProcessEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'rumination_result',
        actions: [],
      }));
    });
  });

  describe('DOD-2: 不再直接调用 createTask 或 createSuggestion', () => {
    it('DOD-2: 3 个 JSON actions → processEvent 收到 3 个 actions', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '{"insight":"分析前端技术趋势，发现三个可执行方向。","actions":[{"title":"行动一","create_task":true},{"title":"行动二","create_task":true},{"title":"行动三","create_task":true}]}',
      });

      setupIdleAndLearnings([
        { id: 'l1', title: '前端趋势', content: '内容', category: 'tech' },
      ]);

      await runRumination(pool);

      const callArgs = mockProcessEvent.mock.calls[0][0];
      expect(callArgs.actions).toHaveLength(3);
      expect(callArgs.actions).toContain('行动一');
      expect(callArgs.actions).toContain('行动二');
      expect(callArgs.actions).toContain('行动三');
    });

    it('DOD-2: 2 个 JSON actions → processEvent 收到 2 个 actions', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '{"insight":"洞察内容，发现两个可执行方向值得跟进。","actions":[{"title":"第一行动","create_task":true},{"title":"第二行动","create_task":true}]}',
      });

      setupIdleAndLearnings([
        { id: 'l1', title: '测试', content: '内容', category: 'tech' },
      ]);

      await runRumination(pool);

      const callArgs = mockProcessEvent.mock.calls[0][0];
      expect(callArgs.actions).toHaveLength(2);
    });
  });

  describe('DOD-3: processEvent 失败不影响消化流程', () => {
    it('DOD-3: processEvent 抛出异常时消化仍成功', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '{"insight":"洞察内容，触发行动测试场景。","actions":[{"title":"测试行动","create_task":true}]}',
      });
      mockProcessEvent.mockRejectedValueOnce(new Error('thalamus error'));

      setupIdleAndLearnings([
        { id: 'l1', title: '测试', content: '内容', category: 'tech' },
      ]);

      const result = await runRumination(pool);

      expect(result.digested).toBe(1);
      expect(result.insights).toHaveLength(1);
    });
  });
});
