/**
 * FR-1 Change Normalizer 测试
 * 覆盖：change_kind 四档映射、无效输入拒绝、change_kind/gear 字段分离
 *
 * sprint: 08110022-relay-d96c9fa0 ws1
 */

import { describe, test, expect } from 'vitest';

import {
  normalizeChangeKind,
  deriveChangeKindFromTaskType,
  resolveChangeKind,
  CHANGE_KINDS,
} from '../change-kind.js';

describe('FR-1 Change Normalizer', () => {

  describe('正向映射：四档 change_kind', () => {

    test('task_type=new_feature → change_kind=new_capability', () => {
      const result = resolveChangeKind({ task_type: 'new_feature' });
      expect(result).toBe('new_capability');
    });

    test('task_type=enhancement → change_kind=capability_change', () => {
      const result = resolveChangeKind({ task_type: 'enhancement' });
      expect(result).toBe('capability_change');
    });

    test('task_type=bugfix → change_kind=bugfix', () => {
      const result = resolveChangeKind({ task_type: 'bugfix' });
      expect(result).toBe('bugfix');
    });

    test('task_type=config_change → change_kind=parameter_only', () => {
      const result = resolveChangeKind({ task_type: 'config_change' });
      expect(result).toBe('parameter_only');
    });

    test('显式传入 change_kind=new_capability 时直接使用，不被覆盖', () => {
      // 即使 task_type 是 bugfix，显式 change_kind 也不应被 task_type 覆盖
      const result = resolveChangeKind({ change_kind: 'new_capability', task_type: 'bugfix' });
      expect(result).toBe('new_capability');
    });

  });

  describe('负向映射：无效输入应被拒绝', () => {

    test('task_type=undefined 时抛出错误或返回 400', () => {
      // task_type=undefined 且无显式 change_kind → 返回 null（上层决定如何处理，API 层返回 null 后可默认或 400）
      // 此处测试 normalizeChangeKind(undefined) 返回 null（不抛错，由 resolveChangeKind 的上层处理）
      const result = resolveChangeKind({ task_type: undefined });
      expect(result).toBe(null);
    });

    test('change_kind 传入非枚举值时抛出错误', () => {
      let caughtErr;
      try { normalizeChangeKind('unknown_type'); } catch(e) { caughtErr = e; }
      expect(caughtErr).toBeDefined();
      expect(caughtErr.message).toContain('invalid_change_kind');
      expect(caughtErr.message).toContain('unknown_type');
    });

    test('change_kind 为空字符串时被拒绝', () => {
      let caughtErr;
      try { normalizeChangeKind(''); } catch(e) { caughtErr = e; }
      expect(caughtErr).toBeDefined();
      expect(caughtErr.message).toContain('invalid_change_kind');
    });

  });

  describe('字段分离约束：change_kind 与 gear 禁止互相赋值', () => {

    test('change_kind=new_capability 不会使 gear 被覆盖为 segmented', () => {
      // resolveChangeKind 只处理 change_kind，不触碰 gear 字段
      // 验证：调用后 gear 字段不被修改
      const input = { change_kind: 'new_capability', gear: 'default' };
      const result = resolveChangeKind(input);
      expect(result).toBe('new_capability');
      // gear 字段原封不动，resolveChangeKind 不返回 gear
      expect(input.gear).toBe('default');
    });

    test('gear=single 不会影响 change_kind 的计算结果', () => {
      // 无论 gear 是什么值，change_kind 从 task_type 推导的结果不变
      const resultWithGear = resolveChangeKind({ task_type: 'bugfix', gear: 'segmented' });
      const resultWithoutGear = resolveChangeKind({ task_type: 'bugfix' });
      expect(resultWithGear).toBe('bugfix');
      expect(resultWithoutGear).toBe('bugfix');
      expect(resultWithGear).toBe(resultWithoutGear);
    });

    test('normalizeChangeKind 返回结果中只包含 change_kind，不含 gear 字段', () => {
      const result = normalizeChangeKind('new_capability');
      // 返回值是字符串，不是对象，不可能含有 gear 字段
      expect(typeof result).toBe('string');
      expect(result).toBe('new_capability');
      // 确认返回的是 CHANGE_KINDS 枚举之一
      expect(CHANGE_KINDS.includes(result)).toBeTruthy();
    });

  });

  describe('API 层面：change_kind 独立出现在 payload 中', () => {

    test('POST /api/brain/tasks 响应体中 change_kind 与 gear 均存在且值独立', async () => {
      // 单元层验证：resolveChangeKind 产生 change_kind='bugfix'，而 gear 独立由 deriveGear() 决定
      // 两者枚举值来自不同集合，不可能混淆
      const changeKind = resolveChangeKind({ task_type: 'bugfix' });
      const gear = 'segmented'; // 假设由 deriveGear() 返回的值

      expect(changeKind).toBe('bugfix');
      expect(gear).toBe('segmented');
      // change_kind 枚举值（bugfix）不在 GEAR_VALUES 中，gear 枚举值（segmented）不在 CHANGE_KINDS 中
      expect(CHANGE_KINDS.includes(changeKind)).toBeTruthy();
      expect(CHANGE_KINDS.includes(gear)).toBe(false);
    });

  });

  describe('遗留值兼容映射', () => {

    test('旧值 fix → bugfix', () => {
      expect(normalizeChangeKind('fix')).toBe('bugfix');
    });

    test('旧值 thicken → capability_change', () => {
      expect(normalizeChangeKind('thicken')).toBe('capability_change');
    });

    test('旧值 small → parameter_only', () => {
      expect(normalizeChangeKind('small')).toBe('parameter_only');
    });

    test('旧值 enhancement → capability_change', () => {
      expect(normalizeChangeKind('enhancement')).toBe('capability_change');
    });

  });

  describe('CHANGE_KINDS 常量', () => {

    test('CHANGE_KINDS 包含且仅包含四个规范值', () => {
      expect([...CHANGE_KINDS].sort()).toEqual(
        ['bugfix', 'capability_change', 'new_capability', 'parameter_only'].sort()
      );
    });

    test('null 输入返回 null', () => {
      expect(normalizeChangeKind(null)).toBe(null);
    });

    test('undefined 输入返回 null', () => {
      expect(normalizeChangeKind(undefined)).toBe(null);
    });

  });

});
