import { describe, expect, it } from 'vitest';

import { createHarnessAttemptRunRouter, ALLOWED_ROLES } from '../harness-attempt-run.js';

// 主断言在 tests/gp/f1/step3-attempt-run-endpoint.test.js（产物闸要求的边上守卫）；
// 本文件是 lint-test-pairing 的配套单测，锁工厂契约。
describe('createHarnessAttemptRunRouter 工厂契约', () => {
  it('没有 pool → 拒绝构造', () => {
    expect(() => createHarnessAttemptRunRouter()).toThrow(/pool/);
    expect(() => createHarnessAttemptRunRouter({ pool: {} })).toThrow(/pool/);
  });

  it('角色白名单封闭：包含九个执行角色，永不包含 commander/publisher', () => {
    expect(ALLOWED_ROLES).toHaveLength(9);
    for (const role of ['canary', 'planner', 'generator', 'generator-fix', 'judge']) {
      expect(ALLOWED_ROLES).toContain(role);
    }
    expect(ALLOWED_ROLES).not.toContain('commander');
    expect(ALLOWED_ROLES).not.toContain('publisher');
    expect(Object.isFrozen(ALLOWED_ROLES)).toBe(true);
  });

  it('返回可挂载的 express Router', () => {
    const router = createHarnessAttemptRunRouter({ pool: { query: async () => ({ rows: [] }) } });
    expect(typeof router).toBe('function');
    expect(Array.isArray(router.stack)).toBe(true);
    const paths = router.stack.map((layer) => layer.route?.path).filter(Boolean);
    expect(paths).toContain('/attempt-run');
    expect(paths).toContain('/attempt-run/:attemptId');
  });
});
