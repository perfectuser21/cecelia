/**
 * coding 路由收归 kernel — Sprint Tests 通道（root vitest config 收 sprints/**）
 *
 * 本文件是 TDD-red 记录 + Sprint Tests CI 通道用例：只覆盖 task-router 纯分类函数
 * （零 mock，可在 root vitest config 下直接跑）。dispatcher 集成 + 打标/幂等的完整用例
 * 见权威文件 packages/brain/src/__tests__/coding-route-kernel.test.js（brain-unit 通道，
 * 因为 packages/brain/vitest.config.js 的 include 不含 sprints/**，dispatcher 重 mock 用例
 * 必须落 src/__tests__/ 才被收录与执行）。
 *
 * Round 1 预期红证据：classifyCodeChange is not a function（未实现）。
 */

import { describe, it, expect } from 'vitest';
import {
  classifyCodeChange,
  resolveDispatchChannel,
  CODE_CHANGE_TASK_TYPES,
} from '../../../packages/brain/src/task-router.js';

describe('coding 路由收归 kernel — 纯分类 [BEHAVIOR]', () => {
  it('task_type=dev 判定改代码且 channel=kernel', () => {
    const t = { task_type: 'dev', payload: {} };
    expect(classifyCodeChange(t).code_change).toBe(true);
    expect(resolveDispatchChannel(t)).toBe('kernel');
  });

  it('task_type=codex_dev 判定改代码', () => {
    expect(classifyCodeChange({ task_type: 'codex_dev', payload: {} }).code_change).toBe(true);
    expect(CODE_CHANGE_TASK_TYPES.has('codex_dev')).toBe(true);
  });

  it('非改代码 task_type=research/arch_review 判定非改代码且 channel=legacy', () => {
    for (const tt of ['research', 'arch_review', 'talk', 'data']) {
      const t = { task_type: tt, payload: {} };
      expect(classifyCodeChange(t).code_change).toBe(false);
      expect(resolveDispatchChannel(t)).toBe('legacy');
    }
  });

  it('白名单外 + 显式 payload.code_change=true 扩展点 → 判定改代码', () => {
    const t = { task_type: 'research', payload: { code_change: true } };
    expect(classifyCodeChange(t).code_change).toBe(true);
    expect(resolveDispatchChannel(t)).toBe('kernel');
  });
});
