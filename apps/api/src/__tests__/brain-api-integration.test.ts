/**
 * Brain↔Frontend API Integration Test
 *
 * 验证 apps/api 的 Brain proxy 层配置正确性：
 * - parseIntent → 正确转发到 Brain /intent/parse
 * - parseAndCreate → 正确转发到 Brain /intent/create
 * - Brain 不可达时返回适当错误
 *
 * 使用 mock 模拟 Brain 响应，无需实际 Brain 服务运行。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseIntent, parseAndCreate } from '../dashboard/routes.js';

const originalFetch = global.fetch;

describe('Brain↔Frontend API Integration — proxy 层', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────
  // parseIntent — GET /intent/parse
  // ──────────────────────────────────────────────

  describe('parseIntent', () => {
    it('Brain 返回 200 时，正确解析 intentType 和 confidence', async () => {
      const mockResponse = {
        intentType: 'create_task',
        confidence: 0.92,
        entities: { title: '用户登录接口' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await parseIntent('实现用户登录接口');

      expect(result.intentType).toBe('create_task');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(mockFetch).toHaveBeenCalledOnce();

      // 验证请求发到了 Brain intent parse 端点
      const [url, options] = mockFetch.mock.calls[0];
      expect(String(url)).toContain('/intent/parse');
      expect(options?.method).toBe('POST');
    });

    it('Brain 返回 500 时，抛出 Brain API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(parseIntent('测试输入')).rejects.toThrow('Brain API error');
    });

    it('Brain 不可达（网络错误）时，抛出异常', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      await expect(parseIntent('测试输入')).rejects.toThrow();
    });
  });

  // ──────────────────────────────────────────────
  // parseAndCreate — POST /intent/create
  // ──────────────────────────────────────────────

  describe('parseAndCreate', () => {
    it('Brain 返回 200 时，正确返回 created 任务列表', async () => {
      const mockResponse = {
        created: {
          tasks: [{ title: '用户登录接口', id: 'task-001', priority: 'P1' }],
        },
        intentType: 'create_task',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await parseAndCreate('实现用户登录接口');

      expect(result.created.tasks).toHaveLength(1);
      expect(result.created.tasks[0].title).toBe('用户登录接口');
      expect(mockFetch).toHaveBeenCalledOnce();

      // 验证请求发到了 Brain intent create 端点
      const [url, options] = mockFetch.mock.calls[0];
      expect(String(url)).toContain('/intent/create');
      expect(options?.method).toBe('POST');
    });

    it('Brain 返回 503 时，抛出 Brain API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      await expect(parseAndCreate('测试输入')).rejects.toThrow('Brain API error');
    });

    it('带 options 参数时，正确透传到 Brain', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ created: { tasks: [] } }),
      });

      await parseAndCreate('添加功能', { priority: 'P0', domain: 'coding' });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options?.body as string);
      expect(body.options.priority).toBe('P0');
      expect(body.options.domain).toBe('coding');
    });
  });
});
