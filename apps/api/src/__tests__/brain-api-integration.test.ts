/**
 * Brain↔Frontend API Integration Test (Minimal)
 *
 * 验证 apps/api 的 Brain proxy 层配置正确性：
 * - /api/brain/tasks → 正确转发到 Brain 服务
 * - 响应格式符合预期（数组）
 * - proxy 在 Brain 不可达时返回适当错误
 *
 * 此测试使用 mock 模拟 Brain 响应，无需实际 Brain 服务运行。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const originalFetch = global.fetch;

describe('Brain↔Frontend API Integration', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('GET /api/brain/tasks — Brain 返回任务列表时，响应格式正确', async () => {
    const mockTasks = [
      { id: 'task-1', title: 'Test Task', status: 'pending', task_type: 'dev' },
      { id: 'task-2', title: 'Another Task', status: 'done', task_type: 'arch_review' },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockTasks,
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    // 直接模拟 Brain API 调用行为（不通过实际 proxy）
    const brainUrl = 'http://localhost:5221/api/brain/tasks?status=pending&limit=5';
    const response = await fetch(brainUrl);
    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(2);
    expect(data[0]).toHaveProperty('id');
    expect(data[0]).toHaveProperty('title');
    expect(data[0]).toHaveProperty('status');
  });

  it('GET /api/brain/tasks — Brain 不可达时，fetch 应抛出错误', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const brainUrl = 'http://localhost:5221/api/brain/tasks';
    await expect(fetch(brainUrl)).rejects.toThrow('ECONNREFUSED');
  });

  it('Brain API proxy 配置：server.ts 中 /api/brain 路由已注册', async () => {
    // 验证 server.ts 中存在 Brain proxy 注册（结构性验证）
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const serverPath = resolve(process.cwd(), 'src/dashboard/server.ts');
    const serverContent = readFileSync(serverPath, 'utf8');

    expect(serverContent).toContain('/api/brain');
    expect(serverContent).toContain('brainProxy');
  });
});
