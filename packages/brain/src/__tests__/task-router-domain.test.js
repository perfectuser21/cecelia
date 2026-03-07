/**
 * Task Router - Domain-aware skill override 路由测试
 *
 * DoD 覆盖: coding domain initiative_plan → /architect
 */

import { describe, it, expect } from 'vitest';

describe('task-router domain skill override', () => {
  it('getDomainSkillOverride: coding + initiative_plan → /architect', async () => {
    const mod = await import('../task-router.js');
    expect(mod.getDomainSkillOverride('initiative_plan', 'coding')).toBe('/architect');
  });

  it('getDomainSkillOverride: coding + dev → null (no override)', async () => {
    const mod = await import('../task-router.js');
    expect(mod.getDomainSkillOverride('dev', 'coding')).toBeNull();
  });

  it('getDomainSkillOverride: coding + review → null (no override)', async () => {
    const mod = await import('../task-router.js');
    expect(mod.getDomainSkillOverride('review', 'coding')).toBeNull();
  });

  it('getDomainSkillOverride: null domain → null', async () => {
    const mod = await import('../task-router.js');
    expect(mod.getDomainSkillOverride('initiative_plan', null)).toBeNull();
  });

  it('getDomainSkillOverride: null taskType → null', async () => {
    const mod = await import('../task-router.js');
    expect(mod.getDomainSkillOverride(null, 'coding')).toBeNull();
  });

  it('routeTaskCreate: coding + initiative_plan → skill=/architect', async () => {
    const mod = await import('../task-router.js');
    const routing = mod.routeTaskCreate({
      title: '拆解 coding Initiative',
      task_type: 'initiative_plan',
      domain: 'coding'
    });
    expect(routing.skill).toBe('/architect');
    expect(routing.task_type).toBe('initiative_plan');
  });

  it('routeTaskCreate: coding + dev → skill=/dev (no override)', async () => {
    const mod = await import('../task-router.js');
    const routing = mod.routeTaskCreate({
      title: '写代码任务',
      task_type: 'dev',
      domain: 'coding'
    });
    expect(routing.skill).toBe('/dev');
  });

  it('routeTaskCreate: no domain + initiative_plan → skill=/decomp (default)', async () => {
    const mod = await import('../task-router.js');
    const routing = mod.routeTaskCreate({
      title: '无 domain Initiative 拆解',
      task_type: 'initiative_plan'
    });
    expect(routing.skill).toBe('/decomp');
  });

  it('existing product domain is not affected (no regression)', async () => {
    const mod = await import('../task-router.js');
    // product domain 没有 override，应走默认 SKILL_WHITELIST
    const routing = mod.routeTaskCreate({
      title: '产品 Initiative 拆解',
      task_type: 'initiative_plan',
      domain: 'product'
    });
    expect(routing.skill).toBe('/decomp');
  });
});
