import { describe, it, expect } from 'vitest';
// TDD Red: 目标模块 packages/brain/src/lib/harness-failure-class.js 尚未实现 → import 失败 = 真红
import * as fc from '../../../packages/brain/src/lib/harness-failure-class.js';

describe('harness-failure-class [BEHAVIOR]', () => {
  it('FAILURE_CLASSES 冻结非空', () => {
    const arr = [...fc.FAILURE_CLASSES];
    expect(arr.length).toBeGreaterThan(0);
    expect(arr).toContain('unknown');
    // 冻结：不可变
    expect(Object.isFrozen(fc.FAILURE_CLASSES) || fc.FAILURE_CLASSES instanceof Set).toBe(true);
  });

  it('assertFailureClass 拒绝白名单外值', () => {
    expect(() => fc.assertFailureClass('__free_text__')).toThrow();
    expect(() => fc.assertFailureClass('')).toThrow();
    // 合法枚举不抛
    expect(() => fc.assertFailureClass('invalid_gear')).not.toThrow();
  });
});
