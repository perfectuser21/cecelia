/**
 * callback-utils-sync-resolver.test.js
 *
 * RED→GREEN TDD for I1:
 *   resolveCanonicalPrUrlSync 与 async resolver 共用同一逐项校验逻辑
 *   explicit → tasks.pr_url → payload.pr_url → payload.existing_pr_url
 *   每项独立 trim+validate，首个合法返回；invalid 高优先级不遮蔽合法低优先级
 */

import { describe, it, expect } from 'vitest';

import { resolveCanonicalPrUrlSync } from '../lib/callback-utils.js';

const VALID_PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4830';
const INVALID_PR_URL = 'PR #4830'; // stdout 只输出了这个

// ════════════════════════════════════════════════════════════════
// I1: resolveCanonicalPrUrlSync 逐项独立校验（fix ||短路 bug）
// ════════════════════════════════════════════════════════════════

describe('[I1] resolveCanonicalPrUrlSync — 逐项独立校验，invalid 不遮蔽合法低优先级', () => {

  it('[I1-S1] tasks.pr_url 非法("PR #4830") + existing_pr_url 合法 → 返回 existing 合法 URL', () => {
    const taskRow = {
      pr_url: INVALID_PR_URL,          // tasks.pr_url 非法
      payload: {
        existing_pr_url: VALID_PR_URL, // 合法
      },
    };

    const result = resolveCanonicalPrUrlSync(null, taskRow);

    // Bug: ||短路时 'PR #4830'（truthy但非法）会遮蔽 existing_pr_url → 返回 null
    // Fix: 逐项独立校验时应返回 VALID_PR_URL
    expect(result).toBe(VALID_PR_URL);
  });

  it('[I1-S2] tasks.pr_url 非法 + payload.pr_url 非法 + existing_pr_url 合法 → 返回 existing', () => {
    const taskRow = {
      pr_url: 'bad-url',
      payload: {
        pr_url: 'also-bad',
        existing_pr_url: VALID_PR_URL,
      },
    };

    const result = resolveCanonicalPrUrlSync(null, taskRow);
    expect(result).toBe(VALID_PR_URL);
  });

  it('[I1-S3] explicit 合法 → 直接返回，不往下查', () => {
    const OTHER_VALID = 'https://github.com/a/b/pull/1';
    const taskRow = {
      pr_url: VALID_PR_URL,
      payload: { existing_pr_url: VALID_PR_URL },
    };

    const result = resolveCanonicalPrUrlSync(OTHER_VALID, taskRow);
    expect(result).toBe(OTHER_VALID);
  });

  it('[I1-S4] explicit 非法 + tasks.pr_url 合法 → 返回 tasks.pr_url', () => {
    const taskRow = {
      pr_url: VALID_PR_URL,
      payload: {},
    };

    const result = resolveCanonicalPrUrlSync(INVALID_PR_URL, taskRow);
    expect(result).toBe(VALID_PR_URL);
  });

  it('[I1-S5] explicit 有空格的合法 URL → trim 后返回', () => {
    const result = resolveCanonicalPrUrlSync('  ' + VALID_PR_URL + '  ', null);
    expect(result).toBe(VALID_PR_URL);
  });

  it('[I1-S6] 全链路均无合法 URL → null', () => {
    const taskRow = {
      pr_url: INVALID_PR_URL,
      payload: {
        pr_url: 'bad',
        existing_pr_url: 'also-bad',
      },
    };

    const result = resolveCanonicalPrUrlSync(null, taskRow);
    expect(result).toBeNull();
  });

  it('[I1-S7] taskRow 为 null/undefined → 不报错，返回 null', () => {
    expect(resolveCanonicalPrUrlSync(null, null)).toBeNull();
    expect(resolveCanonicalPrUrlSync(null, undefined)).toBeNull();
  });
});
