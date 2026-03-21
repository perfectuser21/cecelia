/**
 * dev-failure-classifier 单元测试
 *
 * 覆盖所有分类场景和重试边界
 */

import { describe, it, expect } from 'vitest';
import {
  classifyDevFailure,
  calcNextRunAt,
  DEV_FAILURE_CLASS,
  MAX_DEV_RETRY,
} from '../dev-failure-classifier.js';

// ============================================================
// calcNextRunAt
// ============================================================

describe('calcNextRunAt', () => {
  it('retry 1 → 5min delay', () => {
    const before = Date.now();
    const result = new Date(calcNextRunAt(1)).getTime();
    expect(result - before).toBeGreaterThanOrEqual(5 * 60 * 1000 - 100);
    expect(result - before).toBeLessThan(5 * 60 * 1000 + 100);
  });

  it('retry 2 → 10min delay', () => {
    const before = Date.now();
    const result = new Date(calcNextRunAt(2)).getTime();
    expect(result - before).toBeGreaterThanOrEqual(10 * 60 * 1000 - 100);
  });

  it('retry 3 → 15min delay', () => {
    const before = Date.now();
    const result = new Date(calcNextRunAt(3)).getTime();
    expect(result - before).toBeGreaterThanOrEqual(15 * 60 * 1000 - 100);
  });

  it('returns ISO 8601 string', () => {
    const result = calcNextRunAt(1);
    expect(typeof result).toBe('string');
    expect(() => new Date(result)).not.toThrow();
  });
});

// ============================================================
// classifyDevFailure - auth 类别
// ============================================================

describe('classifyDevFailure - auth', () => {
  it('classifies permission denied as auth', () => {
    const result = classifyDevFailure('permission denied for branch main');
    expect(result.class).toBe(DEV_FAILURE_CLASS.AUTH);
    expect(result.retryable).toBe(false);
  });

  it('classifies EACCES as auth', () => {
    const result = classifyDevFailure('EACCES: permission denied, open /etc/shadow');
    expect(result.class).toBe(DEV_FAILURE_CLASS.AUTH);
    expect(result.retryable).toBe(false);
  });

  it('classifies token expired as auth', () => {
    const result = classifyDevFailure('GitHub: token expired, please refresh');
    expect(result.class).toBe(DEV_FAILURE_CLASS.AUTH);
    expect(result.retryable).toBe(false);
  });

  it('classifies forbidden as auth', () => {
    const result = classifyDevFailure('403 Forbidden: access denied');
    expect(result.class).toBe(DEV_FAILURE_CLASS.AUTH);
    expect(result.retryable).toBe(false);
  });

  it('auth includes previous_failure', () => {
    const result = classifyDevFailure('permission denied');
    expect(result.previous_failure).toBeDefined();
    expect(result.previous_failure.class).toBe(DEV_FAILURE_CLASS.AUTH);
    expect(result.previous_failure.error_excerpt).toContain('permission denied');
  });
});

// ============================================================
// classifyDevFailure - resource 类别
// ============================================================

describe('classifyDevFailure - resource', () => {
  it('classifies out of memory as resource', () => {
    const result = classifyDevFailure('ENOMEM: out of memory');
    expect(result.class).toBe(DEV_FAILURE_CLASS.RESOURCE);
    expect(result.retryable).toBe(false);
  });

  it('classifies disk full as resource', () => {
    const result = classifyDevFailure('ENOSPC: no space left on device');
    expect(result.class).toBe(DEV_FAILURE_CLASS.RESOURCE);
    expect(result.retryable).toBe(false);
  });

  it('classifies oom as resource', () => {
    const result = classifyDevFailure('Process killed by oom killer');
    expect(result.class).toBe(DEV_FAILURE_CLASS.RESOURCE);
    expect(result.retryable).toBe(false);
  });
});

// ============================================================
// classifyDevFailure - transient 类别
// ============================================================

