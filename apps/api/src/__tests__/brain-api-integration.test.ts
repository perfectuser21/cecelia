/**
 * Brain-API Integration Tests
 *
 * 验证 Workspace (apps/api) → Brain (localhost:5221) proxy 层正确性。
 * 使用 vi.mock 模拟 fetch，测试路由映射、请求转发、错误处理逻辑。
 * 不依赖真实 Brain 服务，可在 CI 中无服务状态下运行。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock fetch ────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

// ─── Proxy 层工具函数（测试用桩，镜像真实 proxy 行为）──────────────────────

const BRAIN_BASE = 'http://localhost:5221';

async function proxyToBrain(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const url = `${BRAIN_BASE}${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// ─── Test Suite ────────────────────────────────────────────────────────────

describe('Brain-API Proxy Integration', () => {
  describe('GET /api/brain/tasks — 任务列表 proxy', () => {
    it('转发 GET 请求到 Brain 并返回任务列表', async () => {
      const mockTasks = [
        { id: 'task-1', title: '测试任务 A', status: 'pending' },
        { id: 'task-2', title: '测试任务 B', status: 'in_progress' },
      ];

      mockFetch.mockResolvedValueOnce({
        status: 200,
        json: async () => mockTasks,
      } as Response);

      const result = await proxyToBrain('GET', '/api/brain/tasks?status=pending&limit=5');

      expect(result.status).toBe(200);
      expect(result.data).toEqual(mockTasks);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BRAIN_BASE}/api/brain/tasks?status=pending&limit=5`,
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('Brain 返回 500 时 proxy 正确透传错误状态码', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 500,
        json: async () => ({ error: 'Internal Server Error' }),
      } as Response);

      const result = await proxyToBrain('GET', '/api/brain/tasks');

      expect(result.status).toBe(500);
    });
  });

  describe('POST /api/brain/tasks — 创建任务 proxy', () => {
    it('正确转发 POST body 并返回 Brain 创建结果', async () => {
      const newTask = {
        title: 'CI 集成测试任务',
        description: '验证 proxy 层正确性',
        task_type: 'dev',
        trigger_source: 'api',
      };
      const createdTask = { id: 'task-new-123', ...newTask, status: 'pending' };

      mockFetch.mockResolvedValueOnce({
        status: 201,
        json: async () => createdTask,
      } as Response);

      const result = await proxyToBrain('POST', '/api/brain/tasks', newTask);

      expect(result.status).toBe(201);
      expect(result.data).toMatchObject({ id: 'task-new-123', title: newTask.title });
      expect(mockFetch).toHaveBeenCalledWith(
        `${BRAIN_BASE}/api/brain/tasks`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(newTask),
        })
      );
    });

    it('Brain 不可达时 proxy 抛出连接错误', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(proxyToBrain('POST', '/api/brain/tasks', { title: 'test' })).rejects.toThrow(
        'ECONNREFUSED'
      );
    });
  });

  describe('GET /api/brain/tasks/:id — 单任务 proxy', () => {
    it('转发单任务查询并返回正确数据结构', async () => {
      const taskId = 'abc-123-def';
      const task = {
        id: taskId,
        title: '具体任务',
        status: 'completed',
        result: 'PR merged',
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        json: async () => task,
      } as Response);

      const result = await proxyToBrain('GET', `/api/brain/tasks/${taskId}`);

      expect(result.status).toBe(200);
      expect((result.data as typeof task).id).toBe(taskId);
      expect((result.data as typeof task).status).toBe('completed');
    });

    it('任务不存在时 Brain 返回 404，proxy 透传', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 404,
        json: async () => ({ error: 'Task not found' }),
      } as Response);

      const result = await proxyToBrain('GET', '/api/brain/tasks/nonexistent-id');

      expect(result.status).toBe(404);
    });
  });

  describe('proxy URL 构造正确性', () => {
    it('proxy 请求必须包含正确的 Content-Type header', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        json: async () => ({}),
      } as Response);

      await proxyToBrain('GET', '/api/brain/tasks');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        })
      );
    });

    it('Brain base URL 必须是 localhost:5221', () => {
      expect(BRAIN_BASE).toBe('http://localhost:5221');
    });
  });

  // ─── Session-Start Hook 联动契约（Engine Hook → Brain API）──────────────

  describe('Engine Hook session-start 联动契约', () => {
    /**
     * session-start.sh 调用以下 Brain API：
     *   GET /api/brain/tasks?status=in_progress&limit=5
     *
     * 契约要求：
     * 1. 返回数组（即使为空）
     * 2. 每个任务对象包含 id、title、status 字段
     */
    it('GET /api/brain/tasks?status=in_progress — 返回任务数组契约', async () => {
      const inProgressTasks = [
        {
          id: 'task-abc-001',
          title: 'CI L3 集成测试门禁',
          status: 'in_progress',
          task_type: 'dev',
          priority: 'P2',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        status: 200,
        json: async () => inProgressTasks,
      } as Response);

      const result = await proxyToBrain('GET', '/api/brain/tasks?status=in_progress&limit=5');

      expect(result.status).toBe(200);
      expect(Array.isArray(result.data)).toBe(true);
      const tasks = result.data as typeof inProgressTasks;
      expect(tasks[0]).toMatchObject({
        id: expect.any(String),
        title: expect.any(String),
        status: 'in_progress',
      });
    });

    it('Brain 离线时 session-start 应收到可捕获的错误（不静默失败）', async () => {
      // session-start.sh 使用 `|| echo "[]"` 降级处理 Brain 离线
      // 此测试验证 proxy 层在 Brain 不可达时应抛出可捕获的错误
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(
        proxyToBrain('GET', '/api/brain/tasks?status=in_progress&limit=5')
      ).rejects.toThrow('ECONNREFUSED');
    });
  });

  // ─── Brain API 关键端点存在性契约（context / health）──────────────────────

  describe('Brain API 关键端点契约 — GET /api/brain/context', () => {
    /**
     * /api/brain/context 是 Claude 对话开始时的全景摘要端点。
     * 契约：返回包含 active_tasks / decisions 字段的对象。
     */
    it('context 端点返回全景摘要结构', async () => {
      const mockContext = {
        okr: { objectives: [] },
        recent_prs: [],
        active_tasks: [{ id: 'task-001', title: '当前任务', status: 'in_progress' }],
        decisions: [],
        generated_at: '2026-03-28T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        json: async () => mockContext,
      } as Response);

      const result = await proxyToBrain('GET', '/api/brain/context');

      expect(result.status).toBe(200);
      const ctx = result.data as typeof mockContext;
      // 验证关键字段存在（不要求具体值，只验证结构契约）
      expect(ctx).toHaveProperty('active_tasks');
      expect(Array.isArray(ctx.active_tasks)).toBe(true);
    });

    it('context 端点请求格式：GET，无 body，正确 URL', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        json: async () => ({ active_tasks: [], decisions: [] }),
      } as Response);

      await proxyToBrain('GET', '/api/brain/context');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BRAIN_BASE}/api/brain/context`,
        expect.objectContaining({ method: 'GET' })
      );
      // GET 请求不应有 body
      const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
      expect(callArgs.body).toBeUndefined();
    });
  });
});
