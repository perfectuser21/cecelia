/**
 * rumination.js → Insight-to-Action 强制闭环测试
 *
 * meta-pattern hard-code 验证：
 * DOD-1: 含代码修复信号的洞察 → createTask(dev) 被调用
 * DOD-2: 无代码修复信号的洞察 → createTask 不直接调用
 * DOD-3: 同一 learning 已有 task → 不重复创建
 * DOD-4: 同一洞察 content_hash 已在 learnings → 跳过
 * DOD-5: DB 写入失败 → 静默降级，不影响消化流程
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock（vi.hoisted 保证 hoisting 正确）────────────────────────────────────────

const mockCreateTask = vi.hoisted(() => vi.fn());
const mockCallLLM = vi.hoisted(() => vi.fn());
const mockBuildMemoryContext = vi.hoisted(() => vi.fn());
const mockQueryNotebook = vi.hoisted(() => vi.fn());
const mockAddTextSource = vi.hoisted(() => vi.fn());
const mockUpdateSelfModel = vi.hoisted(() => vi.fn());
const mockProcessEvent = vi.hoisted(() => vi.fn());

vi.mock('../actions.js', () => ({ createTask: mockCreateTask }));
vi.mock('../llm-caller.js', () => ({ callLLM: mockCallLLM }));
vi.mock('../memory-retriever.js', () => ({ buildMemoryContext: mockBuildMemoryContext }));
vi.mock('../notebook-adapter.js', () => ({
  queryNotebook: mockQueryNotebook,
  addSource: vi.fn(),
  addTextSource: mockAddTextSource,
}));
vi.mock('../self-model.js', () => ({ updateSelfModel: mockUpdateSelfModel }));
vi.mock('../thalamus.js', () => ({
  processEvent: mockProcessEvent,
  EVENT_TYPES: { RUMINATION_RESULT: 'rumination_result' },
}));

import { runRumination, _resetState } from '../rumination.js';

// ── SQL Router ────────────────────────────────────────────────────────────────

/**
 * 构建一个 async SQL 路由函数，根据 SQL 内容返回预设行
 */
function buildQueryFn({ hasExistingLearning = false, hasExistingTask = false, failOnInsert = false } = {}) {
  return async (sql) => {
    const s = (sql || '').trim().toLowerCase();

    // System idle check (in_progress / queued count)
    if (s.includes('count(*)') && s.includes('in_progress')) {
      return { rows: [{ in_progress: '0', queued: '0' }] };
    }

    // Memory stream fetch (conversation_turn)
    if (s.includes('from memory_stream') && s.includes('conversation_turn')) {
      return { rows: [] };
    }

    // Memory stream INSERT
    if (s.includes('insert into memory_stream')) {
      return { rows: [] };
    }

    // Memory stream UPDATE (mark ruminated)
    if (s.includes('update memory_stream')) {
      return { rows: [] };
    }

    // Learnings fetch (undigested)
    if (s.includes('from learnings') && s.includes('digested')) {
      return { rows: [{ id: 'l1', title: 'RSC', content: 'tech content', category: 'tech' }] };
    }

    // Learnings dedup (content_hash)
    if (s.includes('from learnings') && s.includes('content_hash') && s.includes('is_latest')) {
      return { rows: hasExistingLearning ? [{ id: 'existing-l1' }] : [] };
    }

    // Learnings INSERT (rumination_insight)
    if (s.includes('insert into learnings') && s.includes('rumination_insight')) {
      if (failOnInsert) throw new Error('DB write failed');
      return { rows: [{ id: 'new-learning-id' }] };
    }

    // Learnings UPDATE (digested / applied)
    if (s.includes('update learnings')) {
      return { rows: [] };
    }

    // Tasks dedup (insight_learning_id)
    if (s.includes('from tasks') && s.includes('insight_learning_id')) {
      return { rows: hasExistingTask ? [{ id: 'existing-task' }] : [] };
    }

    // cecelia_events INSERT/SELECT
    if (s.includes('cecelia_events')) {
      return { rows: [] };
    }

    // synthesis_archive
    if (s.includes('synthesis_archive')) {
      return { rows: [] };
    }

    // working_memory (notebook_id_working, curiosity_topics)
    if (s.includes('working_memory')) {
      return { rows: [] };
    }

    // suggestions
    if (s.includes('suggestions')) {
      return { rows: [] };
    }

    return { rows: [] };
  };
}

