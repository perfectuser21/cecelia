/**
 * parseHarnessResult 配额失败分类回归测试（issue 7c9f427e / kernel 账号选择接入用量数据）。
 *
 * 契约锚点：contract-draft.md ## Response Schema —— parseHarnessResult 新增 account_exhausted
 * failure_class；429 weekly/rate limit 归类为账号耗尽类（区别于 runner_failure），偶发 429
 * 无配额语义仍维持 runner_failure（PRD 边界：不误判为账号耗尽，避免过度轮换）。
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：parseHarnessResult ↔ 输入 error 对象——本测试用真实
 * error shape 直接跑 parseHarnessResult，不 mock/stub 该函数或其分类分支。
 */
import { describe, it, expect } from 'vitest';
import { parseHarnessResult } from '../execution-contract.js';

// status=failed 的合法 harness result 骨架（schema 必填字段齐全，failure_class 留空由分类逻辑推导）
function failedResult(error, patch = {}) {
  return {
    contract_version: '1.0',
    attempt_id: '11111111-1111-4111-8111-111111111111',
    status: 'failed',
    summary: 'attempt failed',
    artifacts: [],
    checks: [],
    decision: null,
    error,
    provider_metadata: { provider: 'claude' },
    ...patch,
  };
}

describe('quota-exhaustion-classify: parseHarnessResult 配额失败分类（429 周限 → account_exhausted）', () => {
  it('429 weekly limit 的 failed 结果归类为 account_exhausted', () => {
    const result = parseHarnessResult(
      failedResult({ code: 'http_429', message: "You've hit your weekly limit" }),
      'generator',
    );
    expect(result.failure_class).toBe('account_exhausted');
  });

  it('偶发 429 无配额语义关键词 → 仍 runner_failure（不误判为账号耗尽）', () => {
    const result = parseHarnessResult(
      failedResult({ code: 'http_429', message: 'Too Many Requests' }),
      'generator',
    );
    expect(result.failure_class).toBe('runner_failure');
  });

  it('429 + rate_limit 语义（生产 api_error_status:429 shape）→ account_exhausted', () => {
    const result = parseHarnessResult(
      failedResult({
        code: 'http_429',
        message: 'api_error_status:429 "type":"rate_limit_error"',
      }),
      'generator',
    );
    expect(result.failure_class).toBe('account_exhausted');
  });

  it('error 非对象/缺 message 不 crash，回落 runner_failure', () => {
    expect(
      parseHarnessResult(failedResult(null), 'generator').failure_class,
    ).toBe('runner_failure');
    expect(
      parseHarnessResult(failedResult('boom'), 'generator').failure_class,
    ).toBe('runner_failure');
    expect(
      parseHarnessResult(failedResult({ code: 'runner_exit' }), 'generator').failure_class,
    ).toBe('runner_failure');
  });
});
