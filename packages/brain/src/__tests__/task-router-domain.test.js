/**
 * task-router-domain.test.js
 *
 * 测试 getDomainSkillOverride 和 routeTaskCreate 的 domain 感知路由逻辑。
 */

import { describe, it, expect } from 'vitest';
import {
  getDomainSkillOverride,
  routeTaskCreate,
} from '../task-router.js';

// ============================================================
// getDomainSkillOverride
// ============================================================

describe('getDomainSkillOverride - null/undefined domain', () => {
  it('null domain → null（向后兼容）', () => {
    expect(getDomainSkillOverride('dev', null)).toBeNull();
  });

  it('undefined domain → null', () => {
    expect(getDomainSkillOverride('dev', undefined)).toBeNull();
  });

  it('空字符串 domain → null', () => {
    expect(getDomainSkillOverride('dev', '')).toBeNull();
  });
});

describe('getDomainSkillOverride - coding domain', () => {
  it('coding + dev → null（使用默认 /dev，无覆盖）', () => {
    expect(getDomainSkillOverride('dev', 'coding')).toBeNull();
  });

  it('coding 大小写不敏感 → null', () => {
    expect(getDomainSkillOverride('dev', 'CODING')).toBeNull();
  });
});

describe('getDomainSkillOverride - non-coding domains', () => {
  it('product domain → CPO 首选 skill /plan', () => {
    const result = getDomainSkillOverride('dev', 'product');
    expect(result).toBe('/plan');
  });

  it('quality domain → VP QA 首选 skill /qa', () => {
    const result = getDomainSkillOverride('dev', 'quality');
    expect(result).toBe('/qa');
  });

  it('research domain → VP Research 首选 skill /research', () => {
    const result = getDomainSkillOverride('dev', 'research');
    expect(result).toBe('/research');
  });

  it('knowledge domain → VP Knowledge 首选 skill /knowledge', () => {
    const result = getDomainSkillOverride('dev', 'knowledge');
    expect(result).toBe('/knowledge');
  });

  it('growth domain → CMO 首选 skill /research', () => {
    const result = getDomainSkillOverride('dev', 'growth');
    expect(result).toBe('/research');
  });
});

describe('getDomainSkillOverride - unknown/empty roles', () => {
  it('未知 domain → null', () => {
    expect(getDomainSkillOverride('dev', 'unknown_domain_xyz')).toBeNull();
  });

  it('finance domain（CFO skills 为空）→ null', () => {
    expect(getDomainSkillOverride('dev', 'finance')).toBeNull();
  });

  it('operations domain（COO skills 为空）→ null', () => {
    expect(getDomainSkillOverride('dev', 'operations')).toBeNull();
  });
});

// ============================================================
// routeTaskCreate - domain 参数
// ============================================================

describe('routeTaskCreate - domain 路由', () => {
  it('coding domain + dev → skill=/dev（与无 domain 行为一致）', () => {
    const result = routeTaskCreate({ title: 'coding task', task_type: 'dev', domain: 'coding' });
    expect(result.skill).toBe('/dev');
    expect(result.domain).toBe('coding');
  });

  it('product domain + dev → skill=/plan', () => {
    const result = routeTaskCreate({ title: 'product task', task_type: 'dev', domain: 'product' });
    expect(result.skill).toBe('/plan');
    expect(result.domain).toBe('product');
  });

  it('quality domain + dev → skill=/qa', () => {
    const result = routeTaskCreate({ title: 'quality task', task_type: 'dev', domain: 'quality' });
    expect(result.skill).toBe('/qa');
    expect(result.domain).toBe('quality');
  });

  it('null domain → skill=/dev（向后兼容，domain 字段为 null）', () => {
    const result = routeTaskCreate({ title: 'no domain task', task_type: 'dev', domain: null });
    expect(result.skill).toBe('/dev');
    expect(result.domain).toBeNull();
  });

  it('无 domain 参数 → skill=/dev（向后兼容）', () => {
    const result = routeTaskCreate({ title: 'legacy task', task_type: 'dev' });
    expect(result.skill).toBe('/dev');
    expect(result.domain).toBeNull();
  });

  it('initiative_plan + coding domain → skill=/architect（domain-aware routing via getInitiativeSkill）', () => {
    const result = routeTaskCreate({ title: 'init plan', task_type: 'initiative_plan', domain: 'coding' });
    // initiative_plan uses getInitiativeSkill: coding → /architect
    expect(result.skill).toBe('/architect');
  });

  it('routing_reason 包含 domain 信息（当 domain 存在时）', () => {
    const result = routeTaskCreate({ title: 'domain task', task_type: 'dev', domain: 'product' });
    expect(result.routing_reason).toContain('domain=product');
  });

  it('routing_reason 不包含 domain（当 domain 为 null 时）', () => {
    const result = routeTaskCreate({ title: 'no domain', task_type: 'dev' });
    expect(result.routing_reason).not.toContain('domain=');
  });
});