describe('classifyDevFailure - transient', () => {
  it('classifies ECONNREFUSED as transient', () => {
    const result = classifyDevFailure('ECONNREFUSED 127.0.0.1:5432');
    expect(result.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(result.retryable).toBe(true);
  });

  it('classifies CI runner unavailable as transient', () => {
    const result = classifyDevFailure('runner unavailable, no runners to pick up job');
    expect(result.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(result.retryable).toBe(true);
  });

  it('classifies rate limit as transient', () => {
    const result = classifyDevFailure('429 Too Many Requests: rate limit exceeded');
    expect(result.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(result.retryable).toBe(true);
  });

  it('classifies service unavailable as transient', () => {
    const result = classifyDevFailure('503 Service Unavailable');
    expect(result.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(result.retryable).toBe(true);
  });

  it('classifies flaky test as transient', () => {
    const result = classifyDevFailure('CI flaky: test passed on retry');
    expect(result.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(result.retryable).toBe(true);
  });

  it('transient includes next_run_at and retry_reason', () => {
    const result = classifyDevFailure('ECONNRESET', 'AI Failed', { retryCount: 0 });
    expect(result.next_run_at).toBeDefined();
    expect(result.retry_reason).toBeDefined();
  });

  it('transient retryCount=0 → 5min delay', () => {
    const before = Date.now();
    const result = classifyDevFailure('ECONNREFUSED', 'AI Failed', { retryCount: 0 });
    const delay = new Date(result.next_run_at).getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(5 * 60 * 1000 - 100);
    expect(delay).toBeLessThan(6 * 60 * 1000);
  });

  it('transient retryCount=1 → 10min delay', () => {
    const before = Date.now();
    const result = classifyDevFailure('ECONNREFUSED', 'AI Failed', { retryCount: 1 });
    const delay = new Date(result.next_run_at).getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(10 * 60 * 1000 - 100);
  });

  it('transient retryCount=2 → 15min delay', () => {
    const before = Date.now();
    const result = classifyDevFailure('ECONNREFUSED', 'AI Failed', { retryCount: 2 });
    const delay = new Date(result.next_run_at).getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(15 * 60 * 1000 - 100);
  });

  it('transient exhausted when retryCount >= MAX_DEV_RETRY', () => {
    const result = classifyDevFailure('ECONNREFUSED', 'AI Failed', { retryCount: MAX_DEV_RETRY });
    expect(result.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain('exhausted');
  });
});

// ============================================================
// classifyDevFailure - code_error 类别
// ============================================================

describe('classifyDevFailure - code_error', () => {
  it('classifies TypeScript error as code_error', () => {
    const result = classifyDevFailure('TypeScript error: Type string is not assignable to number');
    expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(result.retryable).toBe(true);
  });

  it('classifies test failed as code_error', () => {
    const result = classifyDevFailure('3 tests failed in packages/brain');
    expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(result.retryable).toBe(true);
  });

  it('classifies build failed as code_error', () => {
    const result = classifyDevFailure('build failed: exit code 1');
    expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(result.retryable).toBe(true);
  });

  it('classifies merge conflict as code_error', () => {
    const result = classifyDevFailure('merge conflict in packages/brain/src/routes.js');
    expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(result.retryable).toBe(true);
  });

  it('classifies CI check failed as code_error', () => {
    const result = classifyDevFailure('CI check failed: brain-ci / DevGate');
    expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(result.retryable).toBe(true);
  });

  it('code_error retryCount=0 → 5min delay', () => {
    const before = Date.now();
    const result = classifyDevFailure('build failed', 'AI Failed', { retryCount: 0 });
    const delay = new Date(result.next_run_at).getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(5 * 60 * 1000 - 100);
  });

  it('code_error includes retry_reason with CI hint', () => {
    const result = classifyDevFailure('tests failed', 'AI Failed', { retryCount: 0 });
    expect(result.retry_reason).toBeDefined();
    expect(result.retry_reason).toContain('CI');
  });

  it('code_error exhausted when retryCount >= MAX_DEV_RETRY', () => {
    const result = classifyDevFailure('build failed', 'AI Failed', { retryCount: MAX_DEV_RETRY });
    expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain('exhausted');
  });

  it('code_error includes previous_failure', () => {
    const result = classifyDevFailure('tests failed in src/', 'AI Failed', { retryCount: 1 });
    expect(result.previous_failure).toBeDefined();
    expect(result.previous_failure.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(result.previous_failure.error_excerpt).toContain('tests failed');
  });
});

// ============================================================
// classifyDevFailure - unknown 类别
// ============================================================

describe('classifyDevFailure - unknown', () => {
  it('returns unknown for unrecognized error', () => {
    const result = classifyDevFailure('some completely unrecognized error message xyz123');
    expect(result.class).toBe(DEV_FAILURE_CLASS.UNKNOWN);
    expect(result.retryable).toBe(false);
  });

  it('unknown includes previous_failure', () => {
    const result = classifyDevFailure('random stuff');
    expect(result.previous_failure).toBeDefined();
    expect(result.previous_failure.class).toBe(DEV_FAILURE_CLASS.UNKNOWN);
  });
});

// ============================================================
// classifyDevFailure - result 对象提取
// ============================================================

describe('classifyDevFailure - result object extraction', () => {
  it('extracts error from result.result field', () => {
    const result = classifyDevFailure({ result: 'build failed with exit code 1' });
    expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
  });

  it('extracts error from result.error field', () => {
    const result = classifyDevFailure({ error: 'ECONNREFUSED 127.0.0.1' });
    expect(result.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
  });

  it('extracts error from result.stderr field', () => {
    const result = classifyDevFailure({ stderr: 'permission denied: /var/lib' });
    expect(result.class).toBe(DEV_FAILURE_CLASS.AUTH);
  });

  it('handles null result with status (no exitCode) → unknown', () => {
    const result = classifyDevFailure(null, 'AI Failed');
    // null result + no exitCode → unknown（无法判断原因）
    expect(result.class).toBe(DEV_FAILURE_CLASS.UNKNOWN);
    expect(result.retryable).toBe(false);
  });
});

// ============================================================
// 显式 failure_class 优先（来自 cecelia-run 已分类）
// ============================================================

describe('classifyDevFailure - explicit failure_class from result object', () => {
  it('result.failure_class=code_error → code_error retryable', () => {
    const result = classifyDevFailure(
      { failure_class: 'code_error', exit_code: 1, stderr: 'build failed' },
      'AI Failed',
      { retryCount: 0 }
    );
    expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(result.retryable).toBe(true);
  });

  it('result.failure_class=transient → transient retryable', () => {
    const result = classifyDevFailure(
      { failure_class: 'transient', exit_code: 1 },
      'AI Failed',
      { retryCount: 0 }
    );
    expect(result.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
    expect(result.retryable).toBe(true);
  });

  it('result.failure_class=auth → auth not retryable', () => {
    const result = classifyDevFailure(
      { failure_class: 'auth', exit_code: 1 },
      'AI Failed',
      { retryCount: 0 }
    );
    expect(result.class).toBe(DEV_FAILURE_CLASS.AUTH);
    expect(result.retryable).toBe(false);
  });

  it('result.failure_class=code_error + retryCount >= MAX_DEV_RETRY → not retryable', () => {
    const result = classifyDevFailure(
      { failure_class: 'code_error', exit_code: 1 },
      'AI Failed',
      { retryCount: MAX_DEV_RETRY }
    );
    expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(result.retryable).toBe(false);
  });
});

// ============================================================
// exit_code 兜底（result=null + exitCode 非零 → code_error）
// ============================================================

describe('classifyDevFailure - exitCode fallback', () => {
  it('result=null + exitCode=1 → code_error retryable', () => {
    const result = classifyDevFailure(null, 'AI Failed', { retryCount: 0, exitCode: 1 });
    expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(result.retryable).toBe(true);
  });

  it('result=null + exitCode=2 → code_error retryable', () => {
    const result = classifyDevFailure(null, 'AI Failed', { retryCount: 0, exitCode: 2 });
    expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(result.retryable).toBe(true);
  });

  it('result=null + exitCode=0 → unknown (正常退出，不视为 code_error)', () => {
    const result = classifyDevFailure(null, 'AI Failed', { retryCount: 0, exitCode: 0 });
    expect(result.class).toBe(DEV_FAILURE_CLASS.UNKNOWN);
    expect(result.retryable).toBe(false);
  });

  it('result=null + exitCode=1 + retryCount >= MAX_DEV_RETRY → not retryable', () => {
    const result = classifyDevFailure(null, 'AI Failed', { retryCount: MAX_DEV_RETRY, exitCode: 1 });
    expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    expect(result.retryable).toBe(false);
  });

  it('result=null + exitCode=null → unknown（无 exitCode 信息）', () => {
    const result = classifyDevFailure(null, 'AI Failed', { retryCount: 0, exitCode: null });
    expect(result.class).toBe(DEV_FAILURE_CLASS.UNKNOWN);
    expect(result.retryable).toBe(false);
  });
});

// ============================================================
// 优先级验证：auth/resource 优先于 transient/code_error
// ============================================================

describe('classifyDevFailure - priority', () => {
  it('auth takes priority over transient patterns', () => {
    // permission denied 包含 auth pattern，即使出现 rate_limit 关键词也应匹配 auth
    const result = classifyDevFailure('permission denied: too many requests');
    expect(result.class).toBe(DEV_FAILURE_CLASS.AUTH);
  });

  it('resource takes priority over transient', () => {
    // ENOSPC 是 resource，不是 transient
    const result = classifyDevFailure('ENOSPC: ECONNREFUSED');
    expect(result.class).toBe(DEV_FAILURE_CLASS.RESOURCE);
  });
});
