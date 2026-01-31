/* global console */
/**
 * Intent Recognition Module (KR1)
 *
 * Parses natural language input and converts it to structured:
 * - OKR (Objective and Key Results)
 * - Projects
 * - Tasks
 * - PRD drafts
 * - TRD drafts
 */

import pool from '../task-system/db.js';
import { renderPrd, renderTrd } from './templates.js';

/**
 * Intent types that can be recognized
 */
const INTENT_TYPES = {
  CREATE_PROJECT: 'create_project',      // "我想做一个 GMV Dashboard"
  CREATE_FEATURE: 'create_feature',      // "给登录页面加一个忘记密码功能"
  CREATE_GOAL: 'create_goal',            // "创建一个 P0 目标：提升系统稳定性"
  CREATE_TASK: 'create_task',            // "添加一个任务：修复登录超时"
  QUERY_STATUS: 'query_status',          // "当前有哪些任务？"
  FIX_BUG: 'fix_bug',                    // "修复购物车页面的价格显示问题"
  REFACTOR: 'refactor',                  // "重构用户模块的代码结构"
  EXPLORE: 'explore',                    // "帮我看看这个 API 怎么用"
  QUESTION: 'question',                  // "为什么这里会报错？"
  UNKNOWN: 'unknown'
};

/**
 * Keywords for intent classification
 */
const INTENT_KEYWORDS = {
  [INTENT_TYPES.CREATE_PROJECT]: [
    '做一个', '创建', '开发', '搭建', '新建', '构建', '实现',
    'create', 'build', 'develop', 'make'
  ],
  [INTENT_TYPES.CREATE_GOAL]: [
    '目标', '愿景', 'OKR', 'objective', 'goal',
    '设定目标', '创建目标', 'set goal', 'create goal'
  ],
  [INTENT_TYPES.CREATE_TASK]: [
    '任务', 'task', '待办', 'todo',
    '添加任务', '创建任务', 'create task', 'add task'
  ],
  [INTENT_TYPES.QUERY_STATUS]: [
    '状态', '进度', '有哪些', '查看', '列出', '多少',
    'status', 'progress', 'list', 'show', 'how many'
  ],
  [INTENT_TYPES.CREATE_FEATURE]: [
    '添加', '加一个', '新增', '增加', '支持', '功能',
    'add', 'feature', 'support', 'implement'
  ],
  [INTENT_TYPES.FIX_BUG]: [
    '修复', '修改', '解决', '问题', 'bug', '错误', '异常',
    'fix', 'resolve', 'error', 'issue'
  ],
  [INTENT_TYPES.REFACTOR]: [
    '重构', '优化', '改进', '整理', '清理',
    'refactor', 'optimize', 'improve', 'cleanup'
  ],
  [INTENT_TYPES.EXPLORE]: [
    '看看', '了解', '分析', '调研', '学习',
    'explore', 'analyze', 'investigate', 'learn'
  ],
  [INTENT_TYPES.QUESTION]: [
    '为什么', '怎么', '如何', '什么', '?', '？',
    'why', 'how', 'what', 'which'
  ]
};

/**
 * Phrase patterns for more accurate intent classification
 * Each pattern has a weight that adds to the confidence score
 */
