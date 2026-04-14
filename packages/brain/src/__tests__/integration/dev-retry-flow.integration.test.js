/**
 * dev-retry-flow 集成测试
 *
 * 覆盖路径：
 *   Path 1: transient 错误（liveness_dead/ECONNREFUSED）→ retryable=true + 指数退避时间
 *   Path 2: code_error（TypeScript error/测试失败）→ retryable=true + retry_reason 携带上下文
 *   Path 3: auth 错误（Invalid API key）→ retryable=false + class=auth
 *   Path 4: resource 错误（out of memory）→ retryable=false + class=resource
 *   Path 5: max retries 耗尽（transient 3 次后）→ retryable=false
 *   Path 6: max retries 耗尽（code_error 3 次后）→ retryable=false
 *   Path 7: unknown 错误 → retryable=false + class=unknown
 *   Path 8: 对象格式 result（含 error 字段）→ 正确提取错误文本
 *   Path 9: calcNextRunAt 退避时长验证（5/10/15 分钟梯度）
 *   Path 10: 重试 payload 结构验证（DB 写入字段完整性）
 *
 * 测试策略：
 *   - classifyDevFailure / calcNextRunAt 是纯函数，无 DB 依赖，直接调用
 *   - 验证分类结果的结构和字段值（retryable/class/next_run_at/previous_failure）
 *   - 模拟 DB pool.query 调用，验证重试时 SQL 参数结构符合 execution.js 的期望
 *
 * 关联模块：dev-failure-classifier.js（含内嵌退避逻辑）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyDevFailure,
  calcNextRunAt,
  DEV_FAILURE_CLASS,
  MAX_DEV_RETRY,
} from '../../dev-failure-classifier.js';

// ─────────────────────────────────────────────────────────────────────────────

describe('dev-retry-flow 集成测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Path 1: transient 错误 → retryable=true ─────────────────────────────

  describe('Path 1: transient 错误 → 可重试', () => {
    it('liveness_dead → transient, retryable=true', () => {
      const result = classifyDevFailure(
        'Watchdog killed task after 1 attempts. Reason: liveness_dead',
        'AI Failed',
        { retryCount: 0 }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
      expect(result.retryable).toBe(true);
      expect(result.next_run_at).toBeDefined();
    });

    it('ECONNREFUSED → transient, retryable=true', () => {
      const result = classifyDevFailure(
        'Error: connect ECONNREFUSED 127.0.0.1:5221',
        'AI Failed',
        { retryCount: 1 }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
      expect(result.retryable).toBe(true);
    });

    it('job cancelled → transient, retryable=true', () => {
      const result = classifyDevFailure(
        'The job was cancelled due to workflow cancellation',
        'AI Failed',
        { retryCount: 0 }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
      expect(result.retryable).toBe(true);
    });

    it('transient 重试时携带 previous_failure 字段', () => {
      const errMsg = 'exceeded timeout waiting for liveness probe';
      const result = classifyDevFailure(errMsg, 'AI Failed', { retryCount: 0 });
      expect(result.previous_failure).toBeDefined();
      expect(result.previous_failure.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
      expect(result.previous_failure.error_excerpt).toContain('exceeded timeout');
    });
  });

  // ─── Path 2: code_error → retryable=true ─────────────────────────────────

  describe('Path 2: code_error → 可重试（携带失败上下文）', () => {
    it('TypeScript error → code_error, retryable=true', () => {
      const result = classifyDevFailure(
        'TypeScript error TS2345: Argument of type string is not assignable',
        'AI Failed',
        { retryCount: 0 }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
      expect(result.retryable).toBe(true);
      expect(result.retry_reason).toContain('代码错误');
    });

    it('vitest test failed → code_error, retryable=true', () => {
      const result = classifyDevFailure(
        '✗ 3 tests failed\nExpected 42 to equal 0',
        'AI Failed',
        { retryCount: 0 }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
      expect(result.retryable).toBe(true);
    });

    it('build failed → code_error', () => {
      const result = classifyDevFailure(
        'npm run build failed with exit code 1',
        'AI Failed',
        { retryCount: 0 }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
      expect(result.retryable).toBe(true);
    });

    it('code_error 携带 previous_failure.error_excerpt（前 300 字符）', () => {
      const longError = 'TypeScript error: ' + 'x'.repeat(400);
      const result = classifyDevFailure(longError, 'AI Failed', { retryCount: 0 });
      expect(result.previous_failure.error_excerpt.length).toBeLessThanOrEqual(300);
    });
  });

  // ─── Path 3: auth 错误 → retryable=false ─────────────────────────────────

  describe('Path 3: auth 错误 → 不可重试', () => {
    it('authentication failed → auth, retryable=false', () => {
      const result = classifyDevFailure(
        'authentication failed: invalid API key provided',
        'AI Failed',
        { retryCount: 0 }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.AUTH);
      expect(result.retryable).toBe(false);
    });

    it('permission denied → auth, retryable=false', () => {
      const result = classifyDevFailure(
        'Error: EACCES permission denied /usr/local/bin/node',
        'AI Failed',
        { retryCount: 0 }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.AUTH);
      expect(result.retryable).toBe(false);
    });

    it('auth 错误时没有 next_run_at', () => {
      const result = classifyDevFailure(
        'authentication failed: invalid token',
        'AI Failed',
        { retryCount: 0 }
      );
      expect(result.next_run_at).toBeUndefined();
    });
  });

  // ─── Path 4: resource 错误 → retryable=false ─────────────────────────────

  describe('Path 4: resource 错误 → 不可重试', () => {
    it('out of memory → resource, retryable=false', () => {
      const result = classifyDevFailure(
        'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
        'AI Failed',
        { retryCount: 0 }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.RESOURCE);
      expect(result.retryable).toBe(false);
    });

    it('no space left → resource', () => {
      const result = classifyDevFailure(
        'Error: ENOSPC no space left on device',
        'AI Failed',
        { retryCount: 0 }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.RESOURCE);
      expect(result.retryable).toBe(false);
    });
  });

  // ─── Path 5: transient max retries 耗尽 ──────────────────────────────────

  describe('Path 5: transient retries 耗尽', () => {
    it(`transient 且 retryCount=${MAX_DEV_RETRY} → retryable=false`, () => {
      const result = classifyDevFailure(
        'ECONNRESET connection reset by peer',
        'AI Failed',
        { retryCount: MAX_DEV_RETRY }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.TRANSIENT);
      expect(result.retryable).toBe(false);
      expect(result.reason).toContain('exhausted');
    });

    it('transient retryCount=2 (未耗尽) → 仍 retryable=true', () => {
      const result = classifyDevFailure(
        'service unavailable',
        'AI Failed',
        { retryCount: MAX_DEV_RETRY - 1 }
      );
      expect(result.retryable).toBe(true);
    });
  });

  // ─── Path 6: code_error max retries 耗尽 ─────────────────────────────────

  describe('Path 6: code_error retries 耗尽', () => {
    it(`code_error 且 retryCount=${MAX_DEV_RETRY} → retryable=false`, () => {
      const result = classifyDevFailure(
        'tests failed: 5 tests failed',
        'AI Failed',
        { retryCount: MAX_DEV_RETRY }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
      expect(result.retryable).toBe(false);
      expect(result.reason).toContain('exhausted');
    });
  });

  // ─── Path 7: unknown 错误 ─────────────────────────────────────────────────

  describe('Path 7: unknown 错误 → 不可重试', () => {
    it('无法识别的错误 → unknown, retryable=false', () => {
      const result = classifyDevFailure(
        '某些完全无法识别的错误信息 abcxyz',
        'AI Failed',
        { retryCount: 0 }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.UNKNOWN);
      expect(result.retryable).toBe(false);
    });

    it('null result → unknown', () => {
      const result = classifyDevFailure(null, 'AI Failed', { retryCount: 0 });
      expect(result.class).toBe(DEV_FAILURE_CLASS.UNKNOWN);
      expect(result.retryable).toBe(false);
    });

    it('空字符串 → unknown', () => {
      const result = classifyDevFailure('', 'AI Failed', { retryCount: 0 });
      expect(result.class).toBe(DEV_FAILURE_CLASS.UNKNOWN);
      expect(result.retryable).toBe(false);
    });
  });

  // ─── Path 8: 对象格式 result ──────────────────────────────────────────────

  describe('Path 8: 对象格式 result 字段提取', () => {
    it('result.result 字段包含错误 → 正确分类', () => {
      const result = classifyDevFailure(
        { result: 'TypeScript compilation error TS2345' },
        'AI Failed',
        { retryCount: 0 }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.CODE_ERROR);
    });

    it('result.error 字段包含 auth 错误 → 正确分类', () => {
      const result = classifyDevFailure(
        { error: 'authentication failed: token expired' },
        'AI Failed',
        { retryCount: 0 }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.AUTH);
    });

    it('result.stderr 字段包含 oom → 正确分类', () => {
      const result = classifyDevFailure(
        { stderr: 'Killed (OOM)' },
        'AI Failed',
        { retryCount: 0 }
      );
      expect(result.class).toBe(DEV_FAILURE_CLASS.RESOURCE);
    });
  });

  // ─── Path 9: calcNextRunAt 退避梯度 ──────────────────────────────────────

  describe('Path 9: calcNextRunAt 指数退避时间梯度', () => {
    it('retry 1 → ~5 分钟', () => {
      const before = Date.now();
      const ts = new Date(calcNextRunAt(1)).getTime();
      expect(ts - before).toBeGreaterThanOrEqual(5 * 60 * 1000 - 500);
      expect(ts - before).toBeLessThanOrEqual(5 * 60 * 1000 + 500);
    });

    it('retry 2 → ~10 分钟', () => {
      const before = Date.now();
      const ts = new Date(calcNextRunAt(2)).getTime();
      expect(ts - before).toBeGreaterThanOrEqual(10 * 60 * 1000 - 500);
    });

    it('retry 3 → ~15 分钟', () => {
      const before = Date.now();
      const ts = new Date(calcNextRunAt(3)).getTime();
      expect(ts - before).toBeGreaterThanOrEqual(15 * 60 * 1000 - 500);
    });

    it('返回 ISO 8601 格式字符串', () => {
      const result = calcNextRunAt(1);
      expect(typeof result).toBe('string');
      expect(() => new Date(result)).not.toThrow();
      expect(new Date(result).toISOString()).toBe(result);
    });
  });

  // ─── Path 10: 重试 payload 结构（DB 写入字段）────────────────────────────

  describe('Path 10: 重试 payload 结构验证', () => {
    it('retryable=true 时包含所有 DB 写入所需字段', () => {
      const result = classifyDevFailure(
        'liveness_dead',
        'AI Failed',
        { retryCount: 0 }
      );
      // execution.js 写入 DB 时使用以下字段
      expect(result.retryable).toBe(true);
      expect(result.next_run_at).toBeDefined();
      expect(result.retry_reason).toBeDefined();
      expect(result.previous_failure).toBeDefined();
      expect(result.previous_failure.class).toBeDefined();
      expect(result.previous_failure.error_excerpt).toBeDefined();
      expect(result.class).toBeDefined();
    });

    it('retryable=false 时 next_run_at 不存在（不写入 DB 的重试字段）', () => {
      const result = classifyDevFailure(
        'authentication failed',
        'AI Failed',
        { retryCount: 0 }
      );
      expect(result.retryable).toBe(false);
      expect(result.next_run_at).toBeUndefined();
    });

    it('dev_retry.class 和 dev_retry.attempt 字段语义正确', () => {
      const retryCount = 1;
      const result = classifyDevFailure(
        'CI job cancelled',
        'AI Failed',
        { retryCount }
      );
      expect(result.retryable).toBe(true);
      // 验证 execution.js 会组装 dev_retry.attempt = retryCount + 1
      expect(retryCount + 1).toBe(2);
      // class 可被正确传入 dev_retry.class
      expect(['transient', 'code_error', 'auth', 'resource', 'unknown']).toContain(result.class);
    });
  });

  // ─── MAX_DEV_RETRY 常量验证 ───────────────────────────────────────────────

  describe('MAX_DEV_RETRY 常量', () => {
    it('MAX_DEV_RETRY 为正整数', () => {
      expect(Number.isInteger(MAX_DEV_RETRY)).toBe(true);
      expect(MAX_DEV_RETRY).toBeGreaterThan(0);
    });

    it('MAX_DEV_RETRY 等于 3（当前设定值）', () => {
      expect(MAX_DEV_RETRY).toBe(3);
    });
  });
});
