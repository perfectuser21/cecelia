/**
 * callback-utils-resolver.test.js
 *
 * RED→GREEN TDD for:
 *  C: resolveCanonicalPrUrl — 单一纯 resolver 逐项独立验证
 *     invalid 高优先级不遮蔽合法低优先级
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveCanonicalPrUrl, isValidGithubPrUrl, maybeMarkCompletedNoPr } from '../callback-utils.js';

const VALID_URL_A = 'https://github.com/org/repo/pull/100';
const VALID_URL_B = 'https://github.com/org/repo/pull/200';
const VALID_URL_C = 'https://github.com/org/repo/pull/300';
const INVALID_URL = 'not-a-github-url';
const TRUNCATED_URL = 'https://github.com/org/repo/pull/'; // missing number

// ════════════════════════════════════════════════════════════════
// Fix C: resolveCanonicalPrUrl — independent per-source validation
// ════════════════════════════════════════════════════════════════

describe('[FixC] resolveCanonicalPrUrl — 优先级链与逐项校验', () => {

  it('[C1] explicit 合法 → 直接返回，不查 DB', async () => {
    const pool = { query: vi.fn() };
    const result = await resolveCanonicalPrUrl(VALID_URL_A, 'task-1', pool);
    expect(result).toBe(VALID_URL_A);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('[C2] explicit 非法 → 查 DB tasks.pr_url（若合法则返回）', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ pr_url: VALID_URL_A, payload: null }],
      }),
    };
    const result = await resolveCanonicalPrUrl(INVALID_URL, 'task-1', pool);
    expect(result).toBe(VALID_URL_A);
  });

  it('[C3] explicit 非法 + tasks.pr_url 非法 → 用 payload.pr_url（若合法）', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ pr_url: INVALID_URL, payload: { pr_url: VALID_URL_B } }],
      }),
    };
    const result = await resolveCanonicalPrUrl(INVALID_URL, 'task-1', pool);
    expect(result).toBe(VALID_URL_B);
  });

  it('[C4] explicit 非法 + tasks.pr_url 非法 + payload.pr_url 非法 → 用 payload.existing_pr_url', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ pr_url: INVALID_URL, payload: { pr_url: TRUNCATED_URL, existing_pr_url: VALID_URL_C } }],
      }),
    };
    const result = await resolveCanonicalPrUrl(INVALID_URL, 'task-1', pool);
    expect(result).toBe(VALID_URL_C);
  });

  it('[C5] 所有来源均非法 → 返回 null', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ pr_url: INVALID_URL, payload: { pr_url: TRUNCATED_URL, existing_pr_url: 'bad' } }],
      }),
    };
    const result = await resolveCanonicalPrUrl(INVALID_URL, 'task-1', pool);
    expect(result).toBeNull();
  });

  it('[C6] tasks.pr_url 非法不遮蔽合法 payload.existing_pr_url（核心回归）', async () => {
    // tasks.pr_url 被设为非法值（如 stdout 抽出的短文本），payload.existing_pr_url 有完整 URL
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          pr_url: 'PR #4830',  // 非法：只有 PR 编号文本
          payload: {
            pr_url: null,
            existing_pr_url: VALID_URL_C,  // 合法的完整 URL
          },
        }],
      }),
    };

    const result = await resolveCanonicalPrUrl(null, 'task-1', pool);
    expect(result).toBe(VALID_URL_C);
  });

  it('[C7] explicit URL trim 后合法 → 返回 trimmed 值', async () => {
    const pool = { query: vi.fn() };
    const result = await resolveCanonicalPrUrl('  ' + VALID_URL_A + '  ', 'task-1', pool);
    expect(result).toBe(VALID_URL_A);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('[C8] DB 查询异常 → fail closed 返回 null（不抛出）', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('DB error')),
    };
    await expect(resolveCanonicalPrUrl(INVALID_URL, 'task-1', pool)).resolves.toBeNull();
  });

  it('[C9] tasks 行不存在 → 返回 null', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const result = await resolveCanonicalPrUrl(INVALID_URL, 'task-1', pool);
    expect(result).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════
// Fix C: maybeMarkCompletedNoPr reuses resolver logic
// ════════════════════════════════════════════════════════════════

describe('[FixC] maybeMarkCompletedNoPr — 复用 resolver，非法 tasks.pr_url 不阻断', () => {

  it('[C10] tasks.pr_url="PR #4830"（非法）但 payload.existing_pr_url 合法 → 不改为 completed_no_pr', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          task_type: 'dev',
          pr_url: 'PR #4830',
          payload: {
            existing_pr_url: VALID_URL_C,
          },
        }],
      }),
    };

    const result = await maybeMarkCompletedNoPr('completed', null, 'task-1', pool, 'test');
    // 由于 payload.existing_pr_url 合法，不应改为 completed_no_pr
    expect(result).toBe('completed');
  });

  it('[C11] 所有 URL 来源均非法 + dev task → 改为 completed_no_pr', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          task_type: 'dev',
          pr_url: null,
          payload: {
            pr_url: null,
            existing_pr_url: null,
          },
        }],
      }),
    };

    const result = await maybeMarkCompletedNoPr('completed', null, 'task-1', pool, 'test');
    expect(result).toBe('completed_no_pr');
  });
});

// ════════════════════════════════════════════════════════════════
// isValidGithubPrUrl edge cases
// ════════════════════════════════════════════════════════════════

describe('[FixC] isValidGithubPrUrl — 边界输入', () => {
  it('标准 URL → true', () => {
    expect(isValidGithubPrUrl('https://github.com/org/repo/pull/123')).toBe(true);
  });

  it('带 trim 的空白 → true（isValidGithubPrUrl 内部会 trim）', () => {
    // isValidGithubPrUrl 内部已做 .trim()，所以带空格的有效 URL 仍返回 true
    // resolver 也需 trim 以确保返回的值本身不带空格
    expect(isValidGithubPrUrl('  https://github.com/org/repo/pull/123  ')).toBe(true);
  });

  it('null → false', () => {
    expect(isValidGithubPrUrl(null)).toBe(false);
  });

  it('"PR #123" → false', () => {
    expect(isValidGithubPrUrl('PR #123')).toBe(false);
  });

  it('截断 URL（缺 PR 编号）→ false', () => {
    expect(isValidGithubPrUrl('https://github.com/org/repo/pull/')).toBe(false);
  });

  it('非 github.com 域名 → false', () => {
    expect(isValidGithubPrUrl('https://evil.com/org/repo/pull/123')).toBe(false);
  });
});
