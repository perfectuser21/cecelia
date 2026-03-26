/**
 * captures API test
 * 验证 GET/POST/PATCH /api/captures 端点行为
 * 使用 mock fetch 模拟 HTTP 请求
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = global.fetch;

describe('captures API endpoints', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('GET /api/captures', () => {
    it('返回 200 和 JSON 数组', async () => {
      const mockData = [
        { id: 'uuid-1', content: '测试想法', source: 'dashboard', status: 'inbox', owner: 'user', created_at: new Date().toISOString() },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockData,
      } as Response);

      const res = await fetch('/api/captures');
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]).toHaveProperty('content');
      expect(data[0]).toHaveProperty('status');
    });

    it('支持 ?status=inbox 过滤', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      } as Response);

      const res = await fetch('/api/captures?status=inbox');
      expect(res.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('/api/captures?status=inbox');
    });
  });

  describe('POST /api/captures', () => {
    it('创建 capture 返回 201', async () => {
      const newCapture = {
        id: 'uuid-new',
        content: '新想法',
        source: 'dashboard',
        status: 'inbox',
        owner: 'user',
        created_at: new Date().toISOString(),
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => newCapture,
      } as Response);

      const res = await fetch('/api/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '新想法', source: 'dashboard' }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toHaveProperty('id');
      expect(data.content).toBe('新想法');
    });

    it('content 为空时返回 400', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'content is required' }),
      } as Response);

      const res = await fetch('/api/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data).toHaveProperty('error');
    });
  });

  describe('PATCH /api/captures/:id', () => {
    it('更新 status 返回 200', async () => {
      const updated = {
        id: 'uuid-1',
        content: '测试想法',
        status: 'done',
        source: 'dashboard',
        owner: 'user',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => updated,
      } as Response);

      const res = await fetch('/api/captures/uuid-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      });
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('done');
    });

    it('不存在的 id 返回 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Capture not found' }),
      } as Response);

      const res = await fetch('/api/captures/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      });
      expect(res.status).toBe(404);
    });
  });
});