const INTENT_PHRASES = {
  [INTENT_TYPES.CREATE_PROJECT]: [
    { pattern: /我想做一个(.+)/, weight: 0.3 },
    { pattern: /帮我创建一个(.+)/, weight: 0.3 },
    { pattern: /开发一个(.+)系统/, weight: 0.3 },
    { pattern: /搭建(.+)平台/, weight: 0.3 },
    { pattern: /build\s+a\s+(.+)/i, weight: 0.3 },
    { pattern: /create\s+(.+)\s+project/i, weight: 0.3 },
    { pattern: /需要一个(.+)/, weight: 0.25 },
    { pattern: /启动(.+)项目/, weight: 0.3 },
    { pattern: /set\s+up\s+(.+)/i, weight: 0.3 }
  ],
  [INTENT_TYPES.CREATE_FEATURE]: [
    { pattern: /给(.+)加一个(.+)功能/, weight: 0.4 },
    { pattern: /给(.+)添加(.+)/, weight: 0.3 },
    { pattern: /在(.+)中增加(.+)/, weight: 0.3 },
    { pattern: /为(.+)实现(.+)/, weight: 0.3 },
    { pattern: /add\s+(.+)\s+to\s+(.+)/i, weight: 0.3 },
    { pattern: /implement\s+(.+)\s+feature/i, weight: 0.3 },
    { pattern: /(.+)需要支持(.+)/, weight: 0.3 },
    { pattern: /能不能(.+)加上(.+)/, weight: 0.3 }
  ],
  [INTENT_TYPES.FIX_BUG]: [
    { pattern: /修复(.+)的(.+)问题/, weight: 0.4 },
    { pattern: /解决(.+)bug/, weight: 0.4 },
    { pattern: /(.+)报错/, weight: 0.3 },
    { pattern: /(.+)不工作/, weight: 0.3 },
    { pattern: /fix\s+(.+)\s+bug/i, weight: 0.4 },
    { pattern: /resolve\s+(.+)\s+issue/i, weight: 0.3 },
    { pattern: /(.+)有问题/, weight: 0.25 },
    { pattern: /(.+)出错了/, weight: 0.3 }
  ],
  [INTENT_TYPES.REFACTOR]: [
    { pattern: /重构(.+)代码/, weight: 0.4 },
    { pattern: /优化(.+)性能/, weight: 0.4 },
    { pattern: /改进(.+)结构/, weight: 0.3 },
    { pattern: /refactor\s+(.+)/i, weight: 0.4 },
    { pattern: /optimize\s+(.+)/i, weight: 0.3 }
  ],
  [INTENT_TYPES.EXPLORE]: [
    { pattern: /帮我看看(.+)/, weight: 0.3 },
    { pattern: /了解一下(.+)/, weight: 0.3 },
    { pattern: /分析(.+)怎么/, weight: 0.3 },
    { pattern: /investigate\s+(.+)/i, weight: 0.3 },
    { pattern: /analyze\s+(.+)/i, weight: 0.3 }
  ],
  [INTENT_TYPES.CREATE_GOAL]: [
    { pattern: /创建(.+)目标/, weight: 0.4 },
    { pattern: /设定(.+)目标/, weight: 0.4 },
    { pattern: /新建(.+)OKR/i, weight: 0.4 },
    { pattern: /目标[：:]\s*(.+)/, weight: 0.3 },
    { pattern: /create\s+(.+)\s+goal/i, weight: 0.4 },
    { pattern: /set\s+(.+)\s+objective/i, weight: 0.4 }
  ],
  [INTENT_TYPES.CREATE_TASK]: [
    { pattern: /添加(.+)任务/, weight: 0.4 },
    { pattern: /创建(.+)任务/, weight: 0.4 },
    { pattern: /新建(.+)待办/, weight: 0.4 },
    { pattern: /任务[：:]\s*(.+)/, weight: 0.3 },
    { pattern: /create\s+(.+)\s+task/i, weight: 0.4 },
    { pattern: /add\s+task[：:]\s*(.+)/i, weight: 0.4 }
  ],
  [INTENT_TYPES.QUERY_STATUS]: [
    { pattern: /当前有哪些(.+)/, weight: 0.4 },
    { pattern: /查看(.+)状态/, weight: 0.4 },
    { pattern: /(.+)进度如何/, weight: 0.4 },
    { pattern: /列出所有(.+)/, weight: 0.3 },
    { pattern: /show\s+(.+)\s+status/i, weight: 0.4 },
    { pattern: /list\s+all\s+(.+)/i, weight: 0.3 }
  ],
  [INTENT_TYPES.QUESTION]: [
    { pattern: /为什么(.+)[?？]/, weight: 0.4 },
    { pattern: /怎么(.+)[?？]/, weight: 0.4 },
    { pattern: /如何(.+)[?？]/, weight: 0.4 },
    { pattern: /(.+)是什么/, weight: 0.3 },
    { pattern: /why\s+(.+)\?/i, weight: 0.4 },
    { pattern: /how\s+(.+)\?/i, weight: 0.4 }
  ]
};

