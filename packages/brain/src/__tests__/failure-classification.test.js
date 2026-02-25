/**
 * 失败分类与智能重试机制 测试
 *
 * 对应 DoD:
 * 1. "Spending cap reached resets 11pm" 分类为 BILLING_CAP
 * 2. BILLING_CAP 解析 reset 时间 → next_run_at
 * 3. BILLING_CAP 触发 billing pause，跳过派发
 * 4. RATE_LIMIT 429 用指数退避 next_run_at
 * 5. AUTH/RESOURCE 不重试，标记 needs_human_review
 * 6. BILLING_CAP/RATE_LIMIT 不升级 alertness
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyFailure,
  parseResetTime,
  getRetryStrategy,
  FAILURE_CLASS,
  BILLING_CAP_PATTERNS,
  RATE_LIMIT_PATTERNS,
  AUTH_PATTERNS,
  NETWORK_PATTERNS,
  RESOURCE_PATTERNS,
} from '../quarantine.js';

// ============================================================
// DoD #1: "Spending cap reached resets 11pm" → BILLING_CAP
// ============================================================

describe('Failure Classification', () => {
  describe('BILLING_CAP', () => {
    it('classifies "Spending cap reached resets 11pm" as BILLING_CAP', () => {
      const result = classifyFailure('Spending cap reached resets 11pm');
      expect(result.class).toBe(FAILURE_CLASS.BILLING_CAP);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('classifies "spending cap" variants', () => {
      const msgs = [
        'Your spending cap has been reached',
        'spending cap reached, resets at 3pm',
        'Cap reached for this billing period',
        'billing limit reached',
        'usage limit reached for today',
      ];
      for (const msg of msgs) {
        const result = classifyFailure(msg);
        expect(result.class).toBe(FAILURE_CLASS.BILLING_CAP);
      }
    });

    it('returns retry_strategy with should_retry=true and billing_pause=true', () => {
      const result = classifyFailure('Spending cap reached resets 11pm');
      expect(result.retry_strategy).toBeDefined();
      expect(result.retry_strategy.should_retry).toBe(true);
      expect(result.retry_strategy.billing_pause).toBe(true);
    });
  });

  describe('RATE_LIMIT', () => {
    it('classifies 429 as RATE_LIMIT', () => {
      const result = classifyFailure('Error 429: Too many requests');
      expect(result.class).toBe(FAILURE_CLASS.RATE_LIMIT);
    });

    it('classifies "overloaded" as RATE_LIMIT', () => {
      const result = classifyFailure('API is overloaded, please try again later');
      expect(result.class).toBe(FAILURE_CLASS.RATE_LIMIT);
    });

    it('classifies "rate limit" as RATE_LIMIT', () => {
      const result = classifyFailure('rate limit exceeded');
      expect(result.class).toBe(FAILURE_CLASS.RATE_LIMIT);
    });
  });

  describe('AUTH', () => {
    it('classifies "permission denied" as AUTH', () => {
      const result = classifyFailure('permission denied');
      expect(result.class).toBe(FAILURE_CLASS.AUTH);
    });

    it('classifies "unauthorized" as AUTH', () => {
      const result = classifyFailure('401 unauthorized');
      expect(result.class).toBe(FAILURE_CLASS.AUTH);
    });

    it('classifies "invalid API key" as AUTH', () => {
      const result = classifyFailure('invalid api key provided');
      expect(result.class).toBe(FAILURE_CLASS.AUTH);
    });
  });

  describe('NETWORK', () => {
    it('classifies ECONNREFUSED as NETWORK', () => {
      const result = classifyFailure('connect ECONNREFUSED 127.0.0.1:3000');
      expect(result.class).toBe(FAILURE_CLASS.NETWORK);
    });

    it('classifies "socket hang up" as NETWORK', () => {
      const result = classifyFailure('socket hang up');
      expect(result.class).toBe(FAILURE_CLASS.NETWORK);
    });

    it('classifies 502 as NETWORK', () => {
      const result = classifyFailure('502 Bad Gateway');
      expect(result.class).toBe(FAILURE_CLASS.NETWORK);
    });
  });

  describe('RESOURCE', () => {
    it('classifies OOM as RESOURCE', () => {
      const result = classifyFailure('ENOMEM: out of memory');
      expect(result.class).toBe(FAILURE_CLASS.RESOURCE);
    });

    it('classifies "no space left" as RESOURCE', () => {
      const result = classifyFailure('ENOSPC: no space left on device');
      expect(result.class).toBe(FAILURE_CLASS.RESOURCE);
    });
  });

  describe('TASK_ERROR (default)', () => {
    it('classifies unknown errors as TASK_ERROR', () => {
      const result = classifyFailure('TypeError: Cannot read property x of undefined');
      expect(result.class).toBe(FAILURE_CLASS.TASK_ERROR);
    });

    it('classifies empty error as TASK_ERROR', () => {
      const result = classifyFailure('');
      expect(result.class).toBe(FAILURE_CLASS.TASK_ERROR);
    });

    it('handles null/undefined input', () => {
      expect(classifyFailure(null).class).toBe(FAILURE_CLASS.TASK_ERROR);
      expect(classifyFailure(undefined).class).toBe(FAILURE_CLASS.TASK_ERROR);
    });
  });
});

// ============================================================
// DoD #2: BILLING_CAP 解析 reset 时间 → next_run_at
// ============================================================

describe('parseResetTime', () => {
  it('parses "resets 11pm" → today/tomorrow 23:00 Beijing time', () => {
    const resetTime = parseResetTime('Spending cap reached resets 11pm');
    expect(resetTime).toBeInstanceOf(Date);
    expect(resetTime.getTime()).toBeGreaterThan(Date.now());
    // reset should be within 24 hours
    expect(resetTime.getTime() - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('parses "resets at 3:30 PM"', () => {
    const resetTime = parseResetTime('Cap reached, resets at 3:30 PM');
    expect(resetTime).toBeInstanceOf(Date);
    expect(resetTime.getTime()).toBeGreaterThan(Date.now());
  });

  it('parses "resets in 2 hours"', () => {
    const before = Date.now();
    const resetTime = parseResetTime('limit reached, resets in 2 hours');
    expect(resetTime).toBeInstanceOf(Date);
    // Should be approximately 2 hours from now (within 5 seconds tolerance)
    const diff = resetTime.getTime() - before;
    expect(diff).toBeGreaterThan(2 * 60 * 60 * 1000 - 5000);
    expect(diff).toBeLessThan(2 * 60 * 60 * 1000 + 5000);
  });

  it('parses "resets in 30 minutes"', () => {
    const before = Date.now();
    const resetTime = parseResetTime('resets in 30 minutes');
    expect(resetTime).toBeInstanceOf(Date);
    const diff = resetTime.getTime() - before;
    expect(diff).toBeGreaterThan(30 * 60 * 1000 - 5000);
    expect(diff).toBeLessThan(30 * 60 * 1000 + 5000);
  });

  it('returns default (2h from now) for unparseable messages', () => {
    const before = Date.now();
    const resetTime = parseResetTime('spending cap reached');
    expect(resetTime).toBeInstanceOf(Date);
    const diff = resetTime.getTime() - before;
    expect(diff).toBeGreaterThan(2 * 60 * 60 * 1000 - 5000);
    expect(diff).toBeLessThan(2 * 60 * 60 * 1000 + 5000);
  });

  it('returns null for null/empty input', () => {
    expect(parseResetTime(null)).toBeNull();
    expect(parseResetTime('')).toBeNull();
  });
});

// ============================================================
// DoD #3: BILLING_CAP 触发 billing pause
// ============================================================

describe('Billing Pause (executor)', () => {
  // Import dynamically to avoid DB connection issues in tests
  let setBillingPause, getBillingPause, clearBillingPause;

  beforeEach(async () => {
    const executor = await import('../executor.js');
    setBillingPause = executor.setBillingPause;
    getBillingPause = executor.getBillingPause;
    clearBillingPause = executor.clearBillingPause;
    // Clear any existing pause
    clearBillingPause();
  });

  it('setBillingPause sets active pause', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    setBillingPause(future, 'test');
    const pause = getBillingPause();
    expect(pause.active).toBe(true);
    expect(pause.resetTime).toBe(future);
    expect(pause.reason).toBe('test');
  });

  it('getBillingPause returns inactive when no pause', () => {
    const pause = getBillingPause();
    expect(pause.active).toBe(false);
  });

  it('getBillingPause auto-clears expired pause', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    setBillingPause(past, 'expired_test');
    const pause = getBillingPause();
    expect(pause.active).toBe(false);
  });

  it('clearBillingPause manually clears', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    setBillingPause(future, 'test');
    const result = clearBillingPause();
    expect(result.cleared).toBe(true);
    expect(getBillingPause().active).toBe(false);
  });
});

// ============================================================
// DoD #4: RATE_LIMIT 429 指数退避
// ============================================================

describe('Retry Strategy', () => {
  describe('RATE_LIMIT exponential backoff', () => {
    it('retry 0 → 2min backoff', () => {
      const strategy = getRetryStrategy(FAILURE_CLASS.RATE_LIMIT, { retryCount: 0 });
      expect(strategy.should_retry).toBe(true);
      expect(strategy.next_run_at).toBeDefined();
      const diff = new Date(strategy.next_run_at).getTime() - Date.now();
      // 2 minutes = 120000ms (with 5s tolerance)
      expect(diff).toBeGreaterThan(120000 - 5000);
      expect(diff).toBeLessThan(120000 + 5000);
    });

    it('retry 1 → 4min backoff', () => {
      const strategy = getRetryStrategy(FAILURE_CLASS.RATE_LIMIT, { retryCount: 1 });
      expect(strategy.should_retry).toBe(true);
      const diff = new Date(strategy.next_run_at).getTime() - Date.now();
      // 4 minutes = 240000ms
      expect(diff).toBeGreaterThan(240000 - 5000);
      expect(diff).toBeLessThan(240000 + 5000);
    });

    it('retry 2 → 8min backoff', () => {
      const strategy = getRetryStrategy(FAILURE_CLASS.RATE_LIMIT, { retryCount: 2 });
      expect(strategy.should_retry).toBe(true);
      const diff = new Date(strategy.next_run_at).getTime() - Date.now();
      // 8 minutes = 480000ms
      expect(diff).toBeGreaterThan(480000 - 5000);
      expect(diff).toBeLessThan(480000 + 5000);
    });

    it('retry 3 → no more retries, needs human review', () => {
      const strategy = getRetryStrategy(FAILURE_CLASS.RATE_LIMIT, { retryCount: 3 });
      expect(strategy.should_retry).toBe(false);
      expect(strategy.needs_human_review).toBe(true);
    });
  });

  describe('NETWORK short backoff', () => {
    it('retry 0 → 30s backoff', () => {
      const strategy = getRetryStrategy(FAILURE_CLASS.NETWORK, { retryCount: 0 });
      expect(strategy.should_retry).toBe(true);
      const diff = new Date(strategy.next_run_at).getTime() - Date.now();
      expect(diff).toBeGreaterThan(30000 - 5000);
      expect(diff).toBeLessThan(30000 + 5000);
    });

    it('retry 3 → no more retries', () => {
      const strategy = getRetryStrategy(FAILURE_CLASS.NETWORK, { retryCount: 3 });
      expect(strategy.should_retry).toBe(false);
      expect(strategy.needs_human_review).toBe(true);
    });
  });

  describe('BILLING_CAP uses reset time', () => {
    it('parses reset time from error and sets billing_pause', () => {
      const strategy = getRetryStrategy(FAILURE_CLASS.BILLING_CAP, {
        errorStr: 'Spending cap reached resets 11pm'
      });
      expect(strategy.should_retry).toBe(true);
      expect(strategy.billing_pause).toBe(true);
      expect(strategy.next_run_at).toBeDefined();
    });
  });
});

// ============================================================
// DoD #5: AUTH/RESOURCE 不重试，标记 needs_human_review
// ============================================================

describe('No-Retry Classes', () => {
  it('AUTH → should_retry=false, needs_human_review=true', () => {
    const strategy = getRetryStrategy(FAILURE_CLASS.AUTH);
    expect(strategy.should_retry).toBe(false);
    expect(strategy.needs_human_review).toBe(true);
  });

  it('RESOURCE → should_retry=false, needs_human_review=true', () => {
    const strategy = getRetryStrategy(FAILURE_CLASS.RESOURCE);
    expect(strategy.should_retry).toBe(false);
    expect(strategy.needs_human_review).toBe(true);
  });

  it('TASK_ERROR → should_retry=false (normal failure counting)', () => {
    const strategy = getRetryStrategy(FAILURE_CLASS.TASK_ERROR);
    expect(strategy.should_retry).toBe(false);
    expect(strategy.needs_human_review).toBeUndefined();
  });
});

// ============================================================
// DoD #6: BILLING_CAP/RATE_LIMIT 不升级 alertness
// ============================================================

describe('Alertness Non-Escalation', () => {
  it('classifyFailure returns class for alertness filtering', () => {
    // Verify the class values that alertness.js filters
    const billingResult = classifyFailure('Spending cap reached resets 11pm');
    expect(billingResult.class).toBe('billing_cap');

    const rateResult = classifyFailure('429 Too many requests');
    expect(rateResult.class).toBe('rate_limit');

    // These values are used in alertness.js SQL:
    // WHERE COALESCE(payload->>'failure_class', '') NOT IN ('billing_cap', 'rate_limit')
  });

  it('BILLING_CAP class matches the filter string', () => {
    expect(FAILURE_CLASS.BILLING_CAP).toBe('billing_cap');
  });

  it('RATE_LIMIT class matches the filter string', () => {
    expect(FAILURE_CLASS.RATE_LIMIT).toBe('rate_limit');
  });
});

// ============================================================
// Pattern Completeness
// ============================================================

describe('Pattern Groups', () => {
  it('BILLING_CAP_PATTERNS has patterns', () => {
    expect(BILLING_CAP_PATTERNS.length).toBeGreaterThanOrEqual(2);
  });

  it('RATE_LIMIT_PATTERNS has patterns', () => {
    expect(RATE_LIMIT_PATTERNS.length).toBeGreaterThanOrEqual(3);
  });

  it('AUTH_PATTERNS has patterns', () => {
    expect(AUTH_PATTERNS.length).toBeGreaterThanOrEqual(3);
  });

  it('NETWORK_PATTERNS has patterns', () => {
    expect(NETWORK_PATTERNS.length).toBeGreaterThanOrEqual(3);
  });

  it('RESOURCE_PATTERNS has patterns', () => {
    expect(RESOURCE_PATTERNS.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================
// Priority: BILLING_CAP before RATE_LIMIT
// ============================================================

describe('Classification Priority', () => {
  it('BILLING_CAP has higher priority than RATE_LIMIT', () => {
    // "spending cap" + "rate limit" should classify as BILLING_CAP
    const result = classifyFailure('spending cap reached, rate limit exceeded');
    expect(result.class).toBe(FAILURE_CLASS.BILLING_CAP);
  });

  it('AUTH has higher priority than NETWORK', () => {
    // "permission denied" + "connection refused" should classify as AUTH
    const result = classifyFailure('permission denied after ECONNREFUSED');
    expect(result.class).toBe(FAILURE_CLASS.AUTH);
  });
});
