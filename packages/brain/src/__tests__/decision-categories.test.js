/**
 * decision-categories.js — decisions 表枚举允许值常量模块单测
 *
 * 与数据库 CHECK 约束逐字比对的漂移守卫在 routes/__tests__/strategic-decisions-category.test.js；
 * 这里锁模块自身契约：值集合、缺省值、不可变、isValidDecisionCategory 判定。
 */
import { describe, it, expect } from 'vitest';
import {
  DECISION_CATEGORIES,
  DEFAULT_DECISION_CATEGORY,
  DECISION_MADE_BY,
  DECISION_PRIORITIES,
  isValidDecisionCategory,
} from '../decision-categories.js';

describe('decision-categories 常量', () => {
  it('DECISION_CATEGORIES 含 13 个不重复的取值且包含 nfr / testing / invariant', () => {
    expect(DECISION_CATEGORIES).toHaveLength(13);
    expect(new Set(DECISION_CATEGORIES).size).toBe(13);
    expect(DECISION_CATEGORIES).toEqual(expect.arrayContaining(['nfr', 'testing', 'invariant']));
  });

  it('缺省 category 是 decision 且在允许值内', () => {
    expect(DEFAULT_DECISION_CATEGORY).toBe('decision');
    expect(DECISION_CATEGORIES).toContain(DEFAULT_DECISION_CATEGORY);
  });

  it('made_by 与 priority 允许值', () => {
    expect([...DECISION_MADE_BY]).toEqual(['user', 'cecelia', 'system']);
    expect([...DECISION_PRIORITIES]).toEqual(['P0', 'P1', 'P2', 'P3']);
  });

  it('三组允许值均被冻结，不能被调用方篡改', () => {
    expect(Object.isFrozen(DECISION_CATEGORIES)).toBe(true);
    expect(Object.isFrozen(DECISION_MADE_BY)).toBe(true);
    expect(Object.isFrozen(DECISION_PRIORITIES)).toBe(true);
    expect(() => DECISION_CATEGORIES.push('bogus')).toThrow(TypeError);
  });
});

describe('isValidDecisionCategory', () => {
  it('每个允许值都判为合法', () => {
    for (const c of DECISION_CATEGORIES) expect(isValidDecisionCategory(c)).toBe(true);
  });

  it('非法字符串、大小写不符、非字符串一律判为非法', () => {
    expect(isValidDecisionCategory('workflow_bogus')).toBe(false);
    expect(isValidDecisionCategory('NFR')).toBe(false);
    expect(isValidDecisionCategory('')).toBe(false);
    expect(isValidDecisionCategory(null)).toBe(false);
    expect(isValidDecisionCategory(undefined)).toBe(false);
    expect(isValidDecisionCategory(['nfr'])).toBe(false);
  });
});