/**
 * Intent to Brain Action mapping
 * Maps each intent type to the corresponding brain action
 */
const INTENT_ACTION_MAP = {
  [INTENT_TYPES.CREATE_GOAL]: { action: 'create-goal', requiredParams: ['title'] },
  [INTENT_TYPES.CREATE_PROJECT]: { action: null, handler: 'parseAndCreate' },
  [INTENT_TYPES.CREATE_FEATURE]: { action: null, handler: 'parseAndCreate' },
  [INTENT_TYPES.CREATE_TASK]: { action: 'create-task', requiredParams: ['title'] },
  [INTENT_TYPES.FIX_BUG]: { action: 'create-task', requiredParams: ['title'] },
  [INTENT_TYPES.REFACTOR]: { action: 'create-task', requiredParams: ['title'] },
  [INTENT_TYPES.QUERY_STATUS]: { action: null, handler: 'queryStatus' },
  [INTENT_TYPES.EXPLORE]: { action: null, handler: 'parseAndCreate' },
  [INTENT_TYPES.QUESTION]: { action: null, handler: null },
  [INTENT_TYPES.UNKNOWN]: { action: null, handler: null }
};

/**
 * Entity extraction patterns
 * Extract specific entities from the input text
 */
const ENTITY_PATTERNS = {
  // Project/Module name patterns
  module: [
    /(.+)模块/,
    /(.+)系统/,
    /(.+)平台/,
    /(.+)服务/,
    /(\w+)\s+module/i,
    /(\w+)\s+service/i
  ],
  // Feature name patterns
  feature: [
    /(.+)功能/,
    /(.+)特性/,
    /(\w+)\s+feature/i,
    /(\w+)\s+capability/i
  ],
  // File path patterns
  filePath: [
    new RegExp('(src/[\\w/.-]+)'),
    new RegExp('(apps/[\\w/.-]+)'),
    /([\w-]+\.(js|ts|tsx|jsx|py|go|rs))/
  ],
  // API endpoint patterns
  apiEndpoint: [
    new RegExp('/api/[\\w/-]+'),
    new RegExp('POST\\s+(/[\\w/-]+)', 'i'),
    new RegExp('GET\\s+(/[\\w/-]+)', 'i')
  ],
  // Component name patterns
  component: [
    /([A-Z][a-zA-Z]+)(组件|Component)/,
    /<([A-Z][a-zA-Z]+)/
  ],
  // Priority patterns
  priority: [
    /(P0|P1|P2)/,
    /(高优先级|高优|紧急)/,
    /(中优先级|中优|普通)/,
    /(低优先级|低优)/,
    /(high\s+priority|urgent|critical)/i,
    /(medium\s+priority|normal)/i,
    /(low\s+priority)/i
  ],
  // Timeframe patterns
  timeframe: [
    /(今天|today)/i,
    /(明天|tomorrow)/i,
    /(本周|this\s+week)/i,
    /(下周|next\s+week)/i,
    /(本月|this\s+month)/i,
    /(尽快|ASAP)/i
  ],
  // Dependency patterns
  dependency: [
    /依赖(.+)/,
    /前置[：:]?\s*(.+)/,
    /阻塞于(.+)/,
    /blocked\s+by\s+(.+)/i,
    /depends\s+on\s+(.+)/i,
    /after\s+(.+)/i
  ]
};

/**
 * Classify intent from natural language input
 * Enhanced with phrase pattern matching for better accuracy
 * @param {string} input - Natural language input
 * @returns {{ type: string, confidence: number, keywords: string[], matchedPhrases: string[] }}
 */
