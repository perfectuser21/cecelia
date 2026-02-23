/**
 * 模型注册表 + Agent 定义
 *
 * 静态数据：可用模型列表、Agent 白名单、Provider 约束
 */

/* global console */

// ============================================================
// 模型注册表
// ============================================================

export const MODELS = [
  {
    id: 'MiniMax-M2.1',
    name: 'M2.1',
    provider: 'minimax',
    tier: 'fast',
  },
  {
    id: 'MiniMax-M2.1-highspeed',
    name: 'M2.1 Fast',
    provider: 'minimax',
    tier: 'fast',
  },
  {
    id: 'MiniMax-M2.5',
    name: 'M2.5',
    provider: 'minimax',
    tier: 'standard',
  },
  {
    id: 'MiniMax-M2.5-highspeed',
    name: 'M2.5 Fast',
    provider: 'minimax',
    tier: 'standard',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Haiku',
    provider: 'anthropic',
    tier: 'fast',
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Sonnet',
    provider: 'anthropic',
    tier: 'standard',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Opus',
    provider: 'anthropic',
    tier: 'premium',
  },
  {
    id: 'codex-mini-latest',
    name: 'Codex Mini',
    provider: 'openai',
    tier: 'fast',
  },
  {
    id: 'o3-mini',
    name: 'o3 Mini',
    provider: 'openai',
    tier: 'fast',
  },
  {
    id: 'o4-mini',
    name: 'o4 Mini',
    provider: 'openai',
    tier: 'fast',
  },
];

// ============================================================
// Agent 定义表
// ============================================================

export const AGENTS = [
  // ---- 大脑层 ----
  {
    id: 'thalamus',
    name: 'L1 丘脑',
    description: '事件路由、快速判断',
    layer: 'brain',
    allowed_models: ['MiniMax-M2.1', 'MiniMax-M2.1-highspeed', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-20250514'],
    recommended_model: 'MiniMax-M2.1',
    fixed_provider: null,
  },
  {
    id: 'cortex',
    name: 'L2 皮层',
    description: '深度分析、RCA、战略调整',
    layer: 'brain',
    allowed_models: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.5'],
    recommended_model: 'claude-opus-4-20250514',
    fixed_provider: null,
  },
  // ---- 执行层 ----
  {
    id: 'dev',
    name: '开发 Caramel',
    description: '编程专家',
    layer: 'executor',
    allowed_models: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.5'],
    recommended_model: 'claude-opus-4-20250514',
    fixed_provider: null,
  },
  {
    id: 'qa',
    name: 'QA 小检',
    description: 'QA 总控',
    layer: 'executor',
    allowed_models: ['claude-sonnet-4-20250514', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.5', 'codex-mini-latest', 'o3-mini', 'o4-mini'],
    recommended_model: 'claude-sonnet-4-20250514',
    fixed_provider: null,
  },
  {
    id: 'review',
    name: '审查',
    description: '代码审查',
    layer: 'executor',
    allowed_models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.5'],
    recommended_model: 'claude-sonnet-4-20250514',
    fixed_provider: null,
  },
  {
    id: 'audit',
    name: '审计 小审',
    description: '代码审计',
    layer: 'executor',
    allowed_models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.5'],
    recommended_model: 'claude-sonnet-4-20250514',
    fixed_provider: null,
  },
  {
    id: 'talk',
    name: '对话',
    description: '日常对话',
    layer: 'executor',
    allowed_models: ['MiniMax-M2.5-highspeed', 'MiniMax-M2.5'],
    recommended_model: 'MiniMax-M2.5-highspeed',
    fixed_provider: 'minimax',
  },
  {
    id: 'research',
    name: '研究',
    description: '调研分析',
    layer: 'executor',
    allowed_models: ['MiniMax-M2.5-highspeed', 'MiniMax-M2.5'],
    recommended_model: 'MiniMax-M2.5-highspeed',
    fixed_provider: 'minimax',
  },
  {
    id: 'exploratory',
    name: '探索',
    description: '探索性任务',
    layer: 'executor',
    allowed_models: ['MiniMax-M2.1', 'MiniMax-M2.1-highspeed'],
    recommended_model: 'MiniMax-M2.1',
    fixed_provider: 'minimax',
  },
  {
    id: 'decomp_review',
    name: '拆解审查 Vivian',
    description: 'OKR 拆解审查',
    layer: 'executor',
    allowed_models: ['MiniMax-M2.5-highspeed', 'MiniMax-M2.5'],
    recommended_model: 'MiniMax-M2.5-highspeed',
    fixed_provider: 'minimax',
  },
  {
    id: 'codex_qa',
    name: 'Codex QA',
    description: 'Codex 自动 QA',
    layer: 'executor',
    allowed_models: ['codex-mini-latest', 'o3-mini', 'o4-mini'],
    recommended_model: 'codex-mini-latest',
    fixed_provider: 'openai',
  },
];

// ============================================================
// 辅助函数
// ============================================================

export function getModelById(modelId) {
  return MODELS.find(m => m.id === modelId) || null;
}

export function getAgentById(agentId) {
  return AGENTS.find(a => a.id === agentId) || null;
}

export function isModelAllowedForAgent(agentId, modelId) {
  const agent = getAgentById(agentId);
  if (!agent) return false;
  return agent.allowed_models.includes(modelId);
}

export function getProviderForModel(modelId) {
  const model = getModelById(modelId);
  return model ? model.provider : null;
}
