/**
 * parseHarnessResult × 配额耗尽分类（Brain issue 7c9f427e, P0）。
 *
 * 根因：execution-contract 把 429 归类为 runner_failure → derive 判 run 终态 failed，
 * 不轮换账号。本测试锚定新增 failure_class='account_exhausted'：
 *  - claude/account1 命中 429 weekly limit 的 failed 结果 → account_exhausted
 *    （区别于普通 runner_failure，供 derive 走同 run 轮换而非终态）。
 *  - 偶发 429 无配额语义关键词 → 保持 runner_failure（PRD 边界：不过度轮换）。
 *
 * DB-free 纯单元测试（parseHarnessResult 是纯解析函数）。
 */
import { describe, it, expect } from 'vitest';

import { parseHarnessResult } from '../execution-contract.js';

const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';

function failedResult(error) {
  return {
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'failed',
    summary: 'attempt failed',
    artifacts: [],
    checks: [],
    decision: null,
    error,
    provider_metadata: { provider: 'claude' },
  };
}

describe('parseHarnessResult 配额耗尽分类', () => {
  it('429 weekly limit 的 failed 结果归类为 account_exhausted', () => {
    const parsed = parseHarnessResult(
      failedResult({ code: 'http_429', message: "You've hit your weekly limit" }),
      'generator',
    );
    expect(parsed.failure_class).toBe('account_exhausted');
  });

  it('rate_limit_error 语义的 429 也归类为 account_exhausted', () => {
    const parsed = parseHarnessResult(
      failedResult({ code: 'http_429', message: 'api_error_status:429 rate limit exceeded' }),
      'generator',
    );
    expect(parsed.failure_class).toBe('account_exhausted');
  });

  it('偶发 429 无配额语义关键词 → 保持 runner_failure（不过度轮换）', () => {
    const parsed = parseHarnessResult(
      failedResult({ code: 'http_429', message: 'Too Many Requests' }),
      'generator',
    );
    expect(parsed.failure_class).toBe('runner_failure');
  });

  it('非 429 的普通失败仍是 runner_failure（回归保护）', () => {
    const parsed = parseHarnessResult(
      failedResult({ code: 'runner_exit', message: 'bounded diagnostic' }),
      'generator',
    );
    expect(parsed.failure_class).toBe('runner_failure');
  });
});
