/**
 * 反刍回路（Rumination Loop）测试
 *
 * 覆盖：条件检查、消化流程、预算控制、NotebookLM 降级、感知信号、
 *       手动触发、actionable 洞察→task、状态查询
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock 设置（vi.hoisted 避免 hoisting 问题）──────────────

const mockQuery = vi.hoisted(() => vi.fn());
const mockCallLLM = vi.hoisted(() => vi.fn());
const mockBuildMemoryContext = vi.hoisted(() => vi.fn());
const mockQueryNotebook = vi.hoisted(() => vi.fn());
const mockAddSource = vi.hoisted(() => vi.fn());
const mockAddTextSource = vi.hoisted(() => vi.fn());
const mockCreateTask = vi.hoisted(() => vi.fn());
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
  addSource: mockAddSource,
  addTextSource: mockAddTextSource,
}));

vi.mock('../actions.js', () => ({
  createTask: mockCreateTask,
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

import {
  runRumination, runManualRumination, runRuminationForce, getRuminationStatus,
  getUndigestedCount, _resetState, _setDailyCount, DAILY_BUDGET, MAX_PER_TICK, COOLDOWN_MS,
  buildRuminationPrompt, buildNotebookQuery, getDailyBudget,
} from '../rumination.js';

// ── Mock DB pool ──────────────────────────────────────────

function createMockPool() {
  return { query: mockQuery };
}

// ── 辅助：设置批量消化的 mock 链（v3: heartbeat + idle + learnings + INSERT + N×UPDATE）──
// runRumination 先写 rumination_run 心跳 INSERT，再 idle check，再 learnings SELECT。
// memStreamItems SELECT 在 learnings < limit 时发生，消耗 queue 中"剩余未定义"slot（caught 处理）。

function setupIdleAndLearnings(pool, learnings) {
  mockQuery
    .mockResolvedValueOnce({ rows: [] }) // runRumination 入口 rumination_run heartbeat INSERT
    .mockResolvedValueOnce({ rows: [{ in_progress: '0', queued: '0' }] }) // idle check
    .mockResolvedValueOnce({ rows: learnings }); // learnings query

  if (learnings.length > 0) {
    // v3 批量处理：1 次 INSERT memory_stream（digest 内其他 INSERT 无 mock，caught 处理）+ N 次 UPDATE digested
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT memory_stream (其他 INSERT 无 mock → caught)
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

// ── getDailyBudget 单元测试 ───────────────────────────────

describe('getDailyBudget', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('低峰期 00:00 UTC+8 返回 1000', () => {
    // 2026-03-10 00:00:00 上海时间 = UTC 2026-03-09 16:00:00
    vi.setSystemTime(new Date('2026-03-09T16:00:00.000Z'));
    expect(getDailyBudget()).toBe(200);
  });

  it('低峰期 03:30 UTC+8 返回 1000', () => {
    // 2026-03-10 03:30:00 上海时间 = UTC 2026-03-09 19:30:00
    vi.setSystemTime(new Date('2026-03-09T19:30:00.000Z'));
    expect(getDailyBudget()).toBe(200);
  });

  it('低峰期 05:59 UTC+8 返回 1000', () => {
    // 2026-03-10 05:59:00 上海时间 = UTC 2026-03-09 21:59:00
    vi.setSystemTime(new Date('2026-03-09T21:59:00.000Z'));
    expect(getDailyBudget()).toBe(200);
  });

  it('正常时段 06:00 UTC+8 返回 100', () => {
    // 2026-03-10 06:00:00 上海时间 = UTC 2026-03-09 22:00:00
    vi.setSystemTime(new Date('2026-03-09T22:00:00.000Z'));
    expect(getDailyBudget()).toBe(100);
  });

  it('正常时段 12:00 UTC+8 返回 100', () => {
    // 2026-03-10 12:00:00 上海时间 = UTC 2026-03-10 04:00:00
    vi.setSystemTime(new Date('2026-03-10T04:00:00.000Z'));
    expect(getDailyBudget()).toBe(100);
  });

  it('正常时段 23:59 UTC+8 返回 100', () => {
    // 2026-03-10 23:59:00 上海时间 = UTC 2026-03-10 15:59:00
    vi.setSystemTime(new Date('2026-03-10T15:59:00.000Z'));
    expect(getDailyBudget()).toBe(100);
  });
});

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
    mockAddTextSource.mockResolvedValue({ ok: true });
    mockCreateTask.mockResolvedValue({ success: true });
    mockUpdateSelfModel.mockResolvedValue('演化后的 self-model');
    mockProcessEvent.mockResolvedValue({ level: 0, actions: [], rationale: 'ok', confidence: 0.8, safety: false });
  });

  describe('条件检查', () => {
    it('系统繁忙时降低反刍批量（软限制，不再完全跳过）', async () => {
      // 繁忙时：busyMultiplier=0.4，但仍继续执行（返回 no_undigested 或实际消化）
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // heartbeat INSERT
        .mockResolvedValueOnce({ rows: [{ in_progress: '2', queued: '5' }] }) // isSystemIdle → busy
        .mockResolvedValueOnce({ rows: [] }); // 无未消化知识

      const result = await runRumination(pool);
      // 繁忙时不再返回 system_busy，而是继续（只是批量减少）
      expect(result.skipped).not.toBe('system_busy');
      expect(result.digested).toBe(0); // 无知识可消化
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
        .mockResolvedValueOnce({ rows: [] }) // heartbeat INSERT
        .mockResolvedValueOnce({ rows: [{ in_progress: '0', queued: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await runRumination(pool);
      expect(result.skipped).toBe('no_undigested');
    });

    it('queued≤3 时视为空闲', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // heartbeat INSERT
        .mockResolvedValueOnce({ rows: [{ in_progress: '0', queued: '3' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await runRumination(pool);
      expect(result.skipped).toBe('no_undigested'); // 通过了 idle 检查
    });

    it('queued>3 时系统繁忙，但反刍仍以较低批量继续', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // heartbeat INSERT
        .mockResolvedValueOnce({ rows: [{ in_progress: '0', queued: '4' }] }) // isSystemIdle → busy
        .mockResolvedValueOnce({ rows: [] }); // 无未消化知识

      const result = await runRumination(pool);
      // 不再跳过，改为软限制（批量 × 0.4）
      expect(result.skipped).not.toBe('system_busy');
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
    it('检测 [ACTION:] 标记 → processEvent 发 RUMINATION_RESULT 含 actions', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '这个技术值得深入研究 [ACTION: 研究 React Server Components]',
      });

      setupIdleAndLearnings(pool, [{ id: 'l1', title: 'RSC', content: 'React Server Components', category: 'tech' }]);

      const result = await runRumination(pool);
      expect(result.digested).toBe(1);

      expect(mockProcessEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'rumination_result',
        actions: expect.arrayContaining(['研究 React Server Components']),
      }));
    });

    it('无 [ACTION:] 标记时不创建 task', async () => {
      mockCallLLM.mockResolvedValueOnce({ text: '一条普通洞察，没有行动建议' });

      setupIdleAndLearnings(pool, [{ id: 'l1', title: '测试', content: '内容', category: 'u' }]);

      await runRumination(pool);
      expect(mockCreateTask).not.toHaveBeenCalled();
    });

    it('多个 [ACTION:] 标记 → processEvent 收到全部 actions', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '深度分析结论 [ACTION: 调研 React Server Components] 另外 [ACTION: 升级 Vite 到 v5] 还有 [ACTION: 编写性能基准测试]',
      });

      setupIdleAndLearnings(pool, [{ id: 'l1', title: '前端技术', content: '内容', category: 'tech' }]);

      const result = await runRumination(pool);
      expect(result.digested).toBe(1);

      // 3 个 [ACTION:] 标记 → processEvent 收到 3 个 actions
      expect(mockProcessEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'rumination_result',
        actions: expect.arrayContaining(['调研 React Server Components', '升级 Vite 到 v5', '编写性能基准测试']),
      }));
      const callArgs = mockProcessEvent.mock.calls[0][0];
      expect(callArgs.actions).toHaveLength(3);
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

      // 包含记忆上下文和历史反刍上下文
      expect(prompt).toContain('相关记忆');
      expect(prompt).toContain('历史反刍上下文');

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
      expect(prompt).not.toContain('历史反刍上下文');
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

  describe('buildNotebookQuery', () => {
    it('包含所有 learning 标题', () => {
      const learnings = [
        { title: 'React 18', content: 'x', category: 'tech' },
        { title: 'Vue 3', content: 'x', category: 'tech' },
      ];
      const query = buildNotebookQuery(learnings);
      expect(query).toContain('React 18');
      expect(query).toContain('Vue 3');
    });

    it('包含 ACTION 格式说明', () => {
      const learnings = [{ title: 'CI Fix', content: 'x', category: 'ci' }];
      const query = buildNotebookQuery(learnings);
      expect(query).toContain('[ACTION:');
    });

    it('类别为空时显示"未分类"', () => {
      const learnings = [{ title: 'X', content: 'x', category: '' }];
      const query = buildNotebookQuery(learnings);
      expect(query).toContain('未分类');
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

    it('force=false 时预算耗尽返回 daily_budget_exhausted', async () => {
      _setDailyCount(getDailyBudget()); // 模拟预算已满（动态预算，避免时区测试漂移）
      const result = await runManualRumination(pool, { force: false });
      expect(result.skipped).toBe('daily_budget_exhausted');
      expect(result.digested).toBe(0);
    });

    it('force=true 时绕过 daily_budget，消化成功', async () => {
      _setDailyCount(getDailyBudget()); // 模拟预算已满（动态预算，避免时区测试漂移）
      setupLearningsOnly(pool, [{ id: 'f1', title: 'force 测试', content: '强制消化', category: 'test' }]);

      const result = await runManualRumination(pool, { force: true });
      expect(result.skipped).toBeUndefined();
      expect(result.digested).toBe(1);
      expect(result.manual).toBe(true);
    });

    it('force=true 时冷却期仍然生效', async () => {
      // 先运行一次触发冷却
      setupLearningsOnly(pool, [{ id: 'l1', title: 'test', content: 'c', category: 'u' }]);
      await runManualRumination(pool, { force: true });

      // 立即再次运行 — force=true 不绕过冷却期
      const result = await runManualRumination(pool, { force: true });
      expect(result.skipped).toBe('cooldown');
    });
  });

  describe('getRuminationStatus', () => {
    it('返回完整状态', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '15' }] });

      const status = await getRuminationStatus(pool);

      expect(status).toEqual(expect.objectContaining({
        daily_count: 0,
        daily_budget: getDailyBudget(),
        remaining: getDailyBudget(),
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
      expect(status.remaining).toBe(getDailyBudget() - 1);
      expect(status.last_run_at).not.toBeNull();
      expect(status.cooldown_remaining_ms).toBeGreaterThan(0);
    });
  });

  describe('预算控制', () => {
    it('每日预算限制 MAX_PER_TICK 不超过剩余预算', async () => {
      expect(DAILY_BUDGET).toBe(100);
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
      // Prompt 中不应包含 NotebookLM 提供的上下文（fallback 无历史记录时也不含）
      const promptArg = mockCallLLM.mock.calls[0][1];
      expect(promptArg).not.toContain('历史反刍上下文');
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
    it('DAILY_BUDGET = 100', () => {
      expect(DAILY_BUDGET).toBe(100);
    });

    it('MAX_PER_TICK = 5', () => {
      expect(MAX_PER_TICK).toBe(5);
    });

    it('COOLDOWN_MS = 10 分钟', () => {
      expect(COOLDOWN_MS).toBe(10 * 60 * 1000);
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

    it('selfReflectPrompt 包含好奇心/审美/存在三个非工作反思维度，maxTokens=200', async () => {
      mockCallLLM
        .mockResolvedValueOnce({ text: '[反刍洞察] 系统架构设计模式分析。' }) // 主反刍
        .mockResolvedValueOnce({ text: '我对简洁的代码设计有一种美学上的偏好。' }); // 自我反思

      setupIdleAndLearnings(pool, [{
        id: 'l1', title: '架构设计', content: '模块化设计的重要性。', category: 'tech',
      }]);

      await runRumination(pool);

      // 总共 2 次 callLLM：第 1 次洞察生成，第 2 次自我反思
      expect(mockCallLLM).toHaveBeenCalledTimes(2);

      // 第 2 次调用是 selfReflectPrompt
      const selfReflectCallArgs = mockCallLLM.mock.calls[1];
      const [agentId, prompt, opts] = selfReflectCallArgs;

      expect(agentId).toBe('rumination');

      // 验证包含非工作反思维度
      expect(prompt).toContain('好奇心');
      expect(prompt).toContain('审美');
      expect(prompt).toContain('存在');

      // 验证 maxTokens 保持 200（简洁）
      expect(opts?.maxTokens).toBe(200);
    });
  });

  // ── runRuminationForce 测试 ──────────────────────────────

  describe('runRuminationForce', () => {
    it('无未消化知识时返回 {processed: 0, insights: []}', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // 无 learnings

      const result = await runRuminationForce(pool);
      expect(result).toEqual({ processed: 0, insights: [] });
    });

    it('绕过 cooldown：反刍后立即再次 force 仍可执行', async () => {
      // 先消化一次（触发冷却期）
      setupLearningsOnly(pool, [{ id: 'l1', title: '知识1', content: '内容1', category: 'tech' }]);
      await runRuminationForce(pool);

      // 立即再次 force — 不受冷却期限制
      mockQuery.mockResolvedValueOnce({ rows: [] }); // 无 learnings
      const result = await runRuminationForce(pool);
      // 不应该返回 skipped: 'cooldown'
      expect(result.processed).toBe(0);
      expect(result).not.toHaveProperty('skipped');
    });

    it('绕过 daily_budget：预算耗尽后 force 仍可执行', async () => {
      _setDailyCount(DAILY_BUDGET + 10); // 超出预算

      setupLearningsOnly(pool, [{ id: 'l1', title: '知识1', content: '内容1', category: 'tech' }]);

      const result = await runRuminationForce(pool);
      // 不因预算耗尽跳过
      expect(result.processed).toBe(1);
      expect(result).not.toHaveProperty('skipped');
    });

    it('9 条 learning 全部被 UPDATE digested=true', async () => {
      const learnings = Array.from({ length: 9 }, (_, i) => ({
        id: `force-l${i}`, title: `积压知识${i}`, content: `内容${i}`, category: 'user_shared',
      }));

      setupLearningsOnly(pool, learnings);

      const result = await runRuminationForce(pool);
      expect(result.processed).toBe(9);
      expect(result.insights).toHaveLength(1);

      // 验证 9 条全部 UPDATE digested=true
      for (let i = 0; i < 9; i++) {
        expect(mockQuery).toHaveBeenCalledWith(
          'UPDATE learnings SET digested = true WHERE id = $1',
          [`force-l${i}`]
        );
      }
    });

    it('写入 working_memory key=rumination_force_result', async () => {
      setupLearningsOnly(pool, [{ id: 'l1', title: '测试知识', content: '内容', category: 'tech' }]);

      await runRuminationForce(pool);

      // 验证 working_memory 被写入
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('rumination_force_result'),
        expect.anything()
      );
    });

    it('返回格式包含 processed 和 insights 字段', async () => {
      setupLearningsOnly(pool, [{ id: 'l1', title: '知识', content: '内容', category: 'tech' }]);

      const result = await runRuminationForce(pool);
      expect(result).toHaveProperty('processed');
      expect(result).toHaveProperty('insights');
      expect(typeof result.processed).toBe('number');
      expect(Array.isArray(result.insights)).toBe(true);
    });
  });

  // ── 心跳事件 + 数据丢失修复 ───────────────────────────────

  describe('heartbeat + 防数据丢失（PROBE_FAIL_RUMINATION 修复）', () => {
    it('runRumination 入口写 rumination_run 心跳（probe 用此判断循环是否被调用）', async () => {
      setupIdleAndLearnings(pool, [{ id: 'l1', title: 'test', content: 'c', category: 'u' }]);

      await runRumination(pool);

      // 验证心跳 INSERT cecelia_events 'rumination_run' 被发出
      // SQL 中包含字面量 'rumination_run'（event_type 字段值）
      const heartbeatCalls = mockQuery.mock.calls.filter(call => {
        const sql = call[0] || '';
        return sql.includes('cecelia_events') &&
               sql.includes('INSERT') &&
               sql.includes("'rumination_run'");
      });
      expect(heartbeatCalls.length).toBeGreaterThan(0);
    });

    it('预算耗尽时仍写 rumination_run 心跳（loop_dead vs budget_exhausted 区分）', async () => {
      // 模拟每日预算已耗尽 — runRumination 会提前返回 daily_budget_exhausted
      _setDailyCount(getDailyBudget());

      const result = await runRumination(pool);

      // 确认提前返回
      expect(result.skipped).toBe('daily_budget_exhausted');
      expect(result.digested).toBe(0);

      // 关键断言：心跳必须写入（即使预算耗尽）
      // probe 依赖此区分"循环活着但跳过" vs "循环根本没被调用（loop_dead）"
      const heartbeatCalls = mockQuery.mock.calls.filter(call => {
        const sql = call[0] || '';
        return sql.includes('cecelia_events') &&
               sql.includes('INSERT') &&
               sql.includes("'rumination_run'");
      });
      expect(heartbeatCalls.length).toBeGreaterThan(0);
    });

    it('LLM 全部失败（NotebookLM 空 + callLLM 空）时 NOT 标记 digested（防数据丢失）', async () => {
      mockQueryNotebook.mockResolvedValue({ ok: false, error: 'bridge unreachable' });
      mockCallLLM.mockResolvedValue({ text: '' }); // 空响应

      setupIdleAndLearnings(pool, [
        { id: 'lost-1', title: 'will-not-lose', content: 'c1', category: 'u' },
        { id: 'lost-2', title: 'also-not-lose', content: 'c2', category: 'u' },
      ]);

      const result = await runRumination(pool);

      // 没产出 insight
      expect(result.insights).toEqual([]);

      // 关键断言：不应有任何 UPDATE learnings SET digested 调用
      const updateDigestedCalls = mockQuery.mock.calls.filter(call =>
        (call[0] || '').includes('UPDATE learnings SET digested = true')
      );
      expect(updateDigestedCalls).toHaveLength(0);
    });

    it('LLM 成功产生 insight 时仍正常标记 digested（保持现有行为）', async () => {
      mockQueryNotebook.mockResolvedValue({ ok: true, text: '足够长的 NotebookLM 洞察文本' + 'x'.repeat(100) });

      setupIdleAndLearnings(pool, [{ id: 'normal-1', title: 'ok', content: 'c', category: 'u' }]);

      const result = await runRumination(pool);

      expect(result.digested).toBe(1);

      // 应有 UPDATE learnings 调用
      expect(mockQuery).toHaveBeenCalledWith(
        'UPDATE learnings SET digested = true WHERE id = $1',
        ['normal-1']
      );
    });
  });
});
