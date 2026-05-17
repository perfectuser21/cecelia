/**
 * Thalamus 持续性外部依赖故障 — 纯函数单元测试（无需 DB）
 *
 * 修复背景：同 fingerprint ≥ 3 次的外部依赖故障必须立即 quarantine+rca，永不 retry。
 * 原问题：quickRoute 对 TASK_FAILED 只检查 per-task retry_count，不检测跨任务 fingerprint，
 *         导致 14 天 168 次无效派发。
 *
 * DB 集成测试见：integration/thalamus-persistent-ext-dep.integration.test.js
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

let _classifyExtDepError, EXTERNAL_DEP_FAILURE_CLASSES, PERSISTENT_EXT_DEP_THRESHOLD;

beforeAll(async () => {
  vi.resetModules();
  ({
    _classifyExtDepError,
    EXTERNAL_DEP_FAILURE_CLASSES,
    PERSISTENT_EXT_DEP_THRESHOLD,
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
    expect(_classifyExtDepError('You have exceeded your spending cap')).toBe('billing_cap');
    expect(_classifyExtDepError('billing limit reached')).toBe('billing_cap');
  });

  it('应识别 unauthorized/forbidden 为 auth', () => {
    expect(_classifyExtDepError('401 Unauthorized')).toBe('auth');
    expect(_classifyExtDepError('403 Forbidden')).toBe('auth');
  });

  it('应识别 out of memory 为 resource', () => {
    expect(_classifyExtDepError('JavaScript heap out of memory')).toBe('resource');
  });

  it('对普通错误应返回 null', () => {
    expect(_classifyExtDepError('SyntaxError: unexpected token')).toBeNull();
    expect(_classifyExtDepError('TypeError: cannot read property')).toBeNull();
  });

  it('对空/null 应返回 null', () => {
    expect(_classifyExtDepError('')).toBeNull();
    expect(_classifyExtDepError(null)).toBeNull();
    expect(_classifyExtDepError(undefined)).toBeNull();
  });
});

// ============================================================
// 常量校验
// ============================================================

describe('EXTERNAL_DEP_FAILURE_CLASSES', () => {
  it('应包含所有外部依赖类型', () => {
    expect(EXTERNAL_DEP_FAILURE_CLASSES.has('network')).toBe(true);
    expect(EXTERNAL_DEP_FAILURE_CLASSES.has('rate_limit')).toBe(true);
    expect(EXTERNAL_DEP_FAILURE_CLASSES.has('billing_cap')).toBe(true);
    expect(EXTERNAL_DEP_FAILURE_CLASSES.has('auth')).toBe(true);
    expect(EXTERNAL_DEP_FAILURE_CLASSES.has('resource')).toBe(true);
  });

  it('不应包含 task_error 或 unknown', () => {
    expect(EXTERNAL_DEP_FAILURE_CLASSES.has('task_error')).toBe(false);
    expect(EXTERNAL_DEP_FAILURE_CLASSES.has('unknown')).toBe(false);
  });
});

describe('PERSISTENT_EXT_DEP_THRESHOLD', () => {
  it('阈值应为 3', () => {
    expect(PERSISTENT_EXT_DEP_THRESHOLD).toBe(3);
  });
});
