/**
 * 角色注册表（v2.0 — 5 个核心角色 + 向后兼容别名）
 *
 * 按业务领域划分，不按工作类型。每个 task_type 只归一个角色。
 * 丘脑只判断 domain，角色决定用什么 task_type。
 *
 * 5 个核心角色：
 * - CTO: Cecelia 核心系统（Brain/Engine/CI/Dashboard）+ 安全 + 质量 + agent_ops
 * - CPO: 规划拆解（跨领域服务）+ 知识管理
 * - CMO: 内容 + 发布 + 增长 + 调研
 * - CFO: 投资 + 交易 + 财务
 * - COO: 物理基础设施 + 设备 + 部署
 */

// ============================================================
// 核心角色定义（5 个）
// ============================================================

export const ROLES = {
  cto: {
    id: 'cto',
    domain: 'coding',
    label: 'CTO',
    description: 'Cecelia 核心系统开发 + 安全 + 质量',
    skills: ['/dev', '/audit', '/code-review', '/architect', '/review', '/cecelia-brain', '/brain-register'],
    task_types: {
      dev: 'dev',
      codex_dev: 'codex_dev',
      code_review: 'code_review',
      code_review_gate: 'code_review_gate',
      pr_review: 'pr_review',
      spec_review: 'spec_review',
      qa: 'qa',
      audit: 'audit',
      codex_qa: 'codex_qa',
      architecture_design: 'architecture_design',
      architecture_scan: 'architecture_scan',
      arch_review: 'arch_review',
      pipeline_rescue: 'pipeline_rescue',
      codex_test_gen: 'codex_test_gen',
    },
  },
  cpo: {
    id: 'cpo',
    domain: 'product',
    label: 'CPO',
    description: '规划拆解（跨领域服务）+ 知识管理',
    skills: ['/plan', '/decomp', '/decomp-check', '/knowledge', '/strategy-session'],
    task_types: {
      initiative_plan: 'initiative_plan',
      initiative_verify: 'initiative_verify',
      initiative_execute: 'initiative_execute',
      initiative_review: 'initiative_review',
      scope_plan: 'scope_plan',
      project_plan: 'project_plan',
      decomp_review: 'decomp_review',
      prd_review: 'prd_review',
      suggestion_plan: 'suggestion_plan',
      intent_expand: 'intent_expand',
      strategy_session: 'strategy_session',
      knowledge: 'knowledge',
    },
  },
  cmo: {
    id: 'cmo',
    domain: 'growth',
    label: 'CMO',
    description: '内容 + 发布 + 增长 + 调研',
    skills: ['/content-creator', '/research', '/explore'],
    task_types: {
      'content-pipeline': 'content-pipeline',
      'content-research': 'content-research',
      'content-generate': 'content-generate',
      'content-review': 'content-review',
      'content-export': 'content-export',
      content_publish: 'content_publish',
      research: 'research',
      explore: 'explore',
    },
  },
  cfo: {
    id: 'cfo',
    domain: 'finance',
    label: 'CFO',
    description: '投资 + 交易 + 财务',
    skills: [],
    task_types: {},
  },
  coo: {
    id: 'coo',
    domain: 'operations',
    label: 'COO',
    description: '物理基础设施 + 设备 + 部署 + 运维',
    skills: ['/janitor'],
    task_types: {
      data: 'data',
      dept_heartbeat: 'dept_heartbeat',
      codex_playwright: 'codex_playwright',
      talk: 'talk',
    },
  },

  // ============================================================
  // 向后兼容别名（旧角色映射到新角色，不要新增引用）
  // ============================================================
  vp_research: { id: 'vp_research', domain: 'research', label: 'VP Research', skills: ['/research'], task_types: {} },
  vp_qa: { id: 'vp_qa', domain: 'quality', label: 'VP QA', skills: ['/qa', '/review'], task_types: {} },
  vp_knowledge: { id: 'vp_knowledge', domain: 'knowledge', label: 'VP Knowledge', skills: ['/knowledge'], task_types: {} },
  vp_agent_ops: { id: 'vp_agent_ops', domain: 'agent_ops', label: 'VP Agent Ops', skills: ['/cecelia-brain', '/brain-register'], task_types: {} },
  ciso: { id: 'ciso', domain: 'security', label: 'CISO', skills: ['/audit'], task_types: {} },
};

// ============================================================
// Domain → Owner Role 映射（新映射）
// ============================================================

export const DOMAIN_TO_ROLE = {
  // 核心 5 领域
  coding: 'cto',
  product: 'cpo',
  growth: 'cmo',
  finance: 'cfo',
  operations: 'coo',
  // 合并到核心角色的领域
  security: 'cto',
  quality: 'vp_qa',       // 向后兼容：保留旧映射避免测试断裂
  research: 'vp_research', // 向后兼容
  knowledge: 'vp_knowledge', // 向后兼容
  agent_ops: 'vp_agent_ops', // 向后兼容
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 根据 domain 返回对应的 owner_role。
 * 未知 domain 时返回默认值 'cto'（coding 领域默认）。
 */
export function getDomainRole(domain) {
  return DOMAIN_TO_ROLE[domain] ?? 'cto';
}

/**
 * 返回所有角色定义的数组。
 */
export function getAllRoles() {
  return Object.values(ROLES);
}

/**
 * 根据 domain 获取该领域可用的 task_types 列表。
 */
export function getDomainTaskTypes(domain) {
  const roleId = getDomainRole(domain);
  const role = ROLES[roleId];
  return role?.task_types || {};
}

/**
 * 生成丘脑可用的 domain 路由表（供 prompt 注入）。
 * 只展示 5 个核心角色。
 */
export function buildDomainRouteTable() {
  const coreRoles = ['cto', 'cpo', 'cmo', 'cfo', 'coo'];
  const lines = [];
  for (const roleId of coreRoles) {
    const role = ROLES[roleId];
    const domains = Object.entries(DOMAIN_TO_ROLE)
      .filter(([, r]) => r === roleId)
      .map(([d]) => d);
    const taskTypeKeys = Object.keys(role.task_types || {});
    lines.push(`- ${role.label} (${domains.join('/')}) — ${role.description} | task_types: ${taskTypeKeys.join(', ') || '暂无'}`);
  }
  return lines.join('\n');
}
