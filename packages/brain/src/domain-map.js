/**
 * domain-map.js - Domain detection and owner_role mapping
 *
 * Implements Stage 0.5 domain detection from /plan SKILL.md v1.7.0
 *
 * 10 domains, keyword-based matching (no LLM).
 * Priority: agent_ops > quality > security > coding (default)
 */

/**
 * Domain → keyword patterns mapping
 */
const DOMAIN_KEYWORDS = {
  coding: [
    /代码/i, /开发/i, /bug/i, /CI/i, /工程/i, /架构/i, /API/i, /重构/i,
    /测试/i, /PR/i, /依赖/i, /实现/i, /编写/i, /修复/i, /构建/i,
    /function/i, /module/i, /component/i, /migration/i, /schema/i, /lint/i,
    /typescript/i, /javascript/i, /python/i, /devgate/i, /vitest/i
  ],
  product: [
    /产品/i, /需求/i, /PRD/i, /用户体验/i, /功能设计/i, /交互/i, /流程设计/i,
    /用户故事/i, /原型/i, /wireframe/i, /UX/i, /UI设计/i, /产品规划/i
  ],
  growth: [
    /增长/i, /营销/i, /SEO/i, /运营/i, /推广/i, /用户增长/i, /转化/i, /内容/i,
    /获客/i, /留存/i, /投放/i, /渠道/i, /裂变/i, /活动策划/i
  ],
  finance: [
    /财务/i, /预算/i, /成本/i, /收入/i, /报表/i, /账单/i, /资金/i, /利润/i,
    /ROI/i, /财报/i, /开支/i, /发票/i
  ],
  research: [
    /调研/i, /分析/i, /研究/i, /市场调查/i, /竞品/i, /数据分析/i, /报告/i,
    /洞察/i, /benchmark/i, /对比分析/i, /用户访谈/i, /问卷/i
  ],
  knowledge: [
    /知识库/i, /知识管理/i, /笔记/i, /知识/i, /wiki/i,
    /README/i, /CHANGELOG/i, /归档/i, /手册/i
  ],
  operations: [
    /运维/i, /部署/i, /监控/i, /日志/i, /告警/i, /DevOps/i, /基础设施/i,
    /docker/i, /kubernetes/i, /k8s/i, /nginx/i, /服务器/i, /on-call/i,
    /incident/i, /SLA/i, /uptime/i
  ],
  security: [
    /安全/i, /漏洞/i, /权限/i, /认证/i, /加密/i, /渗透/i, /CVE/i,
    /injection/i, /XSS/i, /CSRF/i, /鉴权/i, /OAuth/i, /密钥/i, /secret/i
  ],
  quality: [
    /质量/i, /QA/i, /测试覆盖/i, /回归/i, /稳定性/i, /CI稳定性/i, /flaky/i,
    /coverage/i, /regression/i, /smoke test/i, /e2e/i, /质检/i, /可靠性/i
  ],
  agent_ops: [
    /Agent/i, /LLM/i, /调度/i, /任务派发/i, /Cecelia/i, /Brain/i, /自动化/i,
    /workflow/i, /orchestrat/i, /prompt/i, /thalamus/i,
    /cortex/i, /tick/i, /executor/i, /planner/i, /dispatcher/i,
    /N8N/i, /n8n/i, /pipeline/i
  ],
};

/**
 * Priority order (higher index = higher priority when multiple domains match)
 * agent_ops > quality > security > coding (default)
 */
const DOMAIN_PRIORITY = [
  'coding',
  'product',
  'growth',
  'finance',
  'research',
  'knowledge',
  'operations',
  'security',
  'quality',
  'agent_ops',
];

/**
 * Domain → owner_role mapping (pure lookup, no LLM)
 */
export const DOMAIN_TO_OWNER_ROLE = {
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

/**
 * Detect domain from text (title + description)
 *
 * Matching priority: agent_ops > quality > security > coding (default)
 *
 * @param {string} text - Combined title and description text
 * @returns {string} - Domain name (defaults to 'coding')
 */
export function detectDomain(text) {
  if (!text || typeof text !== 'string') return 'coding';

  let bestDomain = 'coding';
  let bestPriority = DOMAIN_PRIORITY.indexOf('coding');

  for (const [domain, patterns] of Object.entries(DOMAIN_KEYWORDS)) {
    const matches = patterns.some(pattern => pattern.test(text));
    if (matches) {
      const priority = DOMAIN_PRIORITY.indexOf(domain);
      if (priority > bestPriority) {
        bestPriority = priority;
        bestDomain = domain;
      }
    }
  }

  return bestDomain;
}

/**
 * Get owner_role for a given domain
 *
 * @param {string} domain - Domain name
 * @returns {string} - owner_role (defaults to 'cto' for unknown domains)
 */
export function getDomainOwnerRole(domain) {
  return DOMAIN_TO_OWNER_ROLE[domain] || 'cto';
}
