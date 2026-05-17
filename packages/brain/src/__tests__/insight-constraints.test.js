/**
 * insight-constraints —— 约束 DSL 校验、加载、求值
 */

import { describe, it, expect } from 'vitest';
import {
  isValidConstraint,
  evaluateConstraints,
  loadActiveConstraints,
} from '../insight-constraints.js';

describe('isValidConstraint', () => {
  it('rejects null / non-object', () => {
    expect(isValidConstraint(null)).toBe(false);
    expect(isValidConstraint(undefined)).toBe(false);
    expect(isValidConstraint('string')).toBe(false);
  });

  it('rejects unknown rule', () => {
    expect(isValidConstraint({ rule: 'magic' })).toBe(false);
  });

  it('rejects deny_keyword without patterns', () => {
    expect(isValidConstraint({ rule: 'deny_keyword', field: 'title' })).toBe(false);
    expect(isValidConstraint({ rule: 'deny_keyword', field: 'title', patterns: [] })).toBe(false);
  });

  it('rejects deny_keyword on unsupported field', () => {
    expect(isValidConstraint({ rule: 'deny_keyword', field: 'payload', patterns: ['x'] })).toBe(false);
  });

  it('accepts valid deny_keyword', () => {
    expect(isValidConstraint({ rule: 'deny_keyword', field: 'description', patterns: ['x'] })).toBe(true);
  });

  it('rejects require_field without min_length', () => {
    expect(isValidConstraint({ rule: 'require_field', field: 'title' })).toBe(false);
    expect(isValidConstraint({ rule: 'require_field', field: 'title', min_length: 0 })).toBe(false);
  });

  it('accepts valid require_field', () => {
    expect(isValidConstraint({ rule: 'require_field', field: 'title', min_length: 5 })).toBe(true);
  });

  it('accepts valid require_payload', () => {
    expect(isValidConstraint({ rule: 'require_payload', key: 'foo' })).toBe(true);
  });

  it('rejects invalid severity', () => {
    expect(isValidConstraint({ rule: 'require_payload', key: 'foo', severity: 'oops' })).toBe(false);
  });

  it('rejects deny_payload without key', () => {
    expect(isValidConstraint({ rule: 'deny_payload', values: ['x'] })).toBe(false);
    expect(isValidConstraint({ rule: 'deny_payload', key: '', values: ['x'] })).toBe(false);
  });

  it('rejects deny_payload without non-empty values array', () => {
    expect(isValidConstraint({ rule: 'deny_payload', key: 'foo' })).toBe(false);
    expect(isValidConstraint({ rule: 'deny_payload', key: 'foo', values: [] })).toBe(false);
    expect(isValidConstraint({ rule: 'deny_payload', key: 'foo', values: 'not-array' })).toBe(false);
  });

  it('accepts valid deny_payload', () => {
    expect(isValidConstraint({
      rule: 'deny_payload',
      key: 'previous_failure.class',
      values: ['auth', 'env_broken'],
    })).toBe(true);
  });
});

describe('evaluateConstraints — deny_keyword', () => {
  const entries = [
    {
      learning_id: 'aaaaaaaa-1111-2222-3333-444444444444',
      title: 'avoid foo',
      constraint: {
        rule: 'deny_keyword',
        field: 'description',
        patterns: ['foo', 'bar'],
        reason: 'foo/bar 已被弃用',
        severity: 'block',
      },
    },
  ];

  it('blocks task whose description contains forbidden keyword', () => {
    const r = evaluateConstraints({ description: 'use foo here' }, entries);
    expect(r.issues.length).toBe(1);
    expect(r.issues[0]).toContain('foo/bar 已被弃用');
    expect(r.issues[0]).toContain('aaaaaaaa');
  });

  it('passes task without forbidden keyword', () => {
    const r = evaluateConstraints({ description: 'clean text' }, entries);
    expect(r.issues).toEqual([]);
    expect(r.suggestions).toEqual([]);
  });

  it('warn severity goes into suggestions instead of issues', () => {
    const warn = [{
      ...entries[0],
      constraint: { ...entries[0].constraint, severity: 'warn' },
    }];
    const r = evaluateConstraints({ description: 'use foo' }, warn);
    expect(r.issues).toEqual([]);
    expect(r.suggestions.length).toBe(1);
  });

  it('case-insensitive matching', () => {
    const r = evaluateConstraints({ description: 'USE FOO HERE' }, entries);
    expect(r.issues.length).toBe(1);
  });
});

describe('evaluateConstraints — require_field', () => {
  const entries = [{
    learning_id: 'bbbbbbbb-1111-2222-3333-444444444444',
    title: 'min length',
    constraint: {
      rule: 'require_field',
      field: 'title',
      min_length: 30,
      reason: '标题需 ≥30 字以避免歧义',
    },
  }];

  it('blocks short title', () => {
    const r = evaluateConstraints({ title: 'short' }, entries);
    expect(r.issues.length).toBe(1);
    expect(r.issues[0]).toContain('标题需');
  });

  it('passes long enough title', () => {
    const r = evaluateConstraints({ title: 'x'.repeat(40) }, entries);
    expect(r.issues).toEqual([]);
  });
});

