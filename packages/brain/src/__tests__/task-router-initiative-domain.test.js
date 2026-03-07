/**
 * task-router-initiative-domain.test.js
 *
 * Tests for domain-aware initiative_plan routing.
 * Domain → role → firstSkill mapping via role-registry.
 *
 * DoD coverage: D1-D6
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('getInitiativeSkill — domain-aware routing', () => {
  let getInitiativeSkill;
  let routeTaskCreate;

  beforeEach(async () => {
    const mod = await import('../task-router.js');
    getInitiativeSkill = mod.getInitiativeSkill;
    routeTaskCreate = mod.routeTaskCreate;
  });

  // D1
  it('coding domain → /architect', () => {
    expect(getInitiativeSkill('coding')).toBe('/architect');
  });

  // D2
  it('product domain → /plan (CPO 首选 skill)', () => {
    expect(getInitiativeSkill('product')).toBe('/plan');
  });

  // D3
  it('quality domain → /qa (VP QA 首选 skill)', () => {
    expect(getInitiativeSkill('quality')).toBe('/qa');
  });

  // D4
  it('null domain → /decomp (fallback)', () => {
    expect(getInitiativeSkill(null)).toBe('/decomp');
  });

  // D4 variant
  it('undefined domain → /decomp (fallback)', () => {
    expect(getInitiativeSkill(undefined)).toBe('/decomp');
  });

  // D5
  it('unknown domain → /decomp (fallback)', () => {
    expect(getInitiativeSkill('unknown_domain')).toBe('/decomp');
  });

  it('empty string domain → /decomp (fallback)', () => {
    expect(getInitiativeSkill('')).toBe('/decomp');
  });
});

describe('routeTaskCreate — initiative_plan + domain', () => {
  let routeTaskCreate;

  beforeEach(async () => {
    const mod = await import('../task-router.js');
    routeTaskCreate = mod.routeTaskCreate;
  });

  // D6
  it('initiative_plan + domain=coding → skill=/architect', () => {
    const routing = routeTaskCreate({
      title: '架构设计: 新功能',
      task_type: 'initiative_plan',
      domain: 'coding',
    });
    expect(routing.skill).toBe('/architect');
  });

  it('initiative_plan + domain=product → skill=/plan', () => {
    const routing = routeTaskCreate({
      title: '产品规划: 新功能',
      task_type: 'initiative_plan',
      domain: 'product',
    });
    expect(routing.skill).toBe('/plan');
  });

  it('initiative_plan + domain=quality → skill=/qa', () => {
    const routing = routeTaskCreate({
      title: '质量规划: 新功能',
      task_type: 'initiative_plan',
      domain: 'quality',
    });
    expect(routing.skill).toBe('/qa');
  });

  // D8 regression: no domain falls back to /decomp
  it('initiative_plan + no domain → skill=/decomp (backward compat)', () => {
    const routing = routeTaskCreate({
      title: '规划: 无 domain',
      task_type: 'initiative_plan',
    });
    expect(routing.skill).toBe('/decomp');
  });

  it('initiative_plan + unknown domain → skill=/decomp (fallback)', () => {
    const routing = routeTaskCreate({
      title: '规划: 未知 domain',
      task_type: 'initiative_plan',
      domain: 'unknown_xyz',
    });
    expect(routing.skill).toBe('/decomp');
  });

  it('dev task_type not affected by domain field', () => {
    const routing = routeTaskCreate({
      title: '开发任务',
      task_type: 'dev',
      domain: 'coding',
    });
    expect(routing.skill).toBe('/dev');
  });
});