function classifyIntent(input) {
  const inputLower = input.toLowerCase();
  const matchedKeywords = {};
  const matchedPhrases = {};

  // Step 1: Keyword matching
  for (const [intentType, keywords] of Object.entries(INTENT_KEYWORDS)) {
    const matches = keywords.filter(kw => inputLower.includes(kw.toLowerCase()));
    if (matches.length > 0) {
      matchedKeywords[intentType] = matches;
    }
  }

  // Step 2: Phrase pattern matching (adds confidence weight)
  for (const [intentType, phrases] of Object.entries(INTENT_PHRASES)) {
    for (const { pattern, weight } of phrases) {
      const match = input.match(pattern);
      if (match) {
        if (!matchedPhrases[intentType]) {
          matchedPhrases[intentType] = { patterns: [], totalWeight: 0 };
        }
        matchedPhrases[intentType].patterns.push(pattern.source);
        matchedPhrases[intentType].totalWeight += weight;
      }
    }
  }

  // Step 3: Calculate combined score
  let bestIntent = INTENT_TYPES.UNKNOWN;
  let bestScore = 0;
  let bestKeywords = [];
  let bestPhrasePatterns = [];

  // Combine keyword and phrase scores
  const allIntentTypes = new Set([
    ...Object.keys(matchedKeywords),
    ...Object.keys(matchedPhrases)
  ]);

  for (const intentType of allIntentTypes) {
    const keywordScore = matchedKeywords[intentType]?.length || 0;
    const phraseData = matchedPhrases[intentType] || { patterns: [], totalWeight: 0 };

    // Combined score: keyword matches (normalized) + phrase weight bonus
    const combinedScore = (keywordScore / 3) + phraseData.totalWeight;

    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestIntent = intentType;
      bestKeywords = matchedKeywords[intentType] || [];
      bestPhrasePatterns = phraseData.patterns;
    }
  }

  // Calculate confidence (0-1), capped at 1.0
  const confidence = Math.min(bestScore, 1);

  // Categorize confidence into high/medium/low
  const confidenceLevel = confidence >= 0.7 ? 'high' : confidence >= 0.4 ? 'medium' : 'low';

  return {
    type: bestIntent,
    confidence,
    confidenceLevel,
    keywords: bestKeywords,
    matchedPhrases: bestPhrasePatterns
  };
}

/**
 * Extract entities from natural language input
 * @param {string} input - Natural language input
 * @returns {Object} - Extracted entities
 */
// Map Chinese priority keywords to standard values
const PRIORITY_MAP = {
  'P0': 'P0', 'P1': 'P1', 'P2': 'P2',
  '高优先级': 'P0', '高优': 'P0', '紧急': 'P0',
  '中优先级': 'P1', '中优': 'P1', '普通': 'P1',
  '低优先级': 'P2', '低优': 'P2'
};

// Map English priority keywords to standard values
const PRIORITY_MAP_EN = {
  'high priority': 'P0', 'urgent': 'P0', 'critical': 'P0',
  'medium priority': 'P1', 'normal': 'P1',
  'low priority': 'P2'
};

function extractEntities(input) {
  const entities = {
    module: null,
    feature: null,
    filePath: null,
    apiEndpoint: null,
    component: null,
    priority: null,
    timeframe: null,
    dependency: null
  };

  for (const [entityType, patterns] of Object.entries(ENTITY_PATTERNS)) {
    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match && match[1]) {
        // Clean up the extracted value
        let value = match[1].trim();

        // For module/feature, remove common suffixes that are part of the pattern
        if (entityType === 'module') {
          value = value.replace(/(模块|系统|平台|服务)$/, '').trim();
        }
        if (entityType === 'feature') {
          value = value.replace(/(功能|特性)$/, '').trim();
        }
        // Normalize priority to P0/P1/P2
        if (entityType === 'priority') {
          value = PRIORITY_MAP[value] || PRIORITY_MAP_EN[value.toLowerCase()] || value;
        }

        if (value && !entities[entityType]) {
          entities[entityType] = value;
        }
      }
    }
  }

  // Remove null values
  return Object.fromEntries(
    Object.entries(entities).filter(([, v]) => v !== null)
  );
}

/**
 * Extract project name from input
 * @param {string} input - Natural language input
 * @param {string} intentType - Classified intent type
 * @returns {string} - Extracted project name
 */
function extractProjectName(input, _intentType) {
  // Remove common phrases to get the core topic
  const cleanedInput = input
    .replace(/我想/g, '')
    .replace(/做一个/g, '')
    .replace(/创建/g, '')
    .replace(/开发/g, '')
    .replace(/搭建/g, '')
    .replace(/新建/g, '')
    .replace(/构建/g, '')
    .replace(/实现/g, '')
    .replace(/帮我/g, '')
    .replace(/请/g, '')
    .trim();

  // Convert to kebab-case for project name
  const projectName = cleanedInput
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '')
    .toLowerCase();

  return projectName || 'untitled-project';
}

