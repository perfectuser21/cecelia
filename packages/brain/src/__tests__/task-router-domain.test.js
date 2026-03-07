/**
 * task-router.js domain 路由集成测试
 *
 * 验证 getTaskLocation() 在有 domain 时优先按 domain 路由，
 * 无 domain 时 fallback 到 task_type 路由。
 */

import { describe, it, expect } from 'vitest';
import { getTaskLocation, routeTaskCreate } from '../task-router.js';

describe('getTaskLocation — domain 优先路由', () => {
  it('有 domain=growth → hk（即使 task_type=dev 也返回 hk）', () => {
    expect(getTaskLocation('dev', 'growth')).toBe('hk');
  });

  it('有 domain=finance → hk', () => {
    expect(getTaskLocation('dev', 'finance')).toBe('hk');
  });

  it('有 domain=research → hk', () => {
    expect(getTaskLocation('dev', 'research')).toBe('hk');
  });

  it('有 domain=coding → us', () => {
    expect(getTaskLocation('talk', 'coding')).toBe('us');
  });

  it('有 domain=agent_ops → us', () => {
    expect(getTaskLocation('talk', 'agent_ops')).toBe('us');
  });

  it('有 domain=quality → us', () => {
    expect(getTaskLocation('data', 'quality')).toBe('us');
  });

  it('无 domain → fallback 到 task_type 路由', () => {
    expect(getTaskLocation('dev')).toBe('us');
    expect(getTaskLocation('talk')).toBe('hk');
    expect(getTaskLocation('research')).toBe('hk');
    expect(getTaskLocation('data')).toBe('hk');
  });

  it('无 domain 且无 task_type → 返回默认 us', () => {
    expect(getTaskLocation(null)).toBe('us');
    expect(getTaskLocation(undefined)).toBe('us');
    expect(getTaskLocation('')).toBe('us');
  });

  it('未知 domain → fallback 到 task_type', () => {
    expect(getTaskLocation('dev', 'unknown_domain')).toBe('us');
    expect(getTaskLocation('talk', 'unknown_domain')).toBe('hk');
  });
});

describe('routeTaskCreate — domain 字段传递', () => {
  it('有 domain=growth 的任务路由到 hk', () => {
    const result = routeTaskCreate({
      title: 'SEO 优化',
      task_type: 'dev',
      domain: 'growth',
    });
    expect(result.location).toBe('hk');
  });

  it('有 domain=coding 的任务路由到 us', () => {
    const result = routeTaskCreate({
      title: '修复 bug',
      task_type: 'dev',
      domain: 'coding',
    });
    expect(result.location).toBe('us');
  });

  it('无 domain 时按 task_type 路由', () => {
    const result = routeTaskCreate({
      title: '深度调研',
      task_type: 'research',
    });
    expect(result.location).toBe('hk');
  });
});
