/**
 * role-registry.js 单元测试
 */

import { describe, it, expect } from 'vitest';
import { ROLES, DOMAIN_TO_ROLE, getDomainRole, getAllRoles, getDomainTaskTypes, buildDomainRouteTable } from '../role-registry.js';

describe('ROLES', () => {
  it('包含 10 个角色定义', () => {
    expect(Object.keys(ROLES)).toHaveLength(10);
  });

  it('包含所有预期角色 id', () => {
    const expectedIds = ['cto', 'cpo', 'cmo', 'cfo', 'vp_research', 'vp_qa', 'coo', 'vp_knowledge', 'vp_agent_ops', 'ciso'];
    expectedIds.forEach(id => {
      expect(ROLES[id]).toBeDefined();
      expect(ROLES[id].id).toBe(id);
    });
  });

  it('每个角色都有 id / domain / label / skills 字段', () => {
    Object.values(ROLES).forEach(role => {
      expect(typeof role.id).toBe('string');
      expect(typeof role.domain).toBe('string');
      expect(typeof role.label).toBe('string');
      expect(Array.isArray(role.skills)).toBe(true);
    });
  });

  it('5 个核心角色都有 task_types 字段', () => {
    const coreRoles = ['cto', 'cpo', 'cmo', 'cfo', 'coo'];
    coreRoles.forEach(id => {
      expect(ROLES[id].task_types).toBeDefined();
      expect(typeof ROLES[id].task_types).toBe('object');
    });
  });

  it('CTO 拥有 dev / code_review 等 task_types', () => {
    expect(ROLES.cto.task_types.dev).toBe('dev');
    expect(ROLES.cto.task_types.code_review).toBe('code_review');
    expect(ROLES.cto.task_types.pipeline_rescue).toBe('pipeline_rescue');
  });

  it('CPO 拥有 initiative_plan / decomp_review 等 task_types', () => {
    expect(ROLES.cpo.task_types.initiative_plan).toBe('initiative_plan');
    expect(ROLES.cpo.task_types.decomp_review).toBe('decomp_review');
  });
});

describe('DOMAIN_TO_ROLE', () => {
  it('包含 10 个 domain 映射', () => {
    expect(Object.keys(DOMAIN_TO_ROLE)).toHaveLength(10);
  });

  it('mapping 与 Plan SKILL.md Stage 0.5 一致', () => {
    expect(DOMAIN_TO_ROLE.coding).toBe('cto');
    expect(DOMAIN_TO_ROLE.product).toBe('cpo');
    expect(DOMAIN_TO_ROLE.growth).toBe('cmo');
    expect(DOMAIN_TO_ROLE.finance).toBe('cfo');
    expect(DOMAIN_TO_ROLE.research).toBe('vp_research');
    expect(DOMAIN_TO_ROLE.quality).toBe('vp_qa');
    expect(DOMAIN_TO_ROLE.security).toBe('cto');
    expect(DOMAIN_TO_ROLE.operations).toBe('coo');
    expect(DOMAIN_TO_ROLE.knowledge).toBe('vp_knowledge');
    expect(DOMAIN_TO_ROLE.agent_ops).toBe('vp_agent_ops');
  });
});

describe('getDomainRole()', () => {
  it('已知 domain 返回正确 role', () => {
    expect(getDomainRole('coding')).toBe('cto');
    expect(getDomainRole('product')).toBe('cpo');
    expect(getDomainRole('agent_ops')).toBe('vp_agent_ops');
    expect(getDomainRole('quality')).toBe('vp_qa');
  });

  it('未知 domain 返回默认值 cto（coding 域默认）', () => {
    expect(getDomainRole('unknown')).toBe('cto');
    expect(getDomainRole('')).toBe('cto');
    expect(getDomainRole('random_domain')).toBe('cto');
  });
});

describe('getAllRoles()', () => {
  it('返回 10 个角色的数组', () => {
    const roles = getAllRoles();
    expect(Array.isArray(roles)).toBe(true);
    expect(roles).toHaveLength(10);
  });

  it('返回的每个元素都有 id 字段', () => {
    getAllRoles().forEach(role => {
      expect(typeof role.id).toBe('string');
    });
  });
});

describe('getDomainTaskTypes()', () => {
  it('coding domain 返回 CTO 的 task_types', () => {
    const types = getDomainTaskTypes('coding');
    expect(types.dev).toBe('dev');
    expect(types.code_review).toBe('code_review');
  });

  it('product domain 返回 CPO 的 task_types', () => {
    const types = getDomainTaskTypes('product');
    expect(types.initiative_plan).toBe('initiative_plan');
  });

  it('未知 domain 降级到 CTO task_types', () => {
    const types = getDomainTaskTypes('unknown');
    expect(types.dev).toBe('dev');
  });
});

describe('buildDomainRouteTable()', () => {
  it('返回包含 5 个核心角色的路由表字符串', () => {
    const table = buildDomainRouteTable();
    expect(table).toContain('CTO');
    expect(table).toContain('CPO');
    expect(table).toContain('CMO');
    expect(table).toContain('CFO');
    expect(table).toContain('COO');
  });

  it('路由表包含 domain 和 task_types 信息', () => {
    const table = buildDomainRouteTable();
    expect(table).toContain('coding');
    expect(table).toContain('dev');
  });
});
