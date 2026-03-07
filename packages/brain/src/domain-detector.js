/**
 * domain-detector.js
 *
 * 根据文本内容检测 domain，并返回对应的 owner_role。
 * 实现 /plan SKILL.md Stage 0.5 的关键词 → domain 映射规格。
 *
 * 优先级（多匹配时选更具体的）：
 *   agent_ops > quality > security > coding > product > growth
 *   > finance > research > operations > knowledge
 */

import { getDomainRole } from './role-registry.js';

// ============================================================
// 关键词映射表（按 domain 分组）
// ============================================================

const KEYWORD_MAP = {
  knowledge: [
    '知识', '文档', '笔记', '整理', '总结', '知识库',
    'knowledge', 'doc', 'note', 'wiki', 'readme',
  ],
  operations: [
    '运维', '部署', '监控', '日志', '告警', 'devops', '基础设施',
    'deploy', 'monitor', 'infra', 'ops', 'kubernetes', 'docker', 'nginx',
  ],
  research: [
    '调研', '分析', '研究', '市场调查', '竞品', '数据分析',
    'research', 'analysis', 'survey', 'report',
  ],
  finance: [
    '财务', '预算', '成本', '收入', '报表', '账单',
    'budget', 'revenue', 'cost', 'finance', 'billing',
  ],
  growth: [
    '增长', '营销', 'seo', '运营', '推广', '用户增长', '转化', '内容',
    'marketing', 'growth', 'content', 'acquisition', 'conversion',
  ],
  product: [
    '产品', '需求', 'prd', '用户体验', '功能设计', '交互', '流程设计',
    'ux', 'design', 'user story',
  ],
  coding: [
    '代码', '开发', 'bug', 'ci', '工程', '架构', 'api', '重构', '依赖',
    'code', 'fix', 'feat', 'refactor', 'implement',
    'build', 'lint', 'compile', 'module', 'library',
  ],
  security: [
    '安全', '漏洞', '权限', '认证', '加密', '合规',
    'auth', 'security', 'vulnerability', 'permission', 'encrypt',
    'token', 'secret', 'ssl', 'tls', 'cve',
  ],
  quality: [
    '质量', 'qa', '测试覆盖', '回归', '稳定性',
    'test', 'vitest', 'jest', 'coverage', 'regression', 'e2e',
    'smoke', 'contract', 'assertion',
  ],
  agent_ops: [
    'agent', 'llm', '调度', '任务派发', 'cecelia', 'brain', '自动化',
    'dispatch', 'executor', 'tick', 'planner', 'thalamus', 'cortex',
    'decomp', '秋米', 'okr', 'initiative', 'orchestrat',
  ],
};

// 优先级顺序（越靠后优先级越高，多匹配时后面的胜出）
const PRIORITY_ORDER = [
  'knowledge',
  'operations',
  'research',
  'finance',
  'growth',
  'product',
  'coding',
  'security',
  'quality',
  'agent_ops',
];

// ============================================================
// 主函数
// ============================================================

/**
 * 检测文本所属 domain，返回 domain、owner_role 和置信度。
 *
 * @param {string|null} text - 用户输入文本（title + description）
 * @returns {{ domain: string, owner_role: string, confidence: number }}
 */
export function detectDomain(text) {
  if (!text || typeof text !== 'string' || text.trim() === '') {
    return { domain: 'coding', owner_role: getDomainRole('coding'), confidence: 0 };
  }

  const lower = text.toLowerCase();

  // 计算每个 domain 的命中关键词数量
  const hits = {};
  for (const [domain, keywords] of Object.entries(KEYWORD_MAP)) {
    const count = keywords.filter(kw => lower.includes(kw.toLowerCase())).length;
    if (count > 0) {
      hits[domain] = count;
    }
  }

  // 无匹配 → 默认 coding
  if (Object.keys(hits).length === 0) {
    return { domain: 'coding', owner_role: getDomainRole('coding'), confidence: 0 };
  }

  // 按优先级从低到高迭代，最后匹配到的 domain 优先级最高
  let best = null;
  for (const domain of PRIORITY_ORDER) {
    if (hits[domain] !== undefined) {
      best = domain;
    }
  }

  const domain = best;
  const owner_role = getDomainRole(domain);
  const confidence = Math.min(1, hits[domain] / 5);

  return { domain, owner_role, confidence };
}
