import './helpers/notifier-receipt-boundary.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 全局 fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// 保存原始环境变量
const originalEnv = { ...process.env };

describe('Notifier Bark与导出合同', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockFetch.mockReset();
  });

  afterEach(() => {
    // 恢复环境变量
    process.env = { ...originalEnv };
  });

  // ─── 辅助函数：动态加载 notifier 模块（每次获取全新模块实例） ───
  async function loadNotifier(envOverrides = {}) {
    // 清理环境变量（确保不受上次测试影响）
    delete process.env.FEISHU_BOT_WEBHOOK;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_OWNER_OPEN_IDS;

    // 设置指定的环境变量
    for (const [key, value] of Object.entries(envOverrides)) {
      process.env[key] = value;
    }

    return import('../notifier.js');
  }

  // ─── Bark 通知渠道 ───
  describe('Bark 通知渠道', () => {
    it('BARK_TOKEN 已配置时，notifyCircuitOpen 同时调用 Bark API', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ code: 200 }) });
      const mod = await loadNotifier({ BARK_TOKEN: 'test-bark-token' });

      await mod.notifyCircuitOpen({ key: 'cecelia-run', failures: 4 });

      const barkCall = mockFetch.mock.calls.find(([url]) =>
        typeof url === 'string' && url.includes('api.day.app')
      );
      expect(barkCall).toBeDefined();
      expect(barkCall[0]).toContain('test-bark-token');
    });

    it('BARK_TOKEN 未配置时，不调用 Bark API', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier({});

      await mod.notifyCircuitOpen({ key: 'cecelia-run', failures: 3 });

      const barkCall = mockFetch.mock.calls.find(([url]) =>
        typeof url === 'string' && url.includes('api.day.app')
      );
      expect(barkCall).toBeUndefined();
    });
  });

  // ─── 导出完整性检查 ───
  describe('模块导出', () => {
    it('导出所有预期的函数和常量', async () => {
      const mod = await loadNotifier();
      expect(typeof mod.sendFeishu).toBe('function');
      expect(typeof mod.notifyTaskCompleted).toBe('function');
      expect(typeof mod.notifyTaskFailed).toBe('function');
      expect(typeof mod.notifyCircuitOpen).toBe('function');
      expect(typeof mod.notifyPatrolCleanup).toBe('function');
      expect(typeof mod.notifyDailySummary).toBe('function');
      expect(typeof mod.RATE_LIMIT_MS).toBe('number');
    });
  });
});
