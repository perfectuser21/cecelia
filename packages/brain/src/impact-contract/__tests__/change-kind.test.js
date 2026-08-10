/**
 * FR-1 Change Normalizer 骨架测试
 * 覆盖：change_kind 四档映射、无效输入拒绝、change_kind/gear 字段分离
 *
 * 状态：RED — 实现尚未存在，所有测试预期失败
 * 文件路径：packages/brain/src/impact-contract/change-kind.js（待创建）
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// TODO: 实现完成后取消注释
// import { normalizeChangeKind, CHANGE_KIND } from '../../../packages/brain/src/impact-contract/change-kind.js';

describe('FR-1 Change Normalizer', () => {

  describe('正向映射：四档 change_kind', () => {

    test('task_type=new_feature → change_kind=new_capability', async () => {
      // TODO: implement
      assert.fail('RED: not yet implemented');
    });

    test('task_type=enhancement → change_kind=capability_change', async () => {
      // TODO: implement
      assert.fail('RED: not yet implemented');
    });

    test('task_type=bugfix → change_kind=bugfix', async () => {
      // TODO: implement
      assert.fail('RED: not yet implemented');
    });

    test('task_type=config_change → change_kind=parameter_only', async () => {
      // TODO: implement
      assert.fail('RED: not yet implemented');
    });

    test('显式传入 change_kind=new_capability 时直接使用，不被覆盖', async () => {
      // TODO: implement
      assert.fail('RED: not yet implemented');
    });

  });

  describe('负向映射：无效输入应被拒绝', () => {

    test('task_type=undefined 时抛出错误或返回 400', async () => {
      // TODO: implement
      assert.fail('RED: not yet implemented');
    });

    test('change_kind 传入非枚举值时抛出错误', async () => {
      // TODO: implement — 例如 change_kind="unknown_type" 应被拒绝
      assert.fail('RED: not yet implemented');
    });

    test('change_kind 为空字符串时被拒绝', async () => {
      // TODO: implement
      assert.fail('RED: not yet implemented');
    });

  });

  describe('字段分离约束：change_kind 与 gear 禁止互相赋值', () => {

    test('change_kind=new_capability 不会使 gear 被覆盖为 segmented', async () => {
      // TODO: implement — gear 应单独计算，不从 change_kind 推导
      assert.fail('RED: not yet implemented');
    });

    test('gear=single 不会影响 change_kind 的计算结果', async () => {
      // TODO: implement — change_kind 应单独计算，不从 gear 推导
      assert.fail('RED: not yet implemented');
    });

    test('normalizeChangeKind 返回结果中只包含 change_kind，不含 gear 字段', async () => {
      // TODO: implement
      assert.fail('RED: not yet implemented');
    });

  });

  describe('API 层面：change_kind 独立出现在 payload 中', () => {

    test('POST /api/brain/tasks 响应体中 change_kind 与 gear 均存在且值独立', async () => {
      // TODO: 需要 Brain 运行中，进行 HTTP 集成测试
      // 预期：response.change_kind !== response.gear（枚举值不同）
      assert.fail('RED: not yet implemented — requires Brain running');
    });

  });

});
