import { describe, expect, it } from 'vitest';

import {
  VALID_TRANSITIONS,
  isValidTransition,
  validateTransition,
} from '../gap-store.js';

describe('Gap Ledger 状态机', () => {
  it.each([
    ['open', 'assigned'],
    ['open', 'triage'],
    ['triage', 'assigned'],
    ['assigned', 'fixing'],
    ['assigned', 'open'],
    ['fixing', 'verifying'],
    ['verifying', 'resolved'],
    ['verifying', 'reopened'],
    ['reopened', 'assigned'],
  ])('%s → %s 合法', (from, to) => {
    expect(isValidTransition(from, to)).toBe(true);
    expect(() => validateTransition(from, to)).not.toThrow();
  });

  it.each([
    ['verifying', 'open'],
    ['resolved', 'fixing'],
    ['assigned', 'resolved'],
    ['open', 'fixing'],
    ['fixing', 'resolved'],
    ['reopened', 'open'],
  ])('%s → %s 非法并返回 422', (from, to) => {
    expect(isValidTransition(from, to)).toBe(false);
    expect(() => validateTransition(from, to)).toThrow(expect.objectContaining({
      code: 'invalid_transition',
      httpStatus: 422,
      from,
      to,
      allowed: VALID_TRANSITIONS[from],
    }));
  });

  it('状态集合完整且 resolved 为终态', () => {
    expect(Object.keys(VALID_TRANSITIONS).sort()).toEqual([
      'assigned', 'fixing', 'open', 'reopened', 'resolved', 'triage', 'verifying',
    ]);
    expect(VALID_TRANSITIONS.resolved).toEqual([]);
    expect(Object.values(VALID_TRANSITIONS).every(Array.isArray)).toBe(true);
  });

  it('相同非法跳转稳定产生相同错误码', () => {
    const errors = [];
    for (let index = 0; index < 2; index += 1) {
      try { validateTransition('resolved', 'open'); } catch (error) { errors.push(error); }
    }
    expect(errors.map((error) => error.code)).toEqual([
      'invalid_transition', 'invalid_transition',
    ]);
  });
});
