/**
 * insight-to-constraint —— 启发式抽取 + 写回 dispatch_constraint
 *
 * 闭合 Cortex Insight 6a569a1e 教训：rumination learnings 必须在同次 session 中
 * 转化为 dispatch 约束，否则认知成本沉没。
 */

import { describe, it, expect, vi } from 'vitest';
import {
  extractConstraintHeuristic,
  persistConstraint,
  autoExtractAndPersist,
} from '../insight-to-constraint.js';
import { isValidConstraint } from '../insight-constraints.js';

describe('extractConstraintHeuristic', () => {
  it('从 "task title 中禁止使用 X" 抽取 deny_keyword on title', () => {
    const insight = '调度教训：task title 中禁止使用 "force-merge" 这种危险关键词。';
    const c = extractConstraintHeuristic(insight);
    expect(c).not.toBeNull();
    expect(c.rule).toBe('deny_keyword');
    expect(c.field).toBe('title');
    expect(c.patterns).toContain('force-merge');
    expect(c.severity).toBe('block');
    expect(isValidConstraint(c)).toBe(true);
  });

  it('从 "description 中应避免 X" 抽取 deny_keyword on description', () => {
    const insight = 'task description 中应避免 "skip-review" 类隐性绕过指令。';
    const c = extractConstraintHeuristic(insight);
    expect(c).not.toBeNull();
    expect(c.rule).toBe('deny_keyword');
    expect(c.field).toBe('description');
    expect(c.patterns).toContain('skip-review');
    expect(isValidConstraint(c)).toBe(true);
  });

  it('从 "必须含 payload.X" 抽取 require_payload', () => {
    const insight = 'retry 任务必须含 payload.parent_task_id 才能追溯链路。';
    const c = extractConstraintHeuristic(insight);
    expect(c).not.toBeNull();
    expect(c.rule).toBe('require_payload');
    expect(c.key).toBe('parent_task_id');
    expect(isValidConstraint(c)).toBe(true);
  });

  it('从 "title 至少 N 字" 抽取 require_field', () => {
    const insight = '任务 title 至少 12 字才能避免歧义派发。';
    const c = extractConstraintHeuristic(insight);
    expect(c).not.toBeNull();
    expect(c.rule).toBe('require_field');
    expect(c.field).toBe('title');
    expect(c.min_length).toBe(12);
    expect(isValidConstraint(c)).toBe(true);
  });

  it('无 actionable pattern 的纯描述性 insight 返回 null', () => {
    const insight = '今天系统跑得很顺，没什么大问题。';
    expect(extractConstraintHeuristic(insight)).toBeNull();
  });

  it('空字符串 / null 返回 null', () => {
    expect(extractConstraintHeuristic('')).toBeNull();
    expect(extractConstraintHeuristic(null)).toBeNull();
  });
});

