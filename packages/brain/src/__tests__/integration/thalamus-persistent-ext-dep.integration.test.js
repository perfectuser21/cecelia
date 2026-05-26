/**
 * Thalamus 持续性外部依赖故障检测 — 集成测试（需要真实 DB）
 *
 * 修复背景：同 fingerprint ≥ 3 次的外部依赖故障必须立即 quarantine+rca，永不 retry。
 * 原问题：quickRoute 对 TASK_FAILED 只检查 per-task retry_count，不检测跨任务 fingerprint，
 *         导致 14 天 168 次无效派发。
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';

let pool;
let detectPersistentExtDepFailure, processEvent, EVENT_TYPES;

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  ({
    detectPersistentExtDepFailure,
    processEvent,
    EVENT_TYPES,
  } = await import('../../thalamus.js'));
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
    for (let i = 0; i < 2; i++) {
      await pool.query(`
        INSERT INTO tasks (title, status, payload, updated_at)
        VALUES ($1, 'failed', '{"failure_class":"network"}'::jsonb, NOW())
      `, [`${TEST_PREFIX}-other-network-${i}`]);
    }

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
    expect(result.isPersistent).toBe(false);
  });

  it('当前任务用 payload.failure_class 而非 error_message 分类（提前写入场景）', async () => {
    for (let i = 0; i < 2; i++) {
      await pool.query(`
        INSERT INTO tasks (title, status, payload, updated_at)
        VALUES ($1, 'failed', '{"failure_class":"billing_cap"}'::jsonb, NOW())
      `, [`${TEST_PREFIX}-other-billing-${i}`]);
    }

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
    for (let i = 0; i < 2; i++) {
      await pool.query(`
        INSERT INTO tasks (title, status, payload, updated_at)
        VALUES ($1, 'failed', '{"failure_class":"network"}'::jsonb, NOW())
      `, [`${TEST_PREFIX}-other-${i}`]);
    }

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

    const actionTypes = decision.actions.map(a => a.type);
    expect(actionTypes).not.toContain('quarantine_task');
  });
});
