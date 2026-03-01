/**
 * notebook-adapter 测试
 *
 * 覆盖：通过 bridge HTTP 调用 NotebookLM CLI，降级处理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 保存原始 fetch
const originalFetch = globalThis.fetch;

describe('notebook-adapter', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  describe('queryNotebook', () => {
    it('通过 bridge 查询成功', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, text: '相关知识内容', elapsed_ms: 500 }),
      });

      const { queryNotebook } = await import('../notebook-adapter.js');
      const result = await queryNotebook('AI 学习方法');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/notebook/query'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ query: 'AI 学习方法' }),
        }),
      );
      expect(result).toEqual({ ok: true, text: '相关知识内容', elapsed_ms: 500 });
    });

    it('bridge 返回失败时安全传递', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: false, error: 'CLI not found', elapsed_ms: 100 }),
      });

      const { queryNotebook } = await import('../notebook-adapter.js');
      const result = await queryNotebook('test');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('CLI not found');
    });

    it('fetch 失败时安全降级', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const { queryNotebook } = await import('../notebook-adapter.js');
      const result = await queryNotebook('test');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Connection refused');
    });
  });

  describe('addSource', () => {
    it('通过 bridge 添加源成功', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, elapsed_ms: 200 }),
      });

      const { addSource } = await import('../notebook-adapter.js');
      const result = await addSource('https://example.com/article');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/notebook/add-source'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ url: 'https://example.com/article' }),
        }),
      );
      expect(result).toEqual({ ok: true, elapsed_ms: 200 });
    });

    it('bridge 返回失败时安全传递', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: false, error: 'Invalid URL', elapsed_ms: 50 }),
      });

      const { addSource } = await import('../notebook-adapter.js');
      const result = await addSource('bad-url');

      expect(result.ok).toBe(false);
    });

    it('fetch 失败时安全降级', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { addSource } = await import('../notebook-adapter.js');
      const result = await addSource('https://example.com');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('ECONNREFUSED');
    });
  });

  describe('addTextSource', () => {
    it('通过 bridge 添加内联文本源成功', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, elapsed_ms: 300 }),
      });

      const { addTextSource } = await import('../notebook-adapter.js');
      const result = await addTextSource('反刍洞察内容...', '反刍洞察: React 18 / Next.js 14');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/notebook/add-text-source'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: '反刍洞察内容...', title: '反刍洞察: React 18 / Next.js 14' }),
        }),
      );
      expect(result).toEqual({ ok: true, elapsed_ms: 300 });
    });

    it('fetch 失败时安全降级（不抛出异常）', async () => {
      mockFetch.mockRejectedValueOnce(new Error('bridge unavailable'));

      const { addTextSource } = await import('../notebook-adapter.js');
      const result = await addTextSource('some insight text', 'Title');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('bridge unavailable');
    });
  });
});
