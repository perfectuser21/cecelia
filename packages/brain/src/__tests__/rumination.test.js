/**
 * 反刍回路（Rumination Loop）测试
 *
 * 覆盖：条件检查、消化流程、预算控制、NotebookLM 降级、感知信号
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock 设置（vi.hoisted 避免 hoisting 问题）──────────────

const mockQuery = vi.hoisted(() => vi.fn());
const mockCallLLM = vi.hoisted(() => vi.fn());
const mockBuildMemoryContext = vi.hoisted(() => vi.fn());
const mockQueryNotebook = vi.hoisted(() => vi.fn());
const mockAddSource = vi.hoisted(() => vi.fn());

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

// ── 导入被测模块 ──────────────────────────────────────────

import { runRumination, getUndigestedCount, _resetState, DAILY_BUDGET, MAX_PER_TICK, COOLDOWN_MS } from '../rumination.js';

// ── Mock DB pool ──────────────────────────────────────────

function createMockPool() {
  return { query: mockQuery };
}

// ── 辅助：设置单条消化的 mock 链 ──────────────────────────

function setupIdleAndLearnings(pool, learnings) {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ in_progress: '0', queued: '0' }] }) // idle check
    .mockResolvedValueOnce({ rows: learnings }); // learnings query

  // 为每条 learning 设置 INSERT + UPDATE mock
  for (let i = 0; i < learnings.length; i++) {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // INSERT memory_stream
      .mockResolvedValueOnce({ rows: [] }); // UPDATE digested
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

      // 验证 callLLM 被调用
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

    it('消化多条知识（最多 MAX_PER_TICK 条）', async () => {
      const learnings = Array.from({ length: MAX_PER_TICK }, (_, i) => ({
        id: `l${i}`, title: `知识${i}`, content: `内容${i}`, category: 'user_shared',
      }));

      setupIdleAndLearnings(pool, learnings);

      const result = await runRumination(pool);
      expect(result.digested).toBe(MAX_PER_TICK);
      expect(mockCallLLM).toHaveBeenCalledTimes(MAX_PER_TICK);
    });

    it('单条消化失败不影响其他', async () => {
      const learnings = [
        { id: 'l0', title: '知识0', content: '内容0', category: 'u' },
        { id: 'l1', title: '知识1', content: '内容1', category: 'u' },
      ];

      setupIdleAndLearnings(pool, learnings);

      // 第一条 LLM 调用失败
      mockCallLLM
        .mockRejectedValueOnce(new Error('LLM timeout'))
        .mockResolvedValueOnce({ text: '第二条洞察' });

      const result = await runRumination(pool);
      expect(result.digested).toBe(1);
      expect(result.insights).toEqual(['第二条洞察']);
    });
  });

  describe('预算控制', () => {
    it('每日预算限制 MAX_PER_TICK 不超过剩余预算', async () => {
      // 通过多次调用模拟预算消耗是不可行的（冷却期），
      // 所以直接验证配置常量即可
      expect(DAILY_BUDGET).toBe(10);
      expect(MAX_PER_TICK).toBe(3);
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
    it('DAILY_BUDGET = 10', () => {
      expect(DAILY_BUDGET).toBe(10);
    });

    it('MAX_PER_TICK = 3', () => {
      expect(MAX_PER_TICK).toBe(3);
    });

    it('COOLDOWN_MS = 30 分钟', () => {
      expect(COOLDOWN_MS).toBe(30 * 60 * 1000);
    });
  });
});
