/**
 * 角色注册表
 *
 * 定义 10 个业务角色及其领域归属。
 * domain → owner_role 映射与 Plan SKILL.md Stage 0.5 保持一致。
 */

// ============================================================
// 角色定义
// ============================================================

export const ROLES = {
  cto: {
    id: 'cto',
    domain: 'coding',
    label: 'CTO',
    skills: ['/dev', '/audit', '/code-review', '/architect'],
  },
  cpo: {
    id: 'cpo',
    domain: 'product',
    label: 'CPO',
    skills: ['/plan', '/decomp'],
  },
  cmo: {
    id: 'cmo',
    domain: 'growth',
    label: 'CMO',
    skills: ['/research'],
  },
  cfo: {
    id: 'cfo',
    domain: 'finance',
    label: 'CFO',
    skills: [],
  },
  vp_research: {
    id: 'vp_research',
    domain: 'research',
    label: 'VP Research',
    skills: ['/research'],
  },
  vp_qa: {
    id: 'vp_qa',
    domain: 'quality',
    label: 'VP QA',
    skills: ['/qa', '/review'],
  },
  coo: {
    id: 'coo',
    domain: 'operations',
    label: 'COO',
    skills: [],
  },
  vp_knowledge: {
    id: 'vp_knowledge',
    domain: 'knowledge',
    label: 'VP Knowledge',
    skills: ['/knowledge'],
  },
  vp_agent_ops: {
    id: 'vp_agent_ops',
    domain: 'agent_ops',
    label: 'VP Agent Ops',
    skills: ['/cecelia-brain', '/brain-register'],
  },
  ciso: {
    id: 'ciso',
    domain: 'security',
    label: 'CISO',
    skills: ['/audit'],
  },
};

// ============================================================
// Domain → Owner Role 映射（对应 Plan SKILL.md Stage 0.5）
// ============================================================

export const DOMAIN_TO_ROLE = {
  coding: 'cto',
  product: 'cpo',
  growth: 'cmo',
  finance: 'cfo',
  research: 'vp_research',
  quality: 'vp_qa',
  security: 'cto',
  operations: 'coo',
  knowledge: 'vp_knowledge',
  agent_ops: 'vp_agent_ops',
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 根据 domain 返回对应的 owner_role。
 * 未知 domain 时返回默认值 'cto'（coding 领域默认）。
 *
 * @param {string} domain
 * @returns {string} owner_role
 */
export function getDomainRole(domain) {
  return DOMAIN_TO_ROLE[domain] ?? 'cto';
}

/**
 * 返回所有角色定义的数组。
 *
 * @returns {Array<{id: string, domain: string, label: string, skills: string[]}>}
 */
export function getAllRoles() {
  return Object.values(ROLES);
}
