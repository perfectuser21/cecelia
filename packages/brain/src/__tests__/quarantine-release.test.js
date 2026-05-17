/**
 * quarantine-release.test.js - 隔离区自动释放机制测试（DB-mocked 版本）
 *
 * 所有数据库操作使用 vitest mock，无需真实 PostgreSQL 连接。
 * 测试逻辑：验证 quarantineTask 和 checkExpiredQuarantineTasks 的行为。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================
// Mock 所有外部依赖
// ============================================================

// 用于存储 mock 的任务数据（模拟数据库）
let tasksStore = {};

const mockPool = {
  query: vi.fn(),
};

vi.mock('../db.js', () => ({
  default: mockPool,
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../learning.js', () => ({
  upsertLearning: vi.fn().mockResolvedValue(undefined),
}));

// Mock alertness — 默认 NORMAL（允许释放）
vi.mock('../alertness/index.js', () => ({
  getCurrentAlertness: vi.fn(() => ({ level: 0, levelName: 'NORMAL' })),
  ALERTNESS_LEVELS: { NORMAL: 0, ELEVATED: 1, ALERT: 2, PANIC: 3 },
}));

// Mock llm-caller（quarantineTask 在 repeated_failure 时动态 import）
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({ text: '分析结果', model: 'test', provider: 'test', elapsed_ms: 10 }),
}));

// 导入被测模块
const {
  quarantineTask,
  checkExpiredQuarantineTasks,
  getQuarantinedTasks,
  QUARANTINE_REASONS,
  FAILURE_CLASS,
} = await import('../quarantine.js');

// ============================================================
// 辅助函数
// ============================================================

/**
 * 创建一个模拟任务对象
 */
function createMockTask(id, overrides = {}) {
  return {
    id,
    title: `TEST_task_${id}`,
    task_type: 'dev',
    status: 'queued',
    payload: {},
    ...overrides,
  };
}

/**
 * 配置 mockPool.query 使其模拟 DB 行为。
 * 支持 SELECT/UPDATE tasks 表基本操作。
 */
function setupMockDB(initialTasks = {}) {
  tasksStore = { ...initialTasks };

  mockPool.query.mockImplementation((sql, params) => {
    // SELECT task by ID
    if (sql.includes('SELECT') && sql.includes('FROM tasks') && sql.includes('$1') && params?.[0]) {
      const task = tasksStore[params[0]];
      return { rows: task ? [{ ...task }] : [] };
    }

    // UPDATE tasks SET status = 'quarantined'
    if (sql.includes('UPDATE tasks') && sql.includes("status = 'quarantined'") && params?.[0]) {
      const taskId = params[0];
      if (tasksStore[taskId]) {
        tasksStore[taskId].status = 'quarantined';
        if (params[1]) {
          const payloadUpdate = JSON.parse(params[1]);
          tasksStore[taskId].payload = { ...tasksStore[taskId].payload, ...payloadUpdate };
        }
      }
      return { rows: [] };
    }

    // UPDATE tasks SET status (release)
    if (sql.includes('UPDATE tasks') && sql.includes('SET status = $2') && params) {
      const [taskId, newStatus, newPayload] = params;
      if (tasksStore[taskId]) {
        tasksStore[taskId].status = newStatus;
        tasksStore[taskId].payload = JSON.parse(newPayload);
      }
      return { rows: [] };
    }

    // SELECT quarantined tasks with expired release_at
    if (sql.includes("status = 'quarantined'") && sql.includes('release_at')) {
      const expired = Object.values(tasksStore).filter(t => {
        if (t.status !== 'quarantined') return false;
        const releaseAt = t.payload?.quarantine_info?.release_at;
        if (!releaseAt || releaseAt === 'null') return false;
        return new Date(releaseAt) < new Date();
      });
      return { rows: expired };
    }

    // SELECT quarantined tasks (getQuarantinedTasks)
    if (sql.includes("status = 'quarantined'") && sql.includes('ORDER BY')) {
      const quarantined = Object.values(tasksStore).filter(t => t.status === 'quarantined');
      return { rows: quarantined };
    }

    return { rows: [] };
  });
}

