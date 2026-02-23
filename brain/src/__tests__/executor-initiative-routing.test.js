/**
 * Executor - Initiative routing 测试
 *
 * DoD 覆盖: D1
 *
 * 验证 getSkillForTaskType 和 getPermissionModeForTaskType 对 initiative_plan/initiative_verify 的处理。
 */

import { describe, it, expect } from 'vitest';
import { getSkillForTaskType, getPermissionModeForTaskType } from '../executor.js';

describe('executor initiative routing', () => {
  describe('getSkillForTaskType', () => {
    it('D1: initiative_plan returns null (no skill)', () => {
      expect(getSkillForTaskType('initiative_plan')).toBeNull();
    });

    it('D1: initiative_verify returns null (no skill)', () => {
      expect(getSkillForTaskType('initiative_verify')).toBeNull();
    });

    it('existing types still work', () => {
      expect(getSkillForTaskType('dev')).toBe('/dev');
      expect(getSkillForTaskType('review')).toBe('/review');
      expect(getSkillForTaskType('research')).toBeNull();
    });
  });

  describe('getPermissionModeForTaskType', () => {
    it('D1: initiative_plan uses bypassPermissions', () => {
      expect(getPermissionModeForTaskType('initiative_plan')).toBe('bypassPermissions');
    });

    it('D1: initiative_verify uses bypassPermissions', () => {
      expect(getPermissionModeForTaskType('initiative_verify')).toBe('bypassPermissions');
    });

    it('existing types still work', () => {
      expect(getPermissionModeForTaskType('dev')).toBe('bypassPermissions');
      expect(getPermissionModeForTaskType('review')).toBe('plan');
    });
  });
});
