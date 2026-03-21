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
    id: 'MiniMax-M2',
    name: 'M2 (Coding Plan)',
    provider: 'minimax',
    tier: 'premium',
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
    id: 'claude-sonnet-4-6',
    name: 'Sonnet 4.6',
    provider: 'anthropic',
    tier: 'standard',
  },
  {
    id: 'claude-opus-4-6',
    name: 'Opus 4.6',
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
    allowed_models: ['MiniMax-M2.5-highspeed', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
    recommended_model: 'MiniMax-M2.5-highspeed',
    fixed_provider: null,
  },
  {
    id: 'cortex',
    name: 'L2 皮层',
    description: '深度分析、RCA、战略调整',
    layer: 'brain',
    allowed_models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.5'],
    recommended_model: 'claude-opus-4-6',
    fixed_provider: null,
  },
  {
    id: 'reflection',
    name: 'L3 反思层',
    description: '定期深度反思、生成洞察',
    layer: 'brain',
    allowed_models: ['claude-opus-4-6', 'claude-sonnet-4-6'],
    recommended_model: 'claude-opus-4-6',
    fixed_provider: null,
  },
  {
    id: 'mouth',
    name: '嘴巴',
    description: '对话生成、对外接口',
    layer: 'brain',
    allowed_models: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    recommended_model: 'claude-sonnet-4-6',
    fixed_provider: null,
  },
  {
    id: 'memory',
    name: '记忆打分',
    description: '为感知观察打重要性分（批量）',
    layer: 'brain',
    allowed_models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.5'],
    recommended_model: 'claude-haiku-4-5-20251001',
    fixed_provider: null,
  },
  {
    id: 'rumination',
    name: '反刍消化',
    description: '深度思考：模式发现、跨知识关联、可执行洞察（主路径：NotebookLM；LLM 为 NotebookLM 不可用时的 fallback）',
    layer: 'brain',
    allowed_models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    recommended_model: 'claude-opus-4-6',
    fixed_provider: null,
  },
  {
    id: 'narrative',
    name: '叙事合成',
    description: '生成每周进化叙事（进化日志摘要）',
    layer: 'brain',
    allowed_models: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'MiniMax-M2.5-highspeed'],
    recommended_model: 'claude-sonnet-4-6',
    fixed_provider: null,
  },
  {
    id: 'fact_extractor',
    name: '事实提取',
    description: '从对话和事件中提取结构化事实（混合正则+LLM）',
    layer: 'brain',
    allowed_models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'MiniMax-M2.5-highspeed'],
    recommended_model: 'claude-haiku-4-5-20251001',
    fixed_provider: null,
  },
  // ---- 执行层 ----
  {
    id: 'dev',
    name: '开发 Caramel',
    description: '编程专家',
    layer: 'executor',
    allowed_models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.5'],
    recommended_model: 'claude-sonnet-4-6',
    fixed_provider: null,
  },
  {
    id: 'qa',
    name: 'QA 小检',
    description: 'QA 总控',
    layer: 'executor',
    allowed_models: ['claude-sonnet-4-6', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.5', 'codex-mini-latest', 'o3-mini', 'o4-mini'],
    recommended_model: 'claude-sonnet-4-6',
    fixed_provider: null,
  },
  {
    id: 'decomp_review',
    name: '拆解审查 Vivian',
    description: 'OKR 拆解审查',
    layer: 'executor',
    allowed_models: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    recommended_model: 'claude-sonnet-4-6',
    fixed_provider: null,
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
  {
    id: 'codex_playwright',
    name: 'Codex Playwright',
    description: 'Playwright 自动化脚本探索与执行（西安 M4 CDP 控制 PC）',
    layer: 'executor',
    allowed_models: ['codex-mini-latest', 'o3-mini', 'o4-mini'],
    recommended_model: 'codex-mini-latest',
    fixed_provider: 'openai',
  },
  {
    id: 'codex_test_gen',
    name: 'Codex 测试生成',
    description: '自动扫描低覆盖率模块并生成单元测试（西安 Mac mini Codex CLI prompt 模式）',
    layer: 'executor',
    allowed_models: ['codex-mini-latest', 'o3-mini', 'o4-mini'],
    recommended_model: 'codex-mini-latest',
    fixed_provider: 'openai',
  },
  {
    id: 'architect',
    name: '架构师 Architect',
    description: 'Initiative 级架构设计 + 系统说明书生成',
    layer: 'executor',
    allowed_models: ['claude-opus-4-6', 'claude-sonnet-4-6'],
    recommended_model: 'claude-opus-4-6',
    fixed_provider: null,
  },
  {
    id: 'strategy_session',
    name: '战略会议',
    description: 'C-Suite 模拟讨论，输出带 domain 的 KR',
    layer: 'executor',
    allowed_models: ['claude-opus-4-6', 'claude-sonnet-4-6'],
    recommended_model: 'claude-opus-4-6',
    fixed_provider: null,
  },
  {
    id: 'intent_expand',
    name: '意图扩展 Expander',
    description: '沿 project→KR→OKR→Vision 链路补全 PRD，消除意图损耗（US 本机执行，读本地 Brain DB）',
    layer: 'executor',
    allowed_models: ['claude-sonnet-4-6', 'claude-opus-4-6'],
    recommended_model: 'claude-sonnet-4-6',
    fixed_provider: null,
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
