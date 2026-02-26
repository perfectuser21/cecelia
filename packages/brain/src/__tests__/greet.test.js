/**
 * greet.js 测试 — 主动问候生成 + 冷却机制
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool — 需要同时支持 pool.query 和 pool.connect
const mockQuery = vi.fn();
const mockRelease = vi.fn();
vi.mock('../db.js', () => ({
  default: {
    query: (...args) => mockQuery(...args),
    connect: vi.fn().mockResolvedValue({
      query: (...args) => mockQuery(...args),
      release: mockRelease,
    }),
  },
}));

// Mock callLLM
const mockCallLLM = vi.fn();
vi.mock('../llm-caller.js', () => ({
  callLLM: (...args) => mockCallLLM(...args),
}));

describe('greet — 主动问候', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置模块缓存，确保每个测试独立
    vi.resetModules();
  });

  describe('isInCooldown', () => {
    it('没有 last_greet_at 记录时不在冷却期', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const { isInCooldown } = await import('../greet.js');
      const result = await isInCooldown();
      expect(result).toBe(false);
    });

    it('5 分钟内的记录在冷却期', async () => {
      // PostgreSQL jsonb 列返回的是已解析的 JS 值（去掉外层引号）
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      mockQuery.mockResolvedValueOnce({
        rows: [{ value_json: twoMinutesAgo }],
      });
      const { isInCooldown } = await import('../greet.js');
      const result = await isInCooldown();
      expect(result).toBe(true);
    });

    it('超过 5 分钟的记录不在冷却期', async () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      mockQuery.mockResolvedValueOnce({
        rows: [{ value_json: tenMinutesAgo }],
      });
      const { isInCooldown } = await import('../greet.js');
      const result = await isInCooldown();
      expect(result).toBe(false);
    });
  });

  describe('generateGreeting', () => {
    it('冷却期内返回 null', async () => {
      const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000).toISOString();
      mockQuery.mockResolvedValueOnce({
        rows: [{ value_json: oneMinuteAgo }],
      });

      const { generateGreeting } = await import('../greet.js');
      const result = await generateGreeting();
      expect(result).toBeNull();
      expect(mockCallLLM).not.toHaveBeenCalled();
    });

    it('非冷却期调用 LLM 生成问候', async () => {
      // isInCooldown → false（无记录）
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // recordGreetAndPresence → 2 个 INSERT
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // getBriefing → pool.connect → 6 个并发查询（mockQuery 会被依次调用）
      const taskStatsRow = { completed: '5', failed: '1', queued: '3', in_progress: '2' };
      mockQuery.mockResolvedValue({
        rows: [taskStatsRow],
      });

      mockCallLLM.mockResolvedValueOnce({
        text: '下午好，有 2 个任务在跑，1 个失败了需要看一下。',
        model: 'claude-haiku-4-5-20251001',
        provider: 'anthropic',
        elapsed_ms: 1200,
      });

      const { generateGreeting } = await import('../greet.js');
      const result = await generateGreeting();

      expect(result).not.toBeNull();
      expect(result.message).toContain('下午好');
      expect(result.type).toBe('inform');
      expect(mockCallLLM).toHaveBeenCalledWith('mouth', expect.any(String), expect.objectContaining({
        timeout: 15000,
        maxTokens: 256,
      }));
    });

    it('LLM 失败时降级到静态问候', async () => {
      // isInCooldown → false
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // recordGreetAndPresence
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // getBriefing 查询
      mockQuery.mockResolvedValue({
        rows: [{ completed: '3', failed: '0', queued: '1', in_progress: '0' }],
      });

      mockCallLLM.mockRejectedValueOnce(new Error('Bridge timeout'));

      const { generateGreeting } = await import('../greet.js');
      const result = await generateGreeting();

      expect(result).not.toBeNull();
      expect(result.type).toBe('inform');
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/brain/greet 端点验证', () => {
    it('路由文件包含 greet 端点和关键逻辑', async () => {
      const fs = await import('fs');
      const routesSource = fs.readFileSync(
        new URL('../routes.js', import.meta.url), 'utf-8'
      );
      // 端点存在
      expect(routesSource).toContain("router.post('/greet'");
      // 调用 generateGreeting
      expect(routesSource).toContain('generateGreeting');
      // 通过 WS 广播
      expect(routesSource).toContain('DESIRE_EXPRESSED');
      // 更新 user_last_seen
      expect(routesSource).toContain('user_last_seen');
    });
  });
});
