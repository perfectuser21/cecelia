/**
 * extract-field-fallback.test.js
 *
 * 覆盖 harness-graph.js::extractField 对多种 Claude 输出格式的兼容性。
 *
 * 背景：harness task 0154e285 在 Generator 里 git push 静默失败时 Claude 输出
 *      `pr_url: null`，老正则贪婪匹配返回字符串 "null"，Evaluator 拿到假 URL
 *      永远 FAIL，Fix 循环无限死循环。本测试锁死修复行为。
 */

import { describe, it, expect } from 'vitest';
import { extractField } from '../harness-graph.js';

describe('extractField - 无效字面量拒绝（根因 B 的核心修复）', () => {
  it('handles null literal → returns null (not string "null")', () => {
    const out = 'pr_url: null\npr_branch: null';
    const v = extractField(out, 'pr_url');
    expect(v).toBeNull();
    expect(v).not.toBe('null');
  });

  it('rejects invalid literals for pr_url', () => {
    expect(extractField('pr_url: null', 'pr_url')).toBeNull();
    expect(extractField('pr_url: FAILED', 'pr_url')).toBeNull();
    expect(extractField('pr_url: none', 'pr_url')).toBeNull();
    expect(extractField('pr_url: undefined', 'pr_url')).toBeNull();
    expect(extractField('pr_url: TBD', 'pr_url')).toBeNull();
    expect(extractField('pr_url: error', 'pr_url')).toBeNull();
    expect(extractField('pr_url: <url>', 'pr_url')).toBeNull();
  });

  it('rejects empty value', () => {
    expect(extractField('pr_url: \n', 'pr_url')).toBeNull();
    expect(extractField('pr_url:\n', 'pr_url')).toBeNull();
  });

  it('rejects invalid literals for pr_branch', () => {
    expect(extractField('pr_branch: null', 'pr_branch')).toBeNull();
    expect(extractField('pr_branch: FAILED', 'pr_branch')).toBeNull();
    expect(extractField('pr_branch: none', 'pr_branch')).toBeNull();
  });
});

describe('extractField - 有效字面量（没 regression）', () => {
  it('still handles valid literal for pr_url', () => {
    const out = 'pr_url: https://github.com/foo/bar/pull/123';
    expect(extractField(out, 'pr_url')).toBe('https://github.com/foo/bar/pull/123');
  });

  it('still handles valid literal for pr_branch', () => {
    const out = 'pr_branch: cp-04191234-fix-ws1';
    expect(extractField(out, 'pr_branch')).toBe('cp-04191234-fix-ws1');
  });

  it('handles markdown bold key **pr_url**: ...', () => {
    const out = '**pr_url**: https://github.com/foo/bar/pull/999';
    expect(extractField(out, 'pr_url')).toBe('https://github.com/foo/bar/pull/999');
  });

  it('handles multi-line output where both fields coexist', () => {
    const out = [
      '已完成 WS-1',
      'pr_url: https://github.com/perfectuser21/cecelia/pull/2500',
      'pr_branch: cp-04191900-fix-ws1',
      '',
    ].join('\n');
    expect(extractField(out, 'pr_url')).toBe('https://github.com/perfectuser21/cecelia/pull/2500');
    expect(extractField(out, 'pr_branch')).toBe('cp-04191900-fix-ws1');
  });
});

describe('extractField - pr_url fallback（SKILL.md JSON 格式兼容）', () => {
  it('fallback to raw github URL for pr_url (gh pr create default output)', () => {
    const out = 'PR created successfully\nhttps://github.com/foo/bar/pull/42';
    expect(extractField(out, 'pr_url')).toBe('https://github.com/foo/bar/pull/42');
  });

  it('handles JSON format from SKILL.md Step 7', () => {
    const out = '{"verdict": "DONE", "pr_url": "https://github.com/foo/bar/pull/123"}';
    // 无论 Step 1 字面量匹配还是 Step 2 fallback，都能拿到 URL
    expect(extractField(out, 'pr_url')).toBe('https://github.com/foo/bar/pull/123');
  });

  it('handles JSON format with pr_url: null → fallback still returns null', () => {
    // SKILL.md 里如果 PR 失败，Claude 可能输出 {"verdict":"FAILED","pr_url":null}
    const out = '{"verdict": "FAILED", "pr_url": null}';
    expect(extractField(out, 'pr_url')).toBeNull();
  });

  it('handles markdown link format', () => {
    const out = 'See the [PR #99](https://github.com/foo/bar/pull/99) for details';
    expect(extractField(out, 'pr_url')).toBe('https://github.com/foo/bar/pull/99');
  });

  it('handles text with PR URL embedded without prefix', () => {
    const out = 'Pushed to https://github.com/perfectuser21/cecelia/pull/2500 successfully';
    expect(extractField(out, 'pr_url')).toBe('https://github.com/perfectuser21/cecelia/pull/2500');
  });

  it('returns null for no URL at all', () => {
    expect(extractField('some random text with no URL', 'pr_url')).toBeNull();
  });
});

describe('extractField - pr_branch fallback', () => {
  it('fallback to cp- branch for pr_branch (no prefix)', () => {
    const out = 'Pushed branch cp-04191234-xxx-ws1 to origin';
    expect(extractField(out, 'pr_branch')).toBe('cp-04191234-xxx-ws1');
  });

  it('fallback extracts cp- branch from mixed text', () => {
    const out = 'git push -u origin cp-04191900-fix-ws2\nDone.';
    expect(extractField(out, 'pr_branch')).toBe('cp-04191900-fix-ws2');
  });

  it('returns null when no cp- branch pattern exists', () => {
    expect(extractField('just random text without branch', 'pr_branch')).toBeNull();
  });

  it('does not confuse cp- in non-branch context (too short digit run)', () => {
    // cp-123 不是合法 branch 名（我们要求 8-10 位时间戳）
    expect(extractField('cp-123 should not match', 'pr_branch')).toBeNull();
  });
});

describe('extractField - 边界情况', () => {
  it('returns null for null/empty input', () => {
    expect(extractField(null, 'pr_url')).toBeNull();
    expect(extractField('', 'pr_url')).toBeNull();
    expect(extractField(undefined, 'pr_url')).toBeNull();
  });

  it('case-insensitive field name match', () => {
    const out = 'PR_URL: https://github.com/foo/bar/pull/1';
    expect(extractField(out, 'pr_url')).toBe('https://github.com/foo/bar/pull/1');
  });

  it('handles other fields without special fallback (no regression on report_path)', () => {
    expect(extractField('report_path: sprints/final.md', 'report_path')).toBe('sprints/final.md');
    // 非 pr_url/pr_branch 的字段没有 URL/branch fallback
    expect(extractField('some text without field', 'report_path')).toBeNull();
  });
});