// ============================================================
// 测试
// ============================================================

describe('Quarantine Auto-Release (mocked)', () => {
  const TEST_TASK_ID = 'test-task-001';

  beforeEach(() => {
    vi.clearAllMocks();
    setupMockDB({
      [TEST_TASK_ID]: createMockTask(TEST_TASK_ID),
    });
  });

  // ============================================================
  // quarantineTask 基本功能
  // ============================================================
  describe('quarantineTask 基本功能', () => {
    it('隔离任务后状态变为 quarantined', async () => {
      const result = await quarantineTask(TEST_TASK_ID, QUARANTINE_REASONS.RESOURCE_HOG, {
        failure_class: FAILURE_CLASS.RESOURCE,
      });

      expect(result.success).toBe(true);
      expect(tasksStore[TEST_TASK_ID].status).toBe('quarantined');
    });

    it('已隔离的任务不重复处理', async () => {
      // 先隔离
      await quarantineTask(TEST_TASK_ID, QUARANTINE_REASONS.RESOURCE_HOG, {
        failure_class: FAILURE_CLASS.RESOURCE,
      });

      // 再次隔离
      const result = await quarantineTask(TEST_TASK_ID, QUARANTINE_REASONS.RESOURCE_HOG, {
        failure_class: FAILURE_CLASS.RESOURCE,
      });

      expect(result.success).toBe(true);
      expect(result.already_quarantined).toBe(true);
    });

    it('不存在的任务返回失败', async () => {
      const result = await quarantineTask('non-existent', QUARANTINE_REASONS.RESOURCE_HOG, {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('Task not found');
    });
  });

  // ============================================================
  // TTL / release_at 计算
  // ============================================================
  describe('TTL 计算', () => {
    it('RESOURCE 类型 TTL 为 1 小时', async () => {
      await quarantineTask(TEST_TASK_ID, QUARANTINE_REASONS.RESOURCE_HOG, {
        failure_class: FAILURE_CLASS.RESOURCE,
      });

      const info = tasksStore[TEST_TASK_ID].payload?.quarantine_info;
      expect(info.ttl_ms).toBe(60 * 60 * 1000);
      expect(info.release_at).not.toBeNull();
    });

    it('NETWORK 类型 TTL 为 30 分钟', async () => {
      await quarantineTask(TEST_TASK_ID, QUARANTINE_REASONS.REPEATED_FAILURE, {
        failure_class: FAILURE_CLASS.NETWORK,
      });

      const info = tasksStore[TEST_TASK_ID].payload?.quarantine_info;
      expect(info.ttl_ms).toBe(30 * 60 * 1000);
    });

    it('RATE_LIMIT 类型 TTL 为 30 分钟', async () => {
      await quarantineTask(TEST_TASK_ID, QUARANTINE_REASONS.REPEATED_FAILURE, {
        failure_class: FAILURE_CLASS.RATE_LIMIT,
      });

      const info = tasksStore[TEST_TASK_ID].payload?.quarantine_info;
      expect(info.ttl_ms).toBe(30 * 60 * 1000);
    });

    it('repeated_failure 类型 TTL 为 24 小时', async () => {
      await quarantineTask(TEST_TASK_ID, QUARANTINE_REASONS.REPEATED_FAILURE, {
        failure_class: 'repeated_failure',
      });

      const info = tasksStore[TEST_TASK_ID].payload?.quarantine_info;
      expect(info.ttl_ms).toBe(24 * 60 * 60 * 1000);
    });

    it('BILLING_CAP 使用 reset_time', async () => {
      const resetTime = new Date(Date.now() + 3600000).toISOString();
      await quarantineTask(TEST_TASK_ID, QUARANTINE_REASONS.REPEATED_FAILURE, {
        failure_class: FAILURE_CLASS.BILLING_CAP,
        reset_time: resetTime,
      });

      const info = tasksStore[TEST_TASK_ID].payload?.quarantine_info;
      expect(info.release_at).toBe(resetTime);
    });

    it('MANUAL 类型永不自动释放（release_at = null）', async () => {
      await quarantineTask(TEST_TASK_ID, QUARANTINE_REASONS.MANUAL, {});

      const info = tasksStore[TEST_TASK_ID].payload?.quarantine_info;
      expect(info.release_at).toBeNull();
    });

    it('未知原因使用默认 30 分钟 TTL', async () => {
      await quarantineTask(TEST_TASK_ID, 'unknown_reason', {});

      const info = tasksStore[TEST_TASK_ID].payload?.quarantine_info;
      expect(info.ttl_ms).toBe(30 * 60 * 1000);
      expect(info.release_at).not.toBeNull();
    });
  });

  // ============================================================
  // checkExpiredQuarantineTasks — 自动释放
  // ============================================================
  describe('checkExpiredQuarantineTasks', () => {
    it('release_at 已过期的任务被释放', async () => {
      // 手动设置一个已过期的隔离任务
      tasksStore[TEST_TASK_ID] = {
        ...tasksStore[TEST_TASK_ID],
        status: 'quarantined',
        payload: {
          quarantine_info: {
            quarantined_at: new Date(Date.now() - 7200000).toISOString(),
            reason: QUARANTINE_REASONS.RESOURCE_HOG,
            failure_class: FAILURE_CLASS.RESOURCE,
            release_at: new Date(Date.now() - 60000).toISOString(), // 1 分钟前
            ttl_ms: 3600000,
            previous_status: 'queued',
          },
        },
      };

      const released = await checkExpiredQuarantineTasks();
      expect(released.length).toBe(1);
      expect(released[0].task_id).toBe(TEST_TASK_ID);
    });

    it('release_at 未过期的任务不释放', async () => {
      tasksStore[TEST_TASK_ID] = {
        ...tasksStore[TEST_TASK_ID],
        status: 'quarantined',
        payload: {
          quarantine_info: {
            quarantined_at: new Date().toISOString(),
            reason: QUARANTINE_REASONS.RESOURCE_HOG,
            failure_class: FAILURE_CLASS.RESOURCE,
            release_at: new Date(Date.now() + 3600000).toISOString(), // 1 小时后
            ttl_ms: 3600000,
            previous_status: 'queued',
          },
        },
      };

      const released = await checkExpiredQuarantineTasks();
      expect(released.length).toBe(0);
    });

    it('release_at 为 null 的任务不释放（MANUAL）', async () => {
      tasksStore[TEST_TASK_ID] = {
        ...tasksStore[TEST_TASK_ID],
        status: 'quarantined',
        payload: {
          quarantine_info: {
            quarantined_at: new Date().toISOString(),
            reason: QUARANTINE_REASONS.MANUAL,
            release_at: null,
            previous_status: 'queued',
          },
        },
      };

      const released = await checkExpiredQuarantineTasks();
      expect(released.length).toBe(0);
    });

    it('释放后任务状态变为 queued', async () => {
      tasksStore[TEST_TASK_ID] = {
        ...tasksStore[TEST_TASK_ID],
        status: 'quarantined',
        payload: {
          quarantine_info: {
            quarantined_at: new Date(Date.now() - 7200000).toISOString(),
            reason: QUARANTINE_REASONS.RESOURCE_HOG,
            failure_class: FAILURE_CLASS.RESOURCE,
            release_at: new Date(Date.now() - 60000).toISOString(),
            ttl_ms: 3600000,
            previous_status: 'queued',
          },
        },
      };

      await checkExpiredQuarantineTasks();
      expect(tasksStore[TEST_TASK_ID].status).toBe('queued');
    });

    it('REPEATED_FAILURE: 24 小时后允许重试一次', async () => {
      tasksStore[TEST_TASK_ID] = {
        ...tasksStore[TEST_TASK_ID],
        status: 'quarantined',
        payload: {
          quarantine_info: {
            quarantined_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
            reason: QUARANTINE_REASONS.REPEATED_FAILURE,
            failure_class: 'repeated_failure',
            release_at: new Date(Date.now() - 3600000).toISOString(), // 1 小时前过期
            ttl_ms: 24 * 60 * 60 * 1000,
            previous_status: 'queued',
          },
        },
      };

      const released = await checkExpiredQuarantineTasks();
      expect(released.some(r => r.task_id === TEST_TASK_ID)).toBe(true);
    });

    it('多个过期任务同时释放', async () => {
      const task2Id = 'test-task-002';
      const task3Id = 'test-task-003';

      const expiredPayload = (reason, fc) => ({
        quarantine_info: {
          quarantined_at: new Date(Date.now() - 7200000).toISOString(),
          reason,
          failure_class: fc,
          release_at: new Date(Date.now() - 60000).toISOString(),
          ttl_ms: 3600000,
          previous_status: 'queued',
        },
      });

      tasksStore[TEST_TASK_ID] = {
        ...createMockTask(TEST_TASK_ID),
        status: 'quarantined',
        payload: expiredPayload(QUARANTINE_REASONS.RESOURCE_HOG, FAILURE_CLASS.RESOURCE),
      };
      tasksStore[task2Id] = {
        ...createMockTask(task2Id),
        status: 'quarantined',
        payload: expiredPayload(QUARANTINE_REASONS.TIMEOUT_PATTERN, FAILURE_CLASS.NETWORK),
      };
      tasksStore[task3Id] = {
        ...createMockTask(task3Id),
        status: 'quarantined',
        payload: expiredPayload(QUARANTINE_REASONS.SUSPICIOUS_INPUT, 'unknown'),
      };

      const released = await checkExpiredQuarantineTasks();
      expect(released.length).toBe(3);
    });

    it('BILLING_CAP: reset_time 过后自动释放', async () => {
      tasksStore[TEST_TASK_ID] = {
        ...tasksStore[TEST_TASK_ID],
        status: 'quarantined',
        payload: {
          quarantine_info: {
            quarantined_at: new Date(Date.now() - 7200000).toISOString(),
            reason: QUARANTINE_REASONS.REPEATED_FAILURE,
            failure_class: FAILURE_CLASS.BILLING_CAP,
            release_at: new Date(Date.now() - 60000).toISOString(),
            previous_status: 'queued',
          },
        },
      };

      const released = await checkExpiredQuarantineTasks();
      expect(released.some(r => r.task_id === TEST_TASK_ID)).toBe(true);
    });
  });

  // ============================================================
  // Alertness 高时不释放
  // ============================================================
  describe('Alertness 保护', () => {
    it('Alertness >= ALERT 时不释放任何任务', async () => {
      // 设置 alertness 为 ALERT
      const { getCurrentAlertness } = await import('../alertness/index.js');
      getCurrentAlertness.mockReturnValue({ level: 2, levelName: 'ALERT' });

      tasksStore[TEST_TASK_ID] = {
        ...tasksStore[TEST_TASK_ID],
        status: 'quarantined',
        payload: {
          quarantine_info: {
            quarantined_at: new Date(Date.now() - 7200000).toISOString(),
            reason: QUARANTINE_REASONS.RESOURCE_HOG,
            failure_class: FAILURE_CLASS.RESOURCE,
            release_at: new Date(Date.now() - 60000).toISOString(),
            ttl_ms: 3600000,
            previous_status: 'queued',
          },
        },
      };

      const released = await checkExpiredQuarantineTasks();
      expect(released.length).toBe(0);

      // 恢复
      getCurrentAlertness.mockReturnValue({ level: 0, levelName: 'NORMAL' });
    });
  });
});
