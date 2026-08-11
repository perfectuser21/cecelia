import { describe, expect, it, vi } from 'vitest';
import { registerTaskPatchRoute } from '../task-task-patch.js';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function captureHandler(pool) {
  let handler;
  const router = {
    patch: vi.fn((path, registered) => {
      expect(path).toBe('/:id');
      handler = registered;
    }),
  };
  registerTaskPatchRoute(router, {
    pool,
    terminalStatuses: ['completed', 'failed', 'cancelled'],
  });
  return handler;
}

describe('registerTaskPatchRoute', () => {
  it('unresolved Harness Gap 存在时拒绝 blocked → queued', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          status: 'blocked',
          task_type: 'dev',
          orchestrator: null,
          has_unresolved_harness_gaps: true,
          has_pending_hard_dependencies: false,
        }],
      }),
    };
    const handler = captureHandler(pool);
    const response = createResponse();

    await handler({
      params: { id: 'source-task-1' },
      body: { status: 'queued' },
      headers: {},
    }, response);

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ error: 'harness_gap_dependencies_unresolved' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('空 PATCH 请求返回 400 且不写 tasks', async () => {
    const pool = { query: vi.fn() };
    const handler = captureHandler(pool);
    const response = createResponse();

    await handler({ params: { id: 'task-1' }, body: {}, headers: {} }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: 'No fields to update' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});
