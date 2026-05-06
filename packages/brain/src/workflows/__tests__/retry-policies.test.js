/**
 * retry-policies.test.js — exact-name pairing stub for lint-test-pairing
 *
 * 真实集成测试在 tests/integration/harness-retry-policy.test.ts（带 LangGraph + StateGraph）。
 * 此文件做单元层断言：policy 配置 + retryOn 函数行为。
 */
import { describe, it, expect } from 'vitest';
import { LLM_RETRY, DB_RETRY, NO_RETRY } from '../retry-policies.js';

describe('retry-policies module (W2)', () => {
  it('LLM_RETRY 配置：maxAttempts=3, exp backoff with jitter', () => {
    expect(LLM_RETRY.maxAttempts).toBe(3);
    expect(LLM_RETRY.initialInterval).toBe(5000);
    expect(LLM_RETRY.backoffFactor).toBe(2.0);
    expect(LLM_RETRY.jitter).toBe(true);
    expect(typeof LLM_RETRY.retryOn).toBe('function');
  });

  it('DB_RETRY 配置：maxAttempts=2, no jitter', () => {
    expect(DB_RETRY.maxAttempts).toBe(2);
    expect(DB_RETRY.initialInterval).toBe(1000);
    expect(DB_RETRY.jitter).toBe(false);
    expect(typeof DB_RETRY.retryOn).toBe('function');
  });

  it('NO_RETRY 配置：maxAttempts=1', () => {
    expect(NO_RETRY.maxAttempts).toBe(1);
  });

  it('LLM_RETRY.retryOn 永久错（401/403/schema/parse） → false', () => {
    expect(LLM_RETRY.retryOn(new Error('HTTP 401 invalid api key'))).toBe(false);
    expect(LLM_RETRY.retryOn(new Error('HTTP 403 forbidden'))).toBe(false);
    expect(LLM_RETRY.retryOn(new Error('schema validation failed'))).toBe(false);
    expect(LLM_RETRY.retryOn(new Error('parse error: unexpected token'))).toBe(false);
    expect(LLM_RETRY.retryOn(new Error('parse failed near eof'))).toBe(false);
    expect(LLM_RETRY.retryOn(new Error('GraphInterrupt: paused'))).toBe(false);
    expect(LLM_RETRY.retryOn(new Error('AbortError: aborted'))).toBe(false);
  });

  it('LLM_RETRY.retryOn 瞬时错（503/timeout/network） → true', () => {
    expect(LLM_RETRY.retryOn(new Error('HTTP 503 service unavailable'))).toBe(true);
    expect(LLM_RETRY.retryOn(new Error('ETIMEDOUT'))).toBe(true);
    expect(LLM_RETRY.retryOn(new Error('ECONNRESET network blip'))).toBe(true);
    expect(LLM_RETRY.retryOn(new Error('socket hang up'))).toBe(true);
  });

  it('DB_RETRY.retryOn 业务永久错（UNIQUE/外键/duplicate） → false', () => {
    expect(DB_RETRY.retryOn(new Error('duplicate key value'))).toBe(false);
    expect(DB_RETRY.retryOn(new Error('UNIQUE constraint failed'))).toBe(false);
    expect(DB_RETRY.retryOn(new Error('foreign key violation'))).toBe(false);
  });

  it('DB_RETRY.retryOn 瞬时 DB 错（connection lost） → true', () => {
    expect(DB_RETRY.retryOn(new Error('connection terminated unexpectedly'))).toBe(true);
    expect(DB_RETRY.retryOn(new Error('ECONNREFUSED 127.0.0.1:5432'))).toBe(true);
  });
});
