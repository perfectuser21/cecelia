/**
 * Task Retry Service Tests
 * 覆盖执行阶段记录、失败诊断、重试判断、重试执行等核心逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Mock 数据库连接（vi.hoisted 保证在 vi.mock 提升后仍可访问）
// ============================================================

const { mockClient, mockPool } = vi.hoisted(() => {
  const mc = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const mp = {
    query: vi.fn(),
    connect: vi.fn(() => Promise.resolve(mc)),
  };
  return { mockClient: mc, mockPool: mp };
});

vi.mock('../db.js', () => ({ default: mockPool }));

import {
  EXECUTION_PHASES,
  FAILURE_TYPES,
  diagnoseFailure,
  shouldRetry,
} from '../task-retry.js';

// ============================================================
// 重置 mock 状态
// ============================================================

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockPool.query.mockReset();
  mockPool.connect.mockResolvedValue(mockClient);
});

// ============================================================
// 1. EXECUTION_PHASES 常量测试
// ============================================================

describe('EXECUTION_PHASES', () => {
  it('应包含 5 个关键阶段', () => {
    expect(Object.keys(EXECUTION_PHASES)).toHaveLength(5);
    expect(EXECUTION_PHASES.PRD_GENERATION).toBe('prd_generation');
    expect(EXECUTION_PHASES.CODE_WRITING).toBe('code_writing');
    expect(EXECUTION_PHASES.PR_CREATION).toBe('pr_creation');
    expect(EXECUTION_PHASES.CI_CHECK).toBe('ci_check');
    expect(EXECUTION_PHASES.MERGE).toBe('merge');
  });
});

// ============================================================
// 2. diagnoseFailure 失败诊断测试
// ============================================================

describe('diagnoseFailure', () => {
  describe('CI 超时（transient）', () => {
    it('识别 CI timeout', () => {
      const result = diagnoseFailure('CI timed out after 10 minutes');
      expect(result.type).toBe(FAILURE_TYPES.TRANSIENT);
      expect(result.retryable).toBe(true);
      expect(result.reason).toContain('CI 超时');
    });

    it('识别 ci timeout 变体', () => {
      const result = diagnoseFailure('ci time out');
      expect(result.type).toBe(FAILURE_TYPES.TRANSIENT);
      expect(result.retryable).toBe(true);
    });
  });

  describe('网络错误（transient）', () => {
    it('识别 network error', () => {
      const result = diagnoseFailure('network error: connection failed');
      expect(result.type).toBe(FAILURE_TYPES.TRANSIENT);
      expect(result.retryable).toBe(true);
      expect(result.reason).toContain('网络错误');
    });

    it('识别 ECONNREFUSED', () => {
      const result = diagnoseFailure('ECONNREFUSED 127.0.0.1:5221');
      expect(result.type).toBe(FAILURE_TYPES.TRANSIENT);
      expect(result.retryable).toBe(true);
    });

    it('识别 rate limit', () => {
      const result = diagnoseFailure('Error: Rate limit exceeded');
      expect(result.type).toBe(FAILURE_TYPES.TRANSIENT);
      expect(result.retryable).toBe(true);
      expect(result.reason).toContain('API 限流');
    });
  });

  describe('Merge 冲突（transient）', () => {
    it('识别 merge conflict', () => {
      const result = diagnoseFailure('merge conflict in src/index.js');
      expect(result.type).toBe(FAILURE_TYPES.TRANSIENT);
      expect(result.retryable).toBe(true);
      expect(result.reason).toContain('Merge 冲突');
    });
  });

  describe('服务器错误（transient）', () => {
    it('识别 503 错误', () => {
      const result = diagnoseFailure('server error 503');
      expect(result.type).toBe(FAILURE_TYPES.TRANSIENT);
      expect(result.retryable).toBe(true);
    });

    it('识别 server unavailable', () => {
      const result = diagnoseFailure('server unavailable');
      expect(result.type).toBe(FAILURE_TYPES.TRANSIENT);
      expect(result.retryable).toBe(true);
    });
  });

  describe('PRD 不合规（permanent）', () => {
    it('识别 PRD invalid', () => {
      const result = diagnoseFailure('PRD invalid: missing success criteria');
      expect(result.type).toBe(FAILURE_TYPES.PERMANENT);
      expect(result.retryable).toBe(false);
      expect(result.reason).toContain('PRD 不合规');
    });

    it('识别 PRD missing', () => {
      const result = diagnoseFailure('PRD missing for this task');
      expect(result.type).toBe(FAILURE_TYPES.PERMANENT);
      expect(result.retryable).toBe(false);
    });
  });

  describe('权限拒绝（permanent）', () => {
    it('识别 permission denied', () => {
      const result = diagnoseFailure('permission denied: cannot write to /etc');
      expect(result.type).toBe(FAILURE_TYPES.PERMANENT);
      expect(result.retryable).toBe(false);
      expect(result.reason).toContain('权限拒绝');
    });

    it('识别 403 Forbidden', () => {
      const result = diagnoseFailure('Forbidden access to resource');
      expect(result.type).toBe(FAILURE_TYPES.PERMANENT);
      expect(result.retryable).toBe(false);
    });
  });

  describe('未知错误', () => {
    it('对空字符串返回 transient（保守）', () => {
      const result = diagnoseFailure('');
      expect(result.type).toBe(FAILURE_TYPES.TRANSIENT);
      expect(result.retryable).toBe(true);
    });

    it('对 null 返回 transient（保守）', () => {
      const result = diagnoseFailure(null);
      expect(result.type).toBe(FAILURE_TYPES.TRANSIENT);
      expect(result.retryable).toBe(true);
    });

    it('对未匹配错误返回 transient（保守）', () => {
      const result = diagnoseFailure('some weird unknown error xyzabc');
      expect(result.type).toBe(FAILURE_TYPES.TRANSIENT);
      expect(result.retryable).toBe(true);
    });
  });
});

// ============================================================
// 3. shouldRetry 重试判断测试
// ============================================================

describe('shouldRetry', () => {
  it('任务为 null 时不重试', () => {
    const result = shouldRetry(null);
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toContain('不存在');
  });

  it('非 failed 状态不重试（completed）', () => {
    const task = { status: 'completed', retry_count: 0, max_retries: 3, payload: {} };
    const result = shouldRetry(task);
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toContain('completed');
  });

  it('非 failed 状态不重试（queued）', () => {
    const task = { status: 'queued', retry_count: 0, max_retries: 3, payload: {} };
    const result = shouldRetry(task);
    expect(result.shouldRetry).toBe(false);
  });

  it('超过 max_retries 不重试', () => {
    const task = { status: 'failed', retry_count: 3, max_retries: 3, payload: {} };
    const result = shouldRetry(task);
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toContain('最大重试次数');
  });

  it('retry_count 等于 max_retries 不重试', () => {
    const task = { status: 'failed', retry_count: 5, max_retries: 3, payload: {} };
    const result = shouldRetry(task);
    expect(result.shouldRetry).toBe(false);
  });

  it('last_error 为 permanent 时不重试', () => {
    const task = {
      status: 'failed',
      retry_count: 1,
      max_retries: 3,
      payload: {
        last_error: {
          type: FAILURE_TYPES.PERMANENT,
          reason: 'PRD 不合规',
        },
      },
    };
    const result = shouldRetry(task);
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toContain('permanent');
  });

  it('符合条件时应该重试', () => {
    const task = {
      status: 'failed',
      retry_count: 1,
      max_retries: 3,
      payload: {},
    };
    const result = shouldRetry(task);
    expect(result.shouldRetry).toBe(true);
    expect(result.reason).toContain('第 2/3 次重试');
  });

  it('首次失败（retry_count=0）应该重试', () => {
    const task = {
      status: 'failed',
      retry_count: 0,
      max_retries: 3,
      payload: {},
    };
    const result = shouldRetry(task);
    expect(result.shouldRetry).toBe(true);
    expect(result.reason).toContain('第 1/3 次重试');
  });

  it('max_retries 为 null 时使用默认值 3', () => {
    const task = {
      status: 'failed',
      retry_count: 0,
      max_retries: null,
      payload: {},
    };
    const result = shouldRetry(task);
    expect(result.shouldRetry).toBe(true);
  });

  it('last_error 为 transient 时可以重试', () => {
    const task = {
      status: 'failed',
      retry_count: 1,
      max_retries: 3,
      payload: {
        last_error: {
          type: FAILURE_TYPES.TRANSIENT,
          reason: 'CI 超时',
        },
      },
    };
    const result = shouldRetry(task);
    expect(result.shouldRetry).toBe(true);
  });
});

// ============================================================
// 4. recordExecutionPhase 测试（需要 DB mock）
// ============================================================

describe('recordExecutionPhase', () => {
  it('taskId 为空时返回错误', async () => {
    const { recordExecutionPhase } = await import('../task-retry.js');
    const result = await recordExecutionPhase('', 'prd_generation', 'success');
    expect(result.success).toBe(false);
    expect(result.error).toContain('taskId is required');
  });

  it('phase 为空时返回错误', async () => {
    const { recordExecutionPhase } = await import('../task-retry.js');
    const result = await recordExecutionPhase('task-123', '', 'success');
    expect(result.success).toBe(false);
    expect(result.error).toContain('phase is required');
  });

  it('无效 status 时返回错误', async () => {
    const { recordExecutionPhase } = await import('../task-retry.js');
    const result = await recordExecutionPhase('task-123', 'prd_generation', 'invalid_status');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid phase status');
  });

  it('成功记录阶段', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-123', execution_phases: [{ phase: 'prd_generation', status: 'success' }] }],
    });

    const { recordExecutionPhase } = await import('../task-retry.js');
    const result = await recordExecutionPhase('task-123', 'prd_generation', 'success', { note: 'test' });
    expect(result.success).toBe(true);
    expect(result.phase.phase).toBe('prd_generation');
    expect(result.phase.status).toBe('success');
    expect(result.phase.note).toBe('test');
    expect(result.phase.ended_at).toBeDefined();
  });

  it('in_progress 状态设置 started_at', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-123', execution_phases: [] }],
    });

    const { recordExecutionPhase } = await import('../task-retry.js');
    const result = await recordExecutionPhase('task-123', 'code_writing', 'in_progress');
    expect(result.success).toBe(true);
    expect(result.phase.started_at).toBeDefined();
    expect(result.phase.ended_at).toBeUndefined();
  });

  it('任务不存在时返回错误', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const { recordExecutionPhase } = await import('../task-retry.js');
    const result = await recordExecutionPhase('non-existent', 'prd_generation', 'success');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

// ============================================================
// 5. retryTask 测试
// ============================================================

describe('retryTask', () => {
  it('任务不存在时返回错误', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }); // SELECT ... FOR UPDATE

    const { retryTask } = await import('../task-retry.js');
    const result = await retryTask('non-existent', 'test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('超过重试次数时返回错误', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ // SELECT ... FOR UPDATE
        rows: [{
          id: 'task-123',
          status: 'failed',
          retry_count: 3,
          max_retries: 3,
          payload: {},
        }],
      })
      .mockResolvedValueOnce(undefined); // ROLLBACK

    const { retryTask } = await import('../task-retry.js');
    const result = await retryTask('task-123', 'some error');
    expect(result.success).toBe(false);
    expect(result.error).toContain('最大重试次数');
  });

  it('成功执行重试', async () => {
    const mockTask = {
      id: 'task-123',
      status: 'failed',
      retry_count: 1,
      max_retries: 3,
      payload: {
        retry_history: [{ attempt: 1, reason: 'first failure' }],
      },
    };

    mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [mockTask] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ // UPDATE tasks
        rows: [{
          ...mockTask,
          status: 'queued',
          retry_count: 2,
          payload: {
            retry_history: [
              { attempt: 1, reason: 'first failure' },
              { attempt: 2, reason: 'CI timeout', failure_type: 'transient' },
            ],
            last_error: {
              message: 'CI timeout',
              type: 'transient',
            },
          },
        }],
      })
      .mockResolvedValueOnce(undefined); // COMMIT

    const { retryTask } = await import('../task-retry.js');
    const result = await retryTask('task-123', 'CI timeout');
    expect(result.success).toBe(true);
    expect(result.task.status).toBe('queued');
    expect(result.task.retry_count).toBe(2);
  });

  it('permanent 错误不重试', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ // SELECT ... FOR UPDATE
        rows: [{
          id: 'task-123',
          status: 'failed',
          retry_count: 1,
          max_retries: 3,
          payload: {
            last_error: {
              type: FAILURE_TYPES.PERMANENT,
              reason: 'PRD 不合规',
            },
          },
        }],
      })
      .mockResolvedValueOnce(undefined); // ROLLBACK

    const { retryTask } = await import('../task-retry.js');
    const result = await retryTask('task-123', 'some error');
    expect(result.success).toBe(false);
    expect(result.error).toContain('permanent');
  });
});

// ============================================================
// 6. getExecutionStatus 测试
// ============================================================

describe('getExecutionStatus', () => {
  it('任务不存在时返回错误', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const { getExecutionStatus } = await import('../task-retry.js');
    const result = await getExecutionStatus('non-existent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('返回完整执行状态', async () => {
    const mockPayload = {
      execution_phases: [
        { phase: 'prd_generation', status: 'success' },
        { phase: 'code_writing', status: 'failed' },
      ],
      retry_history: [{ attempt: 1, reason: 'CI timeout' }],
      last_error: { message: 'CI timeout', type: 'transient' },
    };

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'task-123',
        title: 'Test Task',
        status: 'failed',
        retry_count: 1,
        max_retries: 3,
        payload: mockPayload,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }],
    });

    const { getExecutionStatus } = await import('../task-retry.js');
    const result = await getExecutionStatus('task-123');
    expect(result.success).toBe(true);
    const status = result.execution_status;
    expect(status.task_id).toBe('task-123');
    expect(status.title).toBe('Test Task');
    expect(status.retry_count).toBe(1);
    expect(status.max_retries).toBe(3);
    expect(status.execution_phases).toHaveLength(2);
    expect(status.retry_history).toHaveLength(1);
    expect(status.last_error.type).toBe('transient');
  });

  it('payload 为空时返回默认空值', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'task-456',
        title: 'Empty Task',
        status: 'queued',
        retry_count: 0,
        max_retries: 3,
        payload: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }],
    });

    const { getExecutionStatus } = await import('../task-retry.js');
    const result = await getExecutionStatus('task-456');
    expect(result.success).toBe(true);
    expect(result.execution_status.execution_phases).toEqual([]);
    expect(result.execution_status.retry_history).toEqual([]);
    expect(result.execution_status.last_error).toBeNull();
  });
});