/**
 * Generate tasks for a project based on intent
 * Enhanced with entity-aware task generation
 * @param {string} projectName - Project name
 * @param {string} intentType - Intent type
 * @param {string} input - Original input
 * @param {Object} entities - Extracted entities
 * @returns {Array<{title: string, description: string, priority: string}>}
 */
function generateTasks(projectName, intentType, _input, entities = {}) {
  const tasks = [];
  const featureName = entities.feature || projectName;
  const moduleName = entities.module || projectName;

  if (intentType === INTENT_TYPES.CREATE_GOAL) {
    const goalTitle = entities.module || projectName;
    const priority = entities.priority || 'P1';
    tasks.push(
      {
        title: `定义 ${goalTitle} 目标的 Key Results`,
        description: `为目标 "${goalTitle}" 定义可衡量的关键结果`,
        priority
      },
      {
        title: `拆解 ${goalTitle} 目标的执行任务`,
        description: `将 Key Results 拆解为可执行的具体任务`,
        priority
      }
    );
  } else if (intentType === INTENT_TYPES.CREATE_TASK) {
    const taskTitle = entities.feature || entities.module || projectName;
    const priority = entities.priority || 'P1';
    tasks.push(
      {
        title: taskTitle,
        description: `从意图识别自动创建的任务`,
        priority
      }
    );
  } else if (intentType === INTENT_TYPES.QUERY_STATUS) {
    // No tasks to generate for query intents
  } else if (intentType === INTENT_TYPES.CREATE_PROJECT) {
    // Full project creation tasks
    tasks.push(
      {
        title: `设计 ${projectName} 架构`,
        description: `分析需求，设计系统架构和数据模型`,
        priority: 'P0'
      },
      {
        title: `实现 ${projectName} 后端 API`,
        description: `开发后端接口和业务逻辑`,
        priority: 'P0'
      },
      {
        title: `实现 ${projectName} 前端界面`,
        description: `开发前端 UI 组件和交互逻辑`,
        priority: 'P1'
      },
      {
        title: `编写 ${projectName} 测试`,
        description: `编写单元测试和集成测试`,
        priority: 'P1'
      },
      {
        title: `部署 ${projectName}`,
        description: `配置 CI/CD 并部署到生产环境`,
        priority: 'P2'
      }
    );
  } else if (intentType === INTENT_TYPES.CREATE_FEATURE) {
    // Feature-specific tasks (more targeted)
    tasks.push(
      {
        title: `设计 ${featureName} 接口`,
        description: `在 ${moduleName} 中设计 ${featureName} 的 API 接口`,
        priority: 'P0'
      },
      {
        title: `实现 ${featureName} 后端逻辑`,
        description: `开发 ${featureName} 的后端业务逻辑`,
        priority: 'P0'
      },
      {
        title: `实现 ${featureName} 前端组件`,
        description: `在 ${moduleName} 中添加 ${featureName} 的 UI 组件`,
        priority: 'P1'
      },
      {
        title: `编写 ${featureName} 测试`,
        description: `为 ${featureName} 编写单元测试`,
        priority: 'P1'
      }
    );
  } else if (intentType === INTENT_TYPES.FIX_BUG) {
    const target = entities.component || entities.module || '目标模块';
    tasks.push(
      {
        title: `分析 ${target} 问题根因`,
        description: `定位 bug 原因，分析影响范围`,
        priority: 'P0'
      },
      {
        title: `修复 ${target} 问题`,
        description: `实现修复方案`,
        priority: 'P0'
      },
      {
        title: `添加回归测试`,
        description: `编写测试确保问题不再复现`,
        priority: 'P1'
      }
    );
  } else if (intentType === INTENT_TYPES.REFACTOR) {
    const target = entities.module || entities.component || projectName;
    tasks.push(
      {
        title: `分析 ${target} 现有代码结构`,
        description: `梳理现有实现，识别优化点`,
        priority: 'P1'
      },
      {
        title: `设计 ${target} 重构方案`,
        description: `制定重构计划，确保向后兼容`,
        priority: 'P1'
      },
      {
        title: `实施 ${target} 重构`,
        description: `按计划重构代码`,
        priority: 'P1'
      },
      {
        title: `验证 ${target} 重构结果`,
        description: `运行测试，确保功能正常`,
        priority: 'P1'
      }
    );
  } else if (intentType === INTENT_TYPES.EXPLORE) {
    const target = entities.module || entities.apiEndpoint || projectName;
    tasks.push(
      {
        title: `调研 ${target}`,
        description: `了解 ${target} 的功能和用法`,
        priority: 'P1'
      },
      {
        title: `整理 ${target} 文档`,
        description: `记录调研结果和使用示例`,
        priority: 'P2'
      }
    );
  } else {
    // Default tasks for unknown intent
    tasks.push(
      {
        title: `分析需求`,
        description: `理解需求背景和目标`,
        priority: 'P1'
      },
      {
        title: `制定计划`,
        description: `制定实施计划`,
        priority: 'P1'
      },
      {
        title: `执行任务`,
        description: `按计划执行`,
        priority: 'P1'
      }
    );
  }

  return tasks;
}

