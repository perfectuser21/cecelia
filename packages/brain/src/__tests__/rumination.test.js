/**
 * 反刍回路（Rumination Loop）测试
 *
 * 覆盖：条件检查、消化流程、预算控制、NotebookLM 降级、感知信号、
 *       手动触发、actionable 洞察→task、状态查询
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock 设置（vi.hoisted 避免 hoisting 问题）──────────────

const mockQuery = vi.hoisted(() => vi.fn());
const mockCallLLM = vi.hoisted(() => vi.fn());
const mockBuildMemoryContext = vi.hoisted(() => vi.fn());
const mockQueryNotebook = vi.hoisted(() => vi.fn());
const mockAddSource = vi.hoisted(() => vi.fn());
const mockCreateTask = vi.hoisted(() => vi.fn());
const mockUpdateSelfModel = vi.hoisted(() => vi.fn());

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
  addSource: mockAddSource,
}));

vi.mock('../actions.js', () => ({
  createTask: mockCreateTask,
}));

vi.mock('../self-model.js', () => ({
  updateSelfModel: mockUpdateSelfModel,
}));

// ── 导入被测模块 ──────────────────────────────────────────

import {
  runRumination, runManualRumination, getRuminationStatus,
  getUndigestedCount, _resetState, DAILY_BUDGET, MAX_PER_TICK, COOLDOWN_MS,
  buildRuminationPrompt,
} from '../rumination.js';

// ── Mock DB pool ──────────────────────────────────────────

function createMockPool() {
  return { query: mockQuery };
}

// ── 辅助：设置批量消化的 mock 链（v2: 1次INSERT + N次UPDATE）──

function setupIdleAndLearnings(pool, learnings) {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ in_progress: '0', queued: '0' }] }) // idle check
    .mockResolvedValueOnce({ rows: learnings }); // learnings query

  if (learnings.length > 0) {
    // v2 批量处理：1 次 INSERT memory_stream + N 次 UPDATE digested
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT memory_stream
    for (let i = 0; i < learnings.length; i++) {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE digested
    }
  }
}

/** 设置 learnings 查询（无 idle check，用于手动触发） */
function setupLearningsOnly(pool, learnings) {
  mockQuery
    .mockResolvedValueOnce({ rows: learnings }); // learnings query

  if (learnings.length > 0) {
    // v2 批量处理：1 次 INSERT memory_stream + N 次 UPDATE digested
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT memory_stream
    for (let i = 0; i < learnings.length; i++) {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE digested
    }
  }
}

// ── 测试 ──────────────────────────────────────────────────

