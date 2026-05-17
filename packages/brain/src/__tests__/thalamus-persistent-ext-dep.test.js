/**
 * Tests for persistent external dependency failure detection in Thalamus
 *
 * 修复背景：同 fingerprint ≥ 3 次的外部依赖故障必须立即 quarantine+rca，永不 retry。
 * 原问题：quickRoute 对 TASK_FAILED 只检查 per-task retry_count，不检测跨任务 fingerprint，
 *         导致 14 天 168 次无效派发。
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';

let pool;
let detectPersistentExtDepFailure, _classifyExtDepError, EXTERNAL_DEP_FAILURE_CLASSES,
    PERSISTENT_EXT_DEP_THRESHOLD, processEvent, EVENT_TYPES;

beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../db.js')).default;
  ({
    detectPersistentExtDepFailure,
    _classifyExtDepError,
    EXTERNAL_DEP_FAILURE_CLASSES,
    PERSISTENT_EXT_DEP_THRESHOLD,
    processEvent,
    EVENT_TYPES,
  } = await import('../thalamus.js'));
});

// ============================================================
// _classifyExtDepError 纯函数单元测试（无需 DB）
// ============================================================

describe('_classifyExtDepError', () => {
  it('应识别 ECONNREFUSED 为 network', () => {
    expect(_classifyExtDepError('ECONNREFUSED: connection refused')).toBe('network');
  });

  it('应识别 ETIMEDOUT 为 network', () => {
    expect(_classifyExtDepError('ETIMEDOUT: operation timed out')).toBe('network');
  });

  it('应识别 service unavailable 为 network', () => {
    expect(_classifyExtDepError('503 Service Unavailable')).toBe('network');
  });

  it('应识别 429/rate limit 为 rate_limit', () => {
    expect(_classifyExtDepError('429 Too many requests')).toBe('rate_limit');
    expect(_classifyExtDepError('rate limit exceeded')).toBe('rate_limit');
  });

  it('应识别 spending cap 为 billing_cap', () => {
    expect(_classifyExtDepError('Spending cap reached')).toBe('billing_cap');
  });

  it('应识别 unauthorized/forbidden 为 auth', () => {
    expect(_classifyExtDepError('401 Unauthorized')).toBe('auth');
    expect(_classifyExtDepError('403 Forbidden')).toBe('auth');
  });

  it('应识别 out of memory 为 resource', () => {
    expect(_classifyExtDepError('ENOMEM: out of memory')).toBe('resource');
  });

  it('对普通错误应返回 null', () => {
    expect(_classifyExtDepError('undefined is not a function')).toBeNull();
    expect(_classifyExtDepError('SyntaxError: unexpected token')).toBeNull();
  });

  it('对空/null 应返回 null', () => {
    expect(_classifyExtDepError('')).toBeNull();
    expect(_classifyExtDepError(null)).toBeNull();
    expect(_classifyExtDepError(undefined)).toBeNull();
  });
});

// ============================================================
// EXTERNAL_DEP_FAILURE_CLASSES 常量验证（无需 DB）
// ============================================================

describe('EXTERNAL_DEP_FAILURE_CLASSES', () => {
  it('应包含所有外部依赖类型', () => {
    expect(EXTERNAL_DEP_FAILURE_CLASSES.has('network')).toBe(true);
    expect(EXTERNAL_DEP_FAILURE_CLASSES.has('rate_limit')).toBe(true);
    expect(EXTERNAL_DEP_FAILURE_CLASSES.has('billing_cap')).toBe(true);
    expect(EXTERNAL_DEP_FAILURE_CLASSES.has('resource')).toBe(true);
    expect(EXTERNAL_DEP_FAILURE_CLASSES.has('auth')).toBe(true);
  });

  it('不应包含 task_error 或 unknown', () => {
    expect(EXTERNAL_DEP_FAILURE_CLASSES.has('task_error')).toBe(false);
    expect(EXTERNAL_DEP_FAILURE_CLASSES.has('unknown')).toBe(false);
  });
});

// ============================================================
// PERSISTENT_EXT_DEP_THRESHOLD 常量验证（无需 DB）
// ============================================================

describe('PERSISTENT_EXT_DEP_THRESHOLD', () => {
  it('阈值应为 3', () => {
    expect(PERSISTENT_EXT_DEP_THRESHOLD).toBe(3);
  });
});

// ============================================================
// detectPersistentExtDepFailure 集成测试（需要真实 DB）
// ============================================================

describe('detectPersistentExtDepFailure', () => {
  const TEST_PREFIX = 'test-persistent-ext-dep';

  beforeEach(async () => {
    await pool.query(`DELETE FROM tasks WHERE title LIKE $1`, [`${TEST_PREFIX}%`]);
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM tasks WHERE title LIKE $1`, [`${TEST_PREFIX}%`]);
  });

  it('当前任务无 error_message 且无同类他任务时，应返回 isPersistent=false', async () => {
    const res = await pool.query(`
      INSERT INTO tasks (title, status, error_message)
      VALUES ($1, 'failed', NULL)
      RETURNING id
    `, [`${TEST_PREFIX}-no-error`]);
    const taskId = res.rows[0].id;

    const result = await detectPersistentExtDepFailure({ task_id: taskId });
    expect(result.isPersistent).toBe(false);
  });

  it('普通任务错误（非外部依赖）不应触发 isPersistent', async () => {
    const res = await pool.query(`
      INSERT INTO tasks (title, status, error_message)
      VALUES ($1, 'failed', 'SyntaxError: unexpected token')
      RETURNING id
    `, [`${TEST_PREFIX}-code-error`]);
    const taskId = res.rows[0].id;

    const result = await detectPersistentExtDepFailure({ task_id: taskId });
    expect(result.isPersistent).toBe(false);
  });

  it('网络错误 < 3 次时应返回 isPersistent=false', async () => {
    // 1 个其他已处理任务（payload.failure_class）+ 当前任务 = 2 次，未达阈值
    await pool.query(`
      INSERT INTO tasks (title, status, payload, updated_at)
      VALUES ($1, 'failed', '{"failure_class":"network"}'::jsonb, NOW())
    `, [`${TEST_PREFIX}-other-network-1`]);

    const currentRes = await pool.query(`
      INSERT INTO tasks (title, status, error_message)
      VALUES ($1, 'failed', 'ECONNREFUSED: connection refused to github.com')
      RETURNING id
    `, [`${TEST_PREFIX}-current-network`]);
    const currentId = currentRes.rows[0].id;

    const result = await detectPersistentExtDepFailure({ task_id: currentId });
    expect(result.isPersistent).toBe(false);
  });

  it('网络错误达到 3 次（2 个他任务 + 1 个当前）应返回 isPersistent=true', async () => {
    // 2 个其他任务已有 failure_class=network
    for (let i = 0; i < 2; i++) {
      await pool.query(`
        INSERT INTO tasks (title, status, payload, updated_at)
        VALUES ($1, 'failed', '{"failure_class":"network"}'::jsonb, NOW())
      `, [`${TEST_PREFIX}-other-network-${i}`]);
    }

    // 当前任务有 ECONNREFUSED error_message
    const currentRes = await pool.query(`
      INSERT INTO tasks (title, status, error_message)
      VALUES ($1, 'failed', 'ECONNREFUSED: connection refused')
      RETURNING id
    `, [`${TEST_PREFIX}-current-network`]);
    const currentId = currentRes.rows[0].id;

    const result = await detectPersistentExtDepFailure({ task_id: currentId });
    expect(result.isPersistent).toBe(true);
    expect(result.failureClass).toBe('network');
    expect(result.count).toBeGreaterThanOrEqual(3);
    expect(result.fingerprint).toBe('ext_dep:network');
  });

  it('rate_limit 错误达到 3 次应返回 isPersistent=true', async () => {
    for (let i = 0; i < 2; i++) {
      await pool.query(`
        INSERT INTO tasks (title, status, payload, updated_at)
        VALUES ($1, 'failed', '{"failure_class":"rate_limit"}'::jsonb, NOW())
      `, [`${TEST_PREFIX}-other-ratelimit-${i}`]);
    }

    const currentRes = await pool.query(`
      INSERT INTO tasks (title, status, error_message)
      VALUES ($1, 'failed', '429 Too many requests')
      RETURNING id
    `, [`${TEST_PREFIX}-current-ratelimit`]);
    const currentId = currentRes.rows[0].id;

    const result = await detectPersistentExtDepFailure({ task_id: currentId });
    expect(result.isPersistent).toBe(true);
    expect(result.failureClass).toBe('rate_limit');
  });

  it('超出时间窗口的旧失败不计入 count', async () => {
    // 2 个他任务 updated_at 超出 30 分钟窗口
    for (let i = 0; i < 2; i++) {
      await pool.query(`
        INSERT INTO tasks (title, status, payload, updated_at)
        VALUES ($1, 'failed', '{"failure_class":"network"}'::jsonb, NOW() - INTERVAL '35 minutes')
      `, [`${TEST_PREFIX}-old-network-${i}`]);
    }

    const currentRes = await pool.query(`
      INSERT INTO tasks (title, status, error_message)
      VALUES ($1, 'failed', 'ECONNREFUSED: connection refused')
      RETURNING id
    `, [`${TEST_PREFIX}-current-network`]);
    const currentId = currentRes.rows[0].id;

    const result = await detectPersistentExtDepFailure({ task_id: currentId });
    // 窗口内只有当前任务 1 次，未达阈值
    expect(result.isPersistent).toBe(false);
  });

  it('当前任务用 payload.failure_class 而非 error_message 分类（提前写入场景）', async () => {
    // 2 个其他任务
    for (let i = 0; i < 2; i++) {
      await pool.query(`
        INSERT INTO tasks (title, status, payload, updated_at)
        VALUES ($1, 'failed', '{"failure_class":"billing_cap"}'::jsonb, NOW())
      `, [`${TEST_PREFIX}-other-billing-${i}`]);
    }

    // 当前任务 payload.failure_class 已提前写入
    const currentRes = await pool.query(`
      INSERT INTO tasks (title, status, payload)
      VALUES ($1, 'failed', '{"failure_class":"billing_cap"}'::jsonb)
      RETURNING id
    `, [`${TEST_PREFIX}-current-billing`]);
    const currentId = currentRes.rows[0].id;

    const result = await detectPersistentExtDepFailure({ task_id: currentId });
    expect(result.isPersistent).toBe(true);
    expect(result.failureClass).toBe('billing_cap');
  });
});

// ============================================================
// processEvent 集成测试：持续性外部依赖故障 → quarantine+rca
// ============================================================

describe('processEvent: persistent external dependency failure routing', () => {
  const TEST_PREFIX = 'test-proc-ext-dep';

  beforeEach(async () => {
    await pool.query(`DELETE FROM tasks WHERE title LIKE $1`, [`${TEST_PREFIX}%`]);
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM tasks WHERE title LIKE $1`, [`${TEST_PREFIX}%`]);
  });

  it('持续性外部依赖故障事件应路由到 quarantine_task + trigger_rca，而不是 retry_task', async () => {
    // 准备：2 个他任务已有 failure_class=network
    for (let i = 0; i < 2; i++) {
      await pool.query(`
        INSERT INTO tasks (title, status, payload, updated_at)
        VALUES ($1, 'failed', '{"failure_class":"network"}'::jsonb, NOW())
      `, [`${TEST_PREFIX}-other-${i}`]);
    }

    // 当前任务
    const currentRes = await pool.query(`
      INSERT INTO tasks (title, status, error_message)
      VALUES ($1, 'failed', 'ECONNREFUSED: connection refused')
      RETURNING id
    `, [`${TEST_PREFIX}-current`]);
    const currentId = currentRes.rows[0].id;

    const event = {
      type: EVENT_TYPES.TASK_FAILED,
      task_id: currentId,
      retry_count: 0,
    };

    const decision = await processEvent(event);

    // 验证：不是 retry_task，而是 quarantine + rca
    const actionTypes = decision.actions.map(a => a.type);
    expect(actionTypes).toContain('quarantine_task');
    expect(actionTypes).toContain('trigger_rca');
    expect(actionTypes).not.toContain('retry_task');
    expect(decision.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('非外部依赖故障（普通代码错误）不应命中持续性故障路径', async () => {
    const currentRes = await pool.query(`
      INSERT INTO tasks (title, status, error_message)
      VALUES ($1, 'failed', 'SyntaxError: unexpected token')
      RETURNING id
    `, [`${TEST_PREFIX}-code-error`]);
    const currentId = currentRes.rows[0].id;

    const event = {
      type: EVENT_TYPES.TASK_FAILED,
      task_id: currentId,
      retry_count: 0,
      complex_reason: false,
    };

    const decision = await processEvent(event);

    // 不应命中 quarantine+rca 持续性路径
    const actionTypes = decision.actions.map(a => a.type);
    expect(actionTypes).not.toContain('quarantine_task');
  });
});