/**
 * Generate PRD draft from parsed intent (legacy function)
 * @param {Object} parsedIntent - Parsed intent object
 * @returns {string} - PRD draft in markdown format
 * @deprecated Use generateStandardPrd for new implementations
 */
function generatePrdDraft(parsedIntent) {
  // Use new template system but without frontmatter for backward compatibility
  return renderPrd(parsedIntent, { includeFrontmatter: false });
}

/**
 * Generate standard PRD with frontmatter from parsed intent
 * @param {Object} parsedIntent - Parsed intent object
 * @param {Object} options - Options for PRD generation
 * @param {boolean} options.includeFrontmatter - Include YAML frontmatter (default: true)
 * @param {string} options.version - Document version (default: 1.0.0)
 * @returns {string} - Standard PRD in markdown format
 */
function generateStandardPrd(parsedIntent, options = {}) {
  return renderPrd(parsedIntent, options);
}

/**
 * Generate TRD draft from parsed intent
 * @param {Object} parsedIntent - Parsed intent object
 * @param {Object} options - Options for TRD generation
 * @param {boolean} options.includeFrontmatter - Include YAML frontmatter (default: true)
 * @param {string} options.version - Document version (default: 1.0.0)
 * @returns {string} - TRD in markdown format
 */
function generateTrdDraft(parsedIntent, options = {}) {
  return renderTrd(parsedIntent, options);
}

/**
 * Build action parameters from parsed intent data
 */
function buildActionParams(intentType, input, entities, projectName) {
  if (intentType === INTENT_TYPES.CREATE_GOAL) {
    // Extract goal title from input
    const titleMatch = input.match(/目标[：:]\s*(.+)/) || input.match(/创建(.+)目标/) || input.match(/设定(.+)目标/);
    const title = titleMatch ? titleMatch[1].trim() : projectName;
    return {
      title,
      priority: entities.priority || 'P1',
      ...(entities.timeframe && { target_date: entities.timeframe })
    };
  }
  if (intentType === INTENT_TYPES.CREATE_TASK) {
    const titleMatch = input.match(/任务[：:]\s*(.+)/) || input.match(/添加(.+)任务/) || input.match(/创建(.+)任务/);
    const title = titleMatch ? titleMatch[1].trim() : projectName;
    return {
      title,
      priority: entities.priority || 'P1'
    };
  }
  if (intentType === INTENT_TYPES.FIX_BUG || intentType === INTENT_TYPES.REFACTOR) {
    return {
      title: input.slice(0, 100),
      priority: entities.priority || 'P0'
    };
  }
  return {};
}

/**
 * Get the action mapping for an intent type
 */
function getSuggestedAction(intentType) {
  return INTENT_ACTION_MAP[intentType] || { action: null, handler: null };
}

/**
 * Parse natural language input and generate structured output
 * Enhanced with entity extraction
 * @param {string} input - Natural language input
 * @returns {Promise<Object>} - Parsed intent with project, tasks, entities, and PRD draft
 */
