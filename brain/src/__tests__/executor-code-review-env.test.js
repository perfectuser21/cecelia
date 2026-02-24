/**
 * Tests for getExtraEnvForTaskType — code-review env isolation (v1.89.1)
 *
 * Verifies that SKILL_CONTEXT is injected for code_review tasks and that
 * other task types are not affected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock heavy dependencies before importing executor
vi.mock('pg', () => ({
  default: { Pool: vi.fn(() => ({ query: vi.fn(), connect: vi.fn() })) },
  Pool: vi.fn(() => ({ query: vi.fn(), connect: vi.fn() })),
}));
vi.mock('../db-config.js', () => ({
  default: { user: 'test', host: 'localhost', database: 'test', password: 'test', port: 5432 },
  DB_DEFAULTS: { user: 'test', host: 'localhost', database: 'test', password: 'test', port: 5432 },
}));
vi.mock('../model-profile.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getActiveProfile: vi.fn(() => null),
    loadActiveProfile: vi.fn(async () => {}),
  };
});

const { getExtraEnvForTaskType } = await import('../executor.js');

describe('getExtraEnvForTaskType', () => {
  it('code_review → 返回 SKILL_CONTEXT=code_review', () => {
    const env = getExtraEnvForTaskType('code_review');
    expect(env).toEqual({ SKILL_CONTEXT: 'code_review' });
  });

  it('dev → 返回空对象', () => {
    expect(getExtraEnvForTaskType('dev')).toEqual({});
  });

  it('audit → 返回空对象', () => {
    expect(getExtraEnvForTaskType('audit')).toEqual({});
  });

  it('review → 返回空对象', () => {
    expect(getExtraEnvForTaskType('review')).toEqual({});
  });

  it('dept_heartbeat → 返回空对象', () => {
    expect(getExtraEnvForTaskType('dept_heartbeat')).toEqual({});
  });

  it('未知类型 → 返回空对象', () => {
    expect(getExtraEnvForTaskType('unknown_type')).toEqual({});
    expect(getExtraEnvForTaskType('')).toEqual({});
    expect(getExtraEnvForTaskType(undefined)).toEqual({});
  });

  it('SKILL_CONTEXT 值只能是字符串，不能包含 shell 注入字符', () => {
    const env = getExtraEnvForTaskType('code_review');
    expect(typeof env.SKILL_CONTEXT).toBe('string');
    // 不含 shell 特殊字符
    expect(env.SKILL_CONTEXT).toMatch(/^[a-zA-Z0-9_]+$/);
  });
});