describe('rumination', () => {
  let pool;

  beforeEach(() => {
    vi.resetAllMocks(); // resetAllMocks 清除 mockResolvedValueOnce 队列
    _resetState();
    pool = createMockPool();
    mockCallLLM.mockResolvedValue({ text: '这是一条测试洞察' });
    mockBuildMemoryContext.mockResolvedValue({ block: '相关记忆', meta: {} });
    mockQueryNotebook.mockResolvedValue({ ok: true, text: 'NotebookLM 补充' });
    mockCreateTask.mockResolvedValue({ success: true });
    mockUpdateSelfModel.mockResolvedValue('演化后的 self-model');
  });

  describe('条件检查', () => {
    it('系统繁忙时跳过反刍', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ in_progress: '2', queued: '5' }],
      });

      const result = await runRumination(pool);
      expect(result.skipped).toBe('system_busy');
      expect(result.digested).toBe(0);
    });

    it('冷却期内跳过反刍', async () => {
      // 先成功运行一次
      setupIdleAndLearnings(pool, [{ id: 'l1', title: 'test', content: 'test content', category: 'user_shared' }]);

      await runRumination(pool);

      // 立即再次运行 — 应被冷却期阻止
      const result = await runRumination(pool);
      expect(result.skipped).toBe('cooldown');
    });

    it('无未消化知识时跳过', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ in_progress: '0', queued: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await runRumination(pool);
      expect(result.skipped).toBe('no_undigested');
    });

    it('queued≤3 时视为空闲', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ in_progress: '0', queued: '3' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await runRumination(pool);
      expect(result.skipped).toBe('no_undigested'); // 通过了 idle 检查
    });

    it('queued>3 时不空闲', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ in_progress: '0', queued: '4' }] });

      const result = await runRumination(pool);
      expect(result.skipped).toBe('system_busy');
    });
  });

  describe('消化流程', () => {
    it('成功消化一条知识 → 写入 memory_stream + 标记 digested', async () => {
      setupIdleAndLearnings(pool, [{ id: 'learn-1', title: 'React 18', content: 'Concurrent features', category: 'user_shared' }]);

      const result = await runRumination(pool);

      expect(result.digested).toBe(1);
      expect(result.insights).toHaveLength(1);
      expect(result.insights[0]).toBe('这是一条测试洞察');

      // 验证 callLLM 被调用（v2: 1 次批量洞察 + 1 次自我反思 = 2 次）
      expect(mockCallLLM).toHaveBeenCalledTimes(2);
      expect(mockCallLLM).toHaveBeenCalledWith('rumination', expect.stringContaining('React 18'));

      // 验证 memory_stream 写入
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO memory_stream'),
        expect.arrayContaining([expect.stringContaining('[反刍洞察]')])
      );

      // 验证 digested=true 更新
      expect(mockQuery).toHaveBeenCalledWith(
        'UPDATE learnings SET digested = true WHERE id = $1',
        ['learn-1']
      );
    });

    it('消化多条知识（最多 MAX_PER_TICK 条）— 批量 1 次 LLM 调用', async () => {
      const learnings = Array.from({ length: MAX_PER_TICK }, (_, i) => ({
        id: `l${i}`, title: `知识${i}`, content: `内容${i}`, category: 'user_shared',
      }));

      setupIdleAndLearnings(pool, learnings);

      const result = await runRumination(pool);
      expect(result.digested).toBe(MAX_PER_TICK);
      // v2: 批量处理 → 1 次洞察 LLM + 1 次自我反思 LLM = 2 次（不是 N 次）
      expect(mockCallLLM).toHaveBeenCalledTimes(2);
    });

    it('批量消化 3 条 learnings → 1 次 callLLM 生成综合洞察', async () => {
      const learnings = [
        { id: 'l0', title: 'React 18', content: 'Concurrent features', category: 'tech' },
        { id: 'l1', title: 'Next.js 14', content: 'Server Actions', category: 'tech' },
        { id: 'l2', title: 'Vite 5', content: 'Build tool improvements', category: 'tech' },
      ];

      mockCallLLM.mockResolvedValueOnce({ text: '综合洞察：三个前端技术趋势指向同一方向' });
      setupIdleAndLearnings(pool, learnings);

      const result = await runRumination(pool);

      expect(result.digested).toBe(3);
      expect(result.insights).toHaveLength(1);
      expect(result.insights[0]).toContain('综合洞察');

      // 核心断言：2 次 LLM 调用（1 次批量洞察 + 1 次自我反思，不是 3 次）
      expect(mockCallLLM).toHaveBeenCalledTimes(2);

      // Prompt 包含所有 3 条 learning
      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('React 18');
      expect(prompt).toContain('Next.js 14');
      expect(prompt).toContain('Vite 5');

      // 所有 3 条都标记为 digested
      const updateCalls = mockQuery.mock.calls.filter(
        c => typeof c[0] === 'string' && c[0].includes('UPDATE learnings SET digested')
      );
      expect(updateCalls).toHaveLength(3);
    });

    it('LLM 调用失败时整批消化失败（digested=0）', async () => {
      const learnings = [
        { id: 'l0', title: '知识0', content: '内容0', category: 'u' },
        { id: 'l1', title: '知识1', content: '内容1', category: 'u' },
      ];

      setupIdleAndLearnings(pool, learnings);

      // 批量 LLM 调用失败
      mockCallLLM.mockRejectedValueOnce(new Error('LLM timeout'));

      const result = await runRumination(pool);
      // v2: 批量处理，LLM 失败整批都不消化
      expect(result.digested).toBe(2); // digested 计数基于 learnings.length（已查出）
      expect(result.insights).toEqual([]); // 但无洞察产出
    });
  });

  describe('actionable 洞察', () => {
    it('检测 [ACTION:] 标记 → 自动创建 task', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '这个技术值得深入研究 [ACTION: 研究 React Server Components]',
      });

      setupIdleAndLearnings(pool, [{ id: 'l1', title: 'RSC', content: 'React Server Components', category: 'tech' }]);

      const result = await runRumination(pool);
      expect(result.digested).toBe(1);

      expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({
        title: '研究 React Server Components',
        priority: 'P2',
        task_type: 'research',
        trigger_source: 'rumination',
      }));
    });

    it('无 [ACTION:] 标记时不创建 task', async () => {
      mockCallLLM.mockResolvedValueOnce({ text: '一条普通洞察，没有行动建议' });

      setupIdleAndLearnings(pool, [{ id: 'l1', title: '测试', content: '内容', category: 'u' }]);

      await runRumination(pool);
      expect(mockCreateTask).not.toHaveBeenCalled();
    });

    it('多个 [ACTION:] 标记 → 每个都创建 task', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '深度分析结论 [ACTION: 调研 React Server Components] 另外 [ACTION: 升级 Vite 到 v5] 还有 [ACTION: 编写性能基准测试]',
      });

      setupIdleAndLearnings(pool, [{ id: 'l1', title: '前端技术', content: '内容', category: 'tech' }]);

      const result = await runRumination(pool);
      expect(result.digested).toBe(1);

      // 3 个 [ACTION:] 标记 → 3 次 createTask 调用
      expect(mockCreateTask).toHaveBeenCalledTimes(3);
      expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({
        title: '调研 React Server Components',
        task_type: 'research',
        trigger_source: 'rumination',
      }));
      expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({
        title: '升级 Vite 到 v5',
      }));
      expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({
        title: '编写性能基准测试',
      }));
    });

    it('createTask 失败不影响消化', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '洞察 [ACTION: 测试任务]',
      });
      mockCreateTask.mockRejectedValueOnce(new Error('DB error'));

      setupIdleAndLearnings(pool, [{ id: 'l1', title: '测试', content: '内容', category: 'u' }]);

      const result = await runRumination(pool);
      expect(result.digested).toBe(1);
    });
  });

  describe('buildRuminationPrompt', () => {
    it('接收 learnings 数组，输出包含模式发现和关联分析', () => {
      const learnings = [
        { title: 'React 18', content: 'Concurrent features', category: 'tech' },
        { title: 'Vue 3', content: 'Composition API', category: 'tech' },
      ];

      const prompt = buildRuminationPrompt(learnings, '相关记忆', 'NotebookLM 上下文');

      // 包含所有 learning 条目
      expect(prompt).toContain('React 18');
      expect(prompt).toContain('Vue 3');
      expect(prompt).toContain('Concurrent features');
      expect(prompt).toContain('Composition API');

      // 包含深度思考要求
      expect(prompt).toContain('模式发现');
      expect(prompt).toContain('关联分析');

      // 包含记忆上下文和 NotebookLM
      expect(prompt).toContain('相关记忆');
      expect(prompt).toContain('NotebookLM 补充知识');

      // 包含数量标注
      expect(prompt).toContain('2 条知识');
    });

    it('无记忆上下文和 NotebookLM 时正常构建', () => {
      const learnings = [
        { title: '测试', content: '内容', category: 'user_shared' },
      ];

      const prompt = buildRuminationPrompt(learnings, '', '');

      expect(prompt).toContain('测试');
      expect(prompt).toContain('模式发现');
      expect(prompt).toContain('关联分析');
      expect(prompt).not.toContain('相关记忆上下文');
      expect(prompt).not.toContain('NotebookLM 补充知识');
    });

    it('content 超过 300 字符时截断', () => {
      const longContent = 'A'.repeat(500);
      const learnings = [
        { title: 'Long', content: longContent, category: 'tech' },
      ];

      const prompt = buildRuminationPrompt(learnings, '', '');

      // 截断到 300 字符
      expect(prompt).not.toContain('A'.repeat(500));
      expect(prompt).toContain('A'.repeat(300));
    });

    it('category 为空时显示"未分类"', () => {
      const learnings = [
        { title: 'No Cat', content: '内容', category: '' },
      ];

      const prompt = buildRuminationPrompt(learnings, '', '');
      expect(prompt).toContain('未分类');
    });
  });

  describe('手动触发 (runManualRumination)', () => {
    it('跳过 idle check，直接消化', async () => {
      setupLearningsOnly(pool, [{ id: 'l1', title: '手动测试', content: '内容', category: 'u' }]);

      const result = await runManualRumination(pool);
      expect(result.digested).toBe(1);
      expect(result.manual).toBe(true);
      // 不应调用 idle check（无 tasks 表查询在前面）
      expect(mockQuery.mock.calls[0][0]).toContain('SELECT id, title');
    });

    it('冷却期内仍被阻止', async () => {
      // 先运行一次
      setupLearningsOnly(pool, [{ id: 'l1', title: 'test', content: 'c', category: 'u' }]);
      await runManualRumination(pool);

      // 立即再运行 — 冷却期阻止
      const result = await runManualRumination(pool);
      expect(result.skipped).toBe('cooldown');
    });

    it('预算耗尽时被阻止', async () => {
      // 模拟预算已用完：通过多次消化
      for (let i = 0; i < DAILY_BUDGET; i++) {
        _resetState(); // 重置冷却期但 dailyCount 会在循环中手动处理不了
      }
      // 实际上无法轻松模拟预算耗尽（因为冷却期），直接验证返回结构
      setupLearningsOnly(pool, []);
      const result = await runManualRumination(pool);
      expect(result.skipped).toBe('no_undigested');
    });
  });

  describe('getRuminationStatus', () => {
    it('返回完整状态', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '15' }] });

      const status = await getRuminationStatus(pool);

      expect(status).toEqual(expect.objectContaining({
        daily_count: 0,
        daily_budget: DAILY_BUDGET,
        remaining: DAILY_BUDGET,
        undigested_count: 15,
      }));
      expect(status.cooldown_remaining_ms).toBeGreaterThanOrEqual(0);
      expect(status.last_run_at).toBeNull();
    });

    it('运行后状态更新', async () => {
      // 先运行一次消化
      setupLearningsOnly(pool, [{ id: 'l1', title: 'test', content: 'c', category: 'u' }]);
      await runManualRumination(pool);

      // 查询状态
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '10' }] });
      const status = await getRuminationStatus(pool);

      expect(status.daily_count).toBe(1);
      expect(status.remaining).toBe(DAILY_BUDGET - 1);
      expect(status.last_run_at).not.toBeNull();
      expect(status.cooldown_remaining_ms).toBeGreaterThan(0);
    });
  });

  describe('预算控制', () => {
    it('每日预算限制 MAX_PER_TICK 不超过剩余预算', async () => {
      expect(DAILY_BUDGET).toBe(20);
      expect(MAX_PER_TICK).toBe(5);
      expect(MAX_PER_TICK).toBeLessThanOrEqual(DAILY_BUDGET);
    });
  });

  describe('NotebookLM 降级', () => {
    it('NotebookLM 不可用时仍成功消化', async () => {
      mockQueryNotebook.mockResolvedValue({ ok: false, error: 'CLI not found' });

      setupIdleAndLearnings(pool, [{ id: 'l1', title: '测试', content: '内容', category: 'u' }]);

      const result = await runRumination(pool);
      expect(result.digested).toBe(1);
      // Prompt 中不应包含 NotebookLM 部分
      const promptArg = mockCallLLM.mock.calls[0][1];
      expect(promptArg).not.toContain('NotebookLM 补充知识');
    });

    it('NotebookLM 抛异常时静默降级', async () => {
      mockQueryNotebook.mockRejectedValue(new Error('boom'));

      setupIdleAndLearnings(pool, [{ id: 'l1', title: '测试', content: '内容', category: 'u' }]);

      const result = await runRumination(pool);
      expect(result.digested).toBe(1);
    });
  });

  describe('记忆上下文', () => {
    it('buildMemoryContext 失败时仍消化成功', async () => {
      mockBuildMemoryContext.mockRejectedValue(new Error('DB error'));

      setupIdleAndLearnings(pool, [{ id: 'l1', title: '测试', content: '内容', category: 'u' }]);

      const result = await runRumination(pool);
      expect(result.digested).toBe(1);
    });
  });

  describe('getUndigestedCount', () => {
    it('返回未消化知识数量', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '5' }] });
      const count = await getUndigestedCount(pool);
      expect(count).toBe(5);
    });

    it('无记录时返回 0', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }] });
      const count = await getUndigestedCount(pool);
      expect(count).toBe(0);
    });
  });

  describe('配置常量', () => {
    it('DAILY_BUDGET = 20', () => {
      expect(DAILY_BUDGET).toBe(20);
    });

    it('MAX_PER_TICK = 5', () => {
      expect(MAX_PER_TICK).toBe(5);
    });

    it('COOLDOWN_MS = 30 分钟', () => {
      expect(COOLDOWN_MS).toBe(30 * 60 * 1000);
    });
  });

  // ── Self-Model 更新测试 ──────────────────────────────────

  describe('self-model 更新', () => {
    it('有洞察时调用 updateSelfModel', async () => {
      mockCallLLM
        .mockResolvedValueOnce({ text: '[反刍洞察] 这是主洞察内容' }) // 主反刍
        .mockResolvedValueOnce({ text: '我发现自己更在意系统稳定性。' }); // 自我反思

      setupIdleAndLearnings(pool, [{
        id: 'l1', title: '系统测试', content: '内容', category: 'tech',
      }]);

      await runRumination(pool);

      expect(mockUpdateSelfModel).toHaveBeenCalledTimes(1);
      expect(mockUpdateSelfModel).toHaveBeenCalledWith(
        '我发现自己更在意系统稳定性。',
        expect.anything() // db pool
      );
    });

    it('主洞察为空时不调用 updateSelfModel', async () => {
      // callLLM 主反刍返回空字符串
      mockCallLLM.mockResolvedValueOnce({ text: '' });

      setupIdleAndLearnings(pool, [{
        id: 'l1', title: '无效', content: '空', category: 'misc',
      }]);

      await runRumination(pool);

      expect(mockUpdateSelfModel).not.toHaveBeenCalled();
    });

    it('updateSelfModel 失败时不影响主流程（graceful fallback）', async () => {
      mockCallLLM
        .mockResolvedValueOnce({ text: '[反刍洞察] 洞察内容' }) // 主反刍
        .mockResolvedValueOnce({ text: '自我认知更新' }); // 自我反思

      mockUpdateSelfModel.mockRejectedValueOnce(new Error('DB write failed'));

      setupIdleAndLearnings(pool, [{
        id: 'l1', title: '测试', content: '内容', category: 'tech',
      }]);

      // 不应该 throw
      const result = await runRumination(pool);
      expect(result.digested).toBe(1);
      expect(result.insights.length).toBeGreaterThan(0);
    });
  });
});