async function parseIntent(input) {
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    throw new Error('Input is required and must be a non-empty string');
  }

  const trimmedInput = input.trim();

  // L2-001: Input length limit to prevent performance issues
  if (trimmedInput.length > 10000) {
    throw new Error('Input too long, maximum 10000 characters allowed');
  }

  // Step 1: Classify intent (enhanced with phrase matching)
  const classification = classifyIntent(trimmedInput);

  // Step 2: Extract entities
  const entities = extractEntities(trimmedInput);

  // Step 3: Extract project name (use entity if available)
  const projectName = entities.module || extractProjectName(trimmedInput, classification.type);

  // Step 4: Generate tasks (context-aware)
  const tasks = generateTasks(projectName, classification.type, trimmedInput, entities);

  // Step 5: Map intent to brain action
  const actionMapping = INTENT_ACTION_MAP[classification.type] || { action: null, handler: null };
  const suggestedAction = actionMapping.action ? {
    action: actionMapping.action,
    params: buildActionParams(classification.type, trimmedInput, entities, projectName)
  } : null;

  // Step 6: Build parsed intent object
  const parsedIntent = {
    originalInput: trimmedInput,
    intentType: classification.type,
    confidence: classification.confidence,
    confidenceLevel: classification.confidenceLevel,
    keywords: classification.keywords,
    matchedPhrases: classification.matchedPhrases || [],
    entities,
    projectName,
    tasks,
    suggestedAction,
    prdDraft: null
  };

  // Step 6: Generate PRD draft
  parsedIntent.prdDraft = generatePrdDraft(parsedIntent);

  return parsedIntent;
}

/**
 * Parse intent and create resources in database
 * @param {string} input - Natural language input
 * @param {Object} options - Options for resource creation
 * @returns {Promise<Object>} - Created resources
 */
async function parseAndCreate(input, options = {}) {
  const { createProject = true, createTasks = true, goalId = null, projectId = null } = options;

  // Parse the intent
  const parsedIntent = await parseIntent(input);

  const result = {
    parsed: parsedIntent,
    created: {
      project: null,
      tasks: []
    }
  };

  // Check if project already exists
  let targetProjectId = projectId;

  if (createProject && !projectId) {
    // Check for existing project with similar name
    const existingProject = await pool.query(`
      SELECT id, name FROM projects
      WHERE LOWER(name) LIKE $1
      LIMIT 1
    `, [`%${parsedIntent.projectName}%`]);

    if (existingProject.rows.length > 0) {
      targetProjectId = existingProject.rows[0].id;
      result.created.project = {
        ...existingProject.rows[0],
        created: false,
        message: 'Using existing project'
      };
    } else {
      // Create new project
      const newProject = await pool.query(`
        INSERT INTO projects (name, description, status)
        VALUES ($1, $2, 'active')
        RETURNING *
      `, [parsedIntent.projectName, `Auto-created from intent: ${input}`]);

      targetProjectId = newProject.rows[0].id;
      result.created.project = {
        ...newProject.rows[0],
        created: true
      };

      console.log(`[Intent] Created project: ${targetProjectId} - ${parsedIntent.projectName}`);
    }
  }

  // Create tasks
  if (createTasks) {
    for (const task of parsedIntent.tasks) {
      const newTask = await pool.query(`
        INSERT INTO tasks (title, description, priority, project_id, goal_id, status)
        VALUES ($1, $2, $3, $4, $5, 'queued')
        RETURNING *
      `, [
        task.title,
        task.description,
        task.priority,
        targetProjectId,
        goalId
      ]);

      result.created.tasks.push(newTask.rows[0]);
      console.log(`[Intent] Created task: ${newTask.rows[0].id} - ${task.title}`);
    }
  }

  return result;
}

export {
  INTENT_TYPES,
  INTENT_PHRASES,
  INTENT_ACTION_MAP,
  ENTITY_PATTERNS,
  classifyIntent,
  extractEntities,
  extractProjectName,
  generateTasks,
  generatePrdDraft,
  generateStandardPrd,
  generateTrdDraft,
  buildActionParams,
  getSuggestedAction,
  parseIntent,
  parseAndCreate
};
