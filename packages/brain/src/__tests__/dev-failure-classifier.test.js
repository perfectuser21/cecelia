/**
 * Dev Failure Classifier Tests
 *
 * 验收对应 DoD D1：
 * - 所有 4 个失败类别（transient, code_error, auth, resource）
 * - 多种 result 格式（string, object, null/undefined）
 * - 边界：未知错误默认 transient
 */

import { describe, it, expect } from 'vitest';
import { classifyDevFailure, DEV_FAILURE_CLASS } from '../dev-failure-classifier.js';

// ============================================================
// TRANSIENT 类别
// ============================================================

describe('classifyDevFailure - TRANSIENT', () => {
  it('网络超时 → transient', () => {
    const r = classifyDevFailure({ result: 'network timeout after 30s' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(r.retryable).toBe(true);
  });

  it('ECONNRESET → transient', () => {
    const r = classifyDevFailure({ result: 'read ECONNRESET' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(r.retryable).toBe(true);
  });

  it('ECONNREFUSED → transient', () => {
    const r = classifyDevFailure({ result: 'connect ECONNREFUSED 127.0.0.1:5432' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(r.retryable).toBe(true);
  });

  it('CI check failed → transient', () => {
    const r = classifyDevFailure({ result: 'CI check failed: brain-ci' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(r.retryable).toBe(true);
  });

  it('rate limit exceeded → transient', () => {
    const r = classifyDevFailure({ result: 'rate limit exceeded, retry after 60s' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(r.retryable).toBe(true);
  });

  it('429 status → transient', () => {
    const r = classifyDevFailure({ result: 'HTTP 429 too many requests' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(r.retryable).toBe(true);
  });

  it('service unavailable → transient', () => {
    const r = classifyDevFailure({ result: 'service unavailable (503)' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(r.retryable).toBe(true);
  });

  it('GitHub Actions failure → transient', () => {
    const r = classifyDevFailure({ result: 'github actions failed on push' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(r.retryable).toBe(true);
  });
});

// ============================================================
// CODE_ERROR 类别
// ============================================================

describe('classifyDevFailure - CODE_ERROR', () => {
  it('TypeScript compilation error → code_error', () => {
    const r = classifyDevFailure({ result: 'TypeScript compilation error: Type string is not assignable' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(r.retryable).toBe(true);
  });

  it('test suite failed → code_error', () => {
    const r = classifyDevFailure({ result: 'test suite failed: 3 tests failed' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(r.retryable).toBe(true);
  });

  it('ESLint error → code_error', () => {
    const r = classifyDevFailure({ result: 'ESLint error: no-unused-vars' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(r.retryable).toBe(true);
  });

  it('build failed → code_error', () => {
    const r = classifyDevFailure({ result: 'build failed with exit code 1' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(r.retryable).toBe(true);
  });

  it('vitest failed → code_error', () => {
    const r = classifyDevFailure({ result: 'vitest failed: 2 test cases failed' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(r.retryable).toBe(true);
  });
});

// ============================================================
// AUTH 类别
// ============================================================

describe('classifyDevFailure - AUTH', () => {
  it('permission denied → auth', () => {
    const r = classifyDevFailure({ result: 'permission denied to repository' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.AUTH);
    expect(r.retryable).toBe(false);
  });

  it('token expired → auth', () => {
    const r = classifyDevFailure({ result: 'token expired, please re-authenticate' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.AUTH);
    expect(r.retryable).toBe(false);
  });

  it('unauthorized → auth', () => {
    const r = classifyDevFailure({ result: 'unauthorized access to github API' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.AUTH);
    expect(r.retryable).toBe(false);
  });

  it('HTTP 403 → auth', () => {
    const r = classifyDevFailure({ result: 'HTTP 403 forbidden' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.AUTH);
    expect(r.retryable).toBe(false);
  });
});

// ============================================================
// RESOURCE 类别
// ============================================================

describe('classifyDevFailure - RESOURCE', () => {
  it('disk full → resource', () => {
    const r = classifyDevFailure({ result: 'disk full, cannot write file' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.RESOURCE);
    expect(r.retryable).toBe(false);
  });

  it('out of memory → resource', () => {
    const r = classifyDevFailure({ result: 'out of memory: kill process' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.RESOURCE);
    expect(r.retryable).toBe(false);
  });

  it('ENOSPC → resource', () => {
    const r = classifyDevFailure({ result: 'write ENOSPC /dev/sda1' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.RESOURCE);
    expect(r.retryable).toBe(false);
  });

  it('no space left → resource', () => {
    const r = classifyDevFailure({ result: 'no space left on device' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.RESOURCE);
    expect(r.retryable).toBe(false);
  });
});

// ============================================================
// 边界：未知错误 → transient（默认）
// ============================================================

describe('classifyDevFailure - 默认 transient', () => {
  it('未识别错误 → transient', () => {
    const r = classifyDevFailure({ result: 'some completely unknown error xyzzy' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(r.retryable).toBe(true);
  });

  it('result 为 null → transient', () => {
    const r = classifyDevFailure(null, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(r.retryable).toBe(true);
  });

  it('result 为 undefined → transient', () => {
    const r = classifyDevFailure(undefined, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(r.retryable).toBe(true);
  });
});

// ============================================================
// 多种 result 格式
// ============================================================

describe('classifyDevFailure - result 格式', () => {
  it('string result → 正确分类', () => {
    const r = classifyDevFailure('network timeout', 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
  });

  it('result.error 字段 → 正确分类', () => {
    const r = classifyDevFailure({ error: 'permission denied' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.AUTH);
  });

  it('result.message 字段 → 正确分类', () => {
    const r = classifyDevFailure({ message: 'ECONNRESET while connecting' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
  });

  it('result.log_snippet 字段 → 正确分类', () => {
    const r = classifyDevFailure({ log_snippet: 'tests failed: 5 assertions failed' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
  });
});

// ============================================================
// 优先级：auth/resource 优先于其他类别
// ============================================================

describe('classifyDevFailure - 分类优先级', () => {
  it('auth 优先于 transient（网络超时 + permission denied）', () => {
    const r = classifyDevFailure({ result: 'permission denied after network timeout' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.AUTH);
    expect(r.retryable).toBe(false);
  });

  it('resource 优先于 code_error（build failed + disk full）', () => {
    const r = classifyDevFailure({ result: 'build failed: disk full ENOSPC' }, 'AI Failed');
    expect(r.class).toBe(DEV_FAILURE_CLASS.RESOURCE);
    expect(r.retryable).toBe(false);
  });
});

// ============================================================
// 返回结构验证
// ============================================================

describe('classifyDevFailure - 返回结构', () => {
  it('返回 { class, retryable, reason } 三个字段', () => {
    const r = classifyDevFailure({ result: 'timeout' }, 'AI Failed');
    expect(r).toHaveProperty('class');
    expect(r).toHaveProperty('retryable');
    expect(r).toHaveProperty('reason');
    expect(typeof r.reason).toBe('string');
  });
});