describe('evaluateConstraints — require_payload', () => {
  const entries = [{
    learning_id: 'cccccccc-1111-2222-3333-444444444444',
    title: 'need spec link',
    constraint: {
      rule: 'require_payload',
      key: 'spec.url',
      reason: 'PRD 必须附 spec.url',
    },
  }];

  it('blocks when key missing', () => {
    const r = evaluateConstraints({ payload: {} }, entries);
    expect(r.issues.length).toBe(1);
  });

  it('blocks when key value is empty string', () => {
    const r = evaluateConstraints({ payload: { spec: { url: '' } } }, entries);
    expect(r.issues.length).toBe(1);
  });

  it('passes when nested key exists', () => {
    const r = evaluateConstraints({ payload: { spec: { url: 'https://x' } } }, entries);
    expect(r.issues).toEqual([]);
  });

  it('handles missing payload gracefully', () => {
    const r = evaluateConstraints({}, entries);
    expect(r.issues.length).toBe(1);
  });
});

describe('evaluateConstraints — deny_payload (failure_type 分类路由)', () => {
  // 把 learning 6a569a1e 的 insight 转成硬规则：
  // retry 任务 payload.previous_failure.class 命中 PERMANENT_DEPENDENCY/STRUCTURAL/UNKNOWN 时阻止派发
  const entries = [{
    learning_id: '6a569a1e-83c4-4052-a05a-59b2a09840a8',
    title: 'failure_type 分类路由',
    constraint: {
      rule: 'deny_payload',
      key: 'previous_failure.class',
      values: ['auth', 'resource', 'env_broken', 'unknown'],
      reason: 'PERMANENT_DEPENDENCY/STRUCTURAL/UNKNOWN 不可重试，统一 retry 是浪费',
      severity: 'block',
    },
  }];

  it('blocks retry whose previous_failure.class is env_broken (STRUCTURAL)', () => {
    const r = evaluateConstraints(
      { payload: { retry_count: 1, previous_failure: { class: 'env_broken' } } },
      entries
    );
    expect(r.issues.length).toBe(1);
    expect(r.issues[0]).toContain('PERMANENT_DEPENDENCY/STRUCTURAL');
  });

  it('blocks retry whose previous_failure.class is auth (PERMANENT_DEPENDENCY)', () => {
    const r = evaluateConstraints(
      { payload: { previous_failure: { class: 'auth' } } },
      entries
    );
    expect(r.issues.length).toBe(1);
  });

  it('passes retry whose previous_failure.class is transient', () => {
    const r = evaluateConstraints(
      { payload: { retry_count: 1, previous_failure: { class: 'transient' } } },
      entries
    );
    expect(r.issues).toEqual([]);
  });

  it('passes brand-new task with no previous_failure (key absent)', () => {
    const r = evaluateConstraints({ payload: { prd_summary: 'do thing' } }, entries);
    expect(r.issues).toEqual([]);
    expect(r.suggestions).toEqual([]);
  });

  it('passes when payload itself is missing', () => {
    const r = evaluateConstraints({ title: 't' }, entries);
    expect(r.issues).toEqual([]);
  });

  it('warn severity goes into suggestions', () => {
    const warn = [{
      ...entries[0],
      constraint: { ...entries[0].constraint, severity: 'warn' },
    }];
    const r = evaluateConstraints(
      { payload: { previous_failure: { class: 'env_broken' } } },
      warn
    );
    expect(r.issues).toEqual([]);
    expect(r.suggestions.length).toBe(1);
  });
});

describe('evaluateConstraints — multiple rules', () => {
  it('aggregates issues + suggestions across rules', () => {
    const entries = [
      {
        learning_id: 'dddddddd-1111-2222-3333-444444444444',
        title: 'r1',
        constraint: { rule: 'deny_keyword', field: 'title', patterns: ['hack'], reason: 'r1', severity: 'block' },
      },
      {
        learning_id: 'eeeeeeee-1111-2222-3333-444444444444',
        title: 'r2',
        constraint: { rule: 'require_field', field: 'description', min_length: 50, reason: 'r2', severity: 'warn' },
      },
    ];
    const r = evaluateConstraints({ title: 'quick hack', description: 'short' }, entries);
    expect(r.issues.length).toBe(1);
    expect(r.suggestions.length).toBe(1);
  });

  it('returns empty on empty entries', () => {
    expect(evaluateConstraints({ title: 't' }, [])).toEqual({ issues: [], suggestions: [] });
  });

  it('returns empty when entries is not array', () => {
    expect(evaluateConstraints({ title: 't' }, null)).toEqual({ issues: [], suggestions: [] });
  });
});

describe('loadActiveConstraints — db error path', () => {
  it('returns [] when query throws (missing column / table)', async () => {
    const failingPool = { query: async () => { throw new Error('column "dispatch_constraint" does not exist'); } };
    const r = await loadActiveConstraints(failingPool);
    expect(r).toEqual([]);
  });

  it('filters out invalid constraint rows', async () => {
    const mockPool = {
      query: async () => ({
        rows: [
          { id: 'id-1', title: 't1', dispatch_constraint: { rule: 'unknown' } },
          { id: 'id-2', title: 't2', dispatch_constraint: { rule: 'deny_keyword', field: 'title', patterns: ['bad'] } },
        ],
      }),
    };
    const r = await loadActiveConstraints(mockPool);
    expect(r.length).toBe(1);
    expect(r[0].learning_id).toBe('id-2');
  });
});
