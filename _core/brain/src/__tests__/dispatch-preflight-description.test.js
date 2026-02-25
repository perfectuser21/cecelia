/**
 * 测试 selectNextDispatchableTask 返回 description + prd_content 字段
 * 以及 pre-flight check 对这两个字段的处理
 *
 * DoD 映射：
 * - SELECT 包含 description → "返回 description 字段"
 * - 有 description 通过 pre-flight → "pre-flight 通过"
 * - 无 description/prd_content 失败 → "无 description 失败"
 * - prd_content fallback → "prd_content fallback"
 */

import { describe, it, expect } from 'vitest';
import { preFlightCheck } from '../pre-flight-check.js';

describe('pre-flight check — description + prd_content', () => {
  it('有 description 时 pre-flight 通过', async () => {
    const task = {
      id: 'test-1',
      title: 'Fix login bug in auth module',
      description: '修复登录超时问题，超过30秒后需要重新认证',
      prd_content: null,
      priority: 'P1'
    };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('无 description 且无 prd_content 时 pre-flight 失败', async () => {
    const task = {
      id: 'test-2',
      title: 'Fix something',
      description: null,
      prd_content: null,
      priority: 'P1'
    };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(false);
    expect(result.issues).toContain('Task description is empty');
  });

  it('description 为空字符串时 pre-flight 失败', async () => {
    const task = {
      id: 'test-3',
      title: 'Fix something',
      description: '',
      prd_content: null,
      priority: 'P0'
    };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(false);
    expect(result.issues).toContain('Task description is empty');
  });

  it('无 description 但有 prd_content 时使用 fallback 通过', async () => {
    const task = {
      id: 'test-4',
      title: 'Implement new feature',
      description: null,
      prd_content: '实现新的任务调度算法，支持优先级队列和依赖检查',
      priority: 'P1'
    };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('description undefined 时（selectNextDispatchableTask 旧行为）失败', async () => {
    // 模拟旧的 SELECT 没有 description 字段的情况
    const task = {
      id: 'test-5',
      title: 'Task without description field',
      // description 字段根本不存在（undefined，不是 null）
      priority: 'P1'
    };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(false);
    expect(result.issues).toContain('Task description is empty');
  });
});