// ── 测试辅助 ──────────────────────────────────────────────────────────────────

function setupLLM(insight) {
  mockBuildMemoryContext.mockResolvedValue({ block: '' });
  mockQueryNotebook.mockResolvedValue({ ok: false, error: 'skip' });
  mockCallLLM.mockResolvedValue({ text: insight, provider: 'anthropic' });
  mockUpdateSelfModel.mockResolvedValue(undefined);
  mockProcessEvent.mockResolvedValue({
    level: 0, actions: [], rationale: 'ok', confidence: 0.8, safety: false,
  });
  mockAddTextSource.mockResolvedValue({ ok: true });
  mockCreateTask.mockResolvedValue({ success: true, task: { id: 'created-task' }, deduplicated: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetState();
});

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('Insight-to-Action 强制闭环', () => {
  describe('DOD-1: 含代码修复信号的洞察', () => {
    it('洞察含"修复"→ createTask(dev) 被调用', async () => {
      const insight = '[反刍洞察] 发现代码修复问题：认证模块异常导致任务失败，需要重构处理逻辑。';
      setupLLM(insight);
      const db = { query: buildQueryFn() };

      await runRumination(db);

      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          task_type: 'dev',
          trigger_source: 'rumination',
          priority: 'P2',
        })
      );
      expect(mockCreateTask.mock.calls[0][0].title).toMatch(/^\[Insight修复\]/);
    });

    it('洞察含"断裂"（meta-pattern 关键词）→ createTask(dev) 被调用', async () => {
      const insight = '[反刍洞察] Insight-to-Action断裂具有自我强化性，需要强制闭环机制。';
      setupLLM(insight);
      const db = { query: buildQueryFn() };

      await runRumination(db);

      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({ task_type: 'dev', trigger_source: 'rumination' })
      );
    });

    it('洞察含"bug"（英文信号）→ createTask(dev) 被调用', async () => {
      const insight = '[反刍洞察] There is a critical bug in the auth module that causes crashes.';
      setupLLM(insight);
      const db = { query: buildQueryFn() };

      await runRumination(db);

      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({ task_type: 'dev' })
      );
    });
  });

  describe('DOD-2: 无代码修复信号的洞察', () => {
    it('纯观察性洞察 → createTask 不被直接调用', async () => {
      const insight = '[反刍洞察] 用户的工作风格很有条理，喜欢系统化思考。这与他的工程背景有关。';
      setupLLM(insight);
      const db = { query: buildQueryFn() };

      await runRumination(db);

      expect(mockCreateTask).not.toHaveBeenCalled();
    });
  });

  describe('DOD-3: 同一 learning 已有 task', () => {
    it('hasExistingTask → createTask 不被调用', async () => {
      const insight = '[反刍洞察] 代码修复问题：需要修改认证模块。';
      setupLLM(insight);
      const db = { query: buildQueryFn({ hasExistingTask: true }) };

      await runRumination(db);

      expect(mockCreateTask).not.toHaveBeenCalled();
    });
  });

  describe('DOD-4: learnings 已有相同 content_hash', () => {
    it('hasExistingLearning → createTask 不被调用', async () => {
      const insight = '[反刍洞察] 修复问题：需要改进系统。';
      setupLLM(insight);
      const db = { query: buildQueryFn({ hasExistingLearning: true }) };

      await runRumination(db);

      expect(mockCreateTask).not.toHaveBeenCalled();
    });
  });

  describe('DOD-5: learnings INSERT 失败', () => {
    it('DB 写入失败 → 静默降级，不影响消化流程', async () => {
      const insight = '[反刍洞察] 代码修复：需要解决异常崩溃问题。';
      setupLLM(insight);
      const db = { query: buildQueryFn({ failOnInsert: true }) };

      const result = await runRumination(db);

      expect(result.insights.length).toBeGreaterThan(0);
      expect(mockCreateTask).not.toHaveBeenCalled();
    });
  });
});