describe('persistConstraint', () => {
  it('constraint 非 null 且 dispatch_constraint 列空时写回', async () => {
    const queries = [];
    const fakePool = {
      query: vi.fn(async (sql, params) => {
        queries.push({ sql, params });
        if (/SELECT.*dispatch_constraint/i.test(sql)) {
          return { rows: [{ dispatch_constraint: null, metadata: {} }] };
        }
        return { rows: [] };
      }),
    };
    const constraint = {
      rule: 'deny_keyword',
      field: 'title',
      patterns: ['force-merge'],
      reason: 'test',
      severity: 'block',
    };
    const out = await persistConstraint('learning-1', constraint, fakePool, { source: 'heuristic-v1' });
    expect(out.written).toBe(true);
    expect(out.markedAttempted).toBe(true);
    const updateSql = queries.find(q => /UPDATE\s+learnings/i.test(q.sql) && /dispatch_constraint\s*=/.test(q.sql));
    expect(updateSql).toBeTruthy();
  });

  it('已存在 dispatch_constraint 时跳过覆写但仍标记 attempted', async () => {
    const fakePool = {
      query: vi.fn(async (sql) => {
        if (/SELECT.*dispatch_constraint/i.test(sql)) {
          return { rows: [{ dispatch_constraint: { rule: 'deny_keyword', field: 'title', patterns: ['old'] }, metadata: {} }] };
        }
        return { rows: [] };
      }),
    };
    const constraint = { rule: 'deny_keyword', field: 'title', patterns: ['x'], severity: 'block' };
    const out = await persistConstraint('learning-2', constraint, fakePool, { source: 'heuristic-v1' });
    expect(out.written).toBe(false);
    expect(out.markedAttempted).toBe(true);
  });

  it('constraint=null 不写 dispatch_constraint 但写 metadata.constraint_extraction.status=no_match', async () => {
    const queries = [];
    const fakePool = {
      query: vi.fn(async (sql, params) => {
        queries.push({ sql, params });
        if (/SELECT.*dispatch_constraint/i.test(sql)) {
          return { rows: [{ dispatch_constraint: null, metadata: {} }] };
        }
        return { rows: [] };
      }),
    };
    const out = await persistConstraint('learning-3', null, fakePool, { source: 'heuristic-v1' });
    expect(out.written).toBe(false);
    expect(out.markedAttempted).toBe(true);
    const metaUpdate = queries.find(q => /UPDATE\s+learnings/i.test(q.sql) && /metadata/.test(q.sql));
    expect(metaUpdate).toBeTruthy();
    const params = JSON.stringify(metaUpdate.params || []);
    expect(params).toContain('no_match');
  });

  it('learning 不存在时返回 written=false / markedAttempted=false', async () => {
    const fakePool = {
      query: vi.fn(async (sql) => {
        if (/SELECT.*dispatch_constraint/i.test(sql)) return { rows: [] };
        return { rows: [] };
      }),
    };
    const out = await persistConstraint('missing', null, fakePool);
    expect(out.written).toBe(false);
    expect(out.markedAttempted).toBe(false);
  });

  it('无效 constraint 退化为 null（不通过 schema 校验时不写）', async () => {
    const queries = [];
    const fakePool = {
      query: vi.fn(async (sql) => {
        queries.push({ sql });
        if (/SELECT.*dispatch_constraint/i.test(sql)) {
          return { rows: [{ dispatch_constraint: null, metadata: {} }] };
        }
        return { rows: [] };
      }),
    };
    const bad = { rule: 'magic' };
    const out = await persistConstraint('learning-4', bad, fakePool, { source: 'heuristic-v1' });
    expect(out.written).toBe(false);
    expect(out.markedAttempted).toBe(true);
  });
});

describe('autoExtractAndPersist', () => {
  it('actionable insight → 抽取并写回', async () => {
    const queries = [];
    const fakePool = {
      query: vi.fn(async (sql, params) => {
        queries.push({ sql, params });
        if (/SELECT.*dispatch_constraint/i.test(sql)) {
          return { rows: [{ dispatch_constraint: null, metadata: {} }] };
        }
        return { rows: [] };
      }),
    };
    const out = await autoExtractAndPersist(
      'learning-A',
      'task title 中禁止使用 "force-merge" 这种危险关键词。',
      fakePool
    );
    expect(out.extracted).toBe(true);
    expect(out.written).toBe(true);
    expect(out.constraint?.rule).toBe('deny_keyword');
  });

  it('非 actionable insight → 无写入但仍标记 attempted', async () => {
    const fakePool = {
      query: vi.fn(async (sql) => {
        if (/SELECT.*dispatch_constraint/i.test(sql)) {
          return { rows: [{ dispatch_constraint: null, metadata: {} }] };
        }
        return { rows: [] };
      }),
    };
    const out = await autoExtractAndPersist('learning-B', '今天系统跑得很顺。', fakePool);
    expect(out.extracted).toBe(false);
    expect(out.written).toBe(false);
  });

  it('DB 报错时不抛异常，返回 written=false', async () => {
    const fakePool = {
      query: vi.fn(async () => { throw new Error('db down'); }),
    };
    const out = await autoExtractAndPersist(
      'learning-C',
      'task title 中禁止使用 "x"',
      fakePool
    );
    expect(out.written).toBe(false);
  });
});
