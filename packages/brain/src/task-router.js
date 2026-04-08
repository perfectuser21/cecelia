/**
 * Task Router - Task Type Identification and Location Routing
 *
 * Implements:
 * 1. Single Task vs Feature identification
 * 2. Location routing based on task_type (US/HK)
 * 3. Routing failure detection and fallback strategies
 * 4. KR dispatch diagnostics (diagnoseKR)
 * 5. Domain-aware skill routing via getDomainSkillOverride
 */

import { DOMAIN_TO_ROLE, ROLES } from './role-registry.js';

// Valid task types (for failure detection)
const VALID_TASK_TYPES = [
  'dev', 'review', 'talk', 'data', 'qa', 'audit',
  'research', 'explore', 'knowledge',
  'codex_qa', 'codex_dev', 'codex_test_gen', 'code_review', 'decomp_review',
  'crystallize', 'crystallize_scope', 'crystallize_forge', 'crystallize_verify', 'crystallize_register',
  'pr_review',
  'dept_heartbeat', 'initiative_plan', 'initiative_verify',
  'initiative_execute',
  'suggestion_plan', 'architecture_design', 'architecture_scan',
  'arch_review', 'strategy_session',
  // 前置审查（Intent Expansion）
  'intent_expand',
  // 内容工厂 Pipeline（Content Factory）
  'content-pipeline', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export',
  'content_publish',  // 发布阶段（export 完成后逐平台创建，executor.js 按 payload.platform 路由到对应 publisher skill）
  // Codex Gate 审查任务类型
  'prd_review', 'spec_review', 'code_review_gate', 'initiative_review',
  // Harness v3.x 旧类型（向后兼容）
  'sprint_planner', 'sprint_contract_propose', 'sprint_contract_review',
  'sprint_generate', 'sprint_evaluate', 'sprint_fix', 'sprint_report',
  // Harness v4.0：sprint_* → harness_*，新增 CI/Deploy watch
  'harness_planner',          // Layer 1: 需求→PRD
  'harness_contract_propose', // Layer 2a: Generator 提合同草案
  'harness_contract_review',  // Layer 2b: Evaluator 挑战合同 → APPROVED/REVISION
  'harness_generate',         // Layer 3a: Generator 写代码
  'harness_ci_watch',         // Layer 3b: Brain tick 轮询 CI（内联，不派 agent）
  'harness_evaluate',         // Layer 3c: Evaluator 验证 PR diff（读 diff vs 合同）
  'harness_fix',              // Layer 3d: Generator 修复
  'harness_deploy_watch',     // Layer 3e: Brain tick 轮询 CD（内联，不派 agent）
  'harness_report',           // Layer 4: 最终报告
  // Scope 层飞轮（Project→Scope→Initiative 三层拆解）
  'scope_plan', 'project_plan',
  // OKR 新表飞轮（okr_projects→okr_scopes→okr_initiatives 三层拆解）
  'okr_initiative_plan', 'okr_scope_plan', 'okr_project_plan',
  // 发布后数据回收（Brain 内部处理，不走外部 executor）
  'platform_scraper',
];

// 支持 P2P 异步回调的任务类型
// 当飞书 P2P 创建这些类型的任务后，自动注册 task_interest 订阅，任务完成时回调用户
// 扩展新能力：在此 Set 中加一行，无需改 ops.js
const ASYNC_CALLBACK_TYPES = new Set([
  'explore',   // 信息探查（如"zenithjoy 现在有什么"）
  'research',  // 深度调研（如"帮我调研 XXX"）
]);

// Skill whitelist based on task type
const SKILL_WHITELIST = {
  'dev': '/dev',
  'review': '/code-review',
  'talk': '/cecelia',
  'data': '/sync-hk',
  'qa': '/code-review',
  'audit': '/code-review',
  'research': '/research',
  'explore': '/explore',
  'knowledge': '/knowledge',
  'codex_qa': '/codex',
  'codex_dev': '/dev',  // Codex Provider 跑 /dev — 与 dev 相同 skill，通过 runner.sh 执行
  'crystallize': '/playwright',         // crystallize 编排入口 — 西安 M4 CDP 控制 PC
  'crystallize_scope': '/playwright',   // Scope 阶段：定义目标 + DoD
  'crystallize_forge': '/playwright',   // Forge 阶段：Codex 探索写脚本
  'crystallize_verify': '/playwright',  // Verify 阶段：无 LLM 验证3次
  'crystallize_register': '/playwright', // Register 阶段：注册到 SKILL.md
  'codex_test_gen': '/codex-test-gen',  // Codex 自动生成测试 — 西安 M4 扫描覆盖率低模块
  'pr_review': '/review',  // 异步 PR 审查 → 西安 Codex 独立 LLM 审查
  'code_review': '/code-review',
  'decomp_review': '/decomp-check',
  'dept_heartbeat': '/cecelia',
  'initiative_plan': '/decomp',
  'initiative_verify': '/arch-review verify',
  'suggestion_plan': '/plan',
  'architecture_design': '/architect design',
  'architecture_scan': '/architect scan',
  'arch_review': '/arch-review review',
  'strategy_session': '/strategy-session',
  // 前置审查（Intent Expansion）
  'intent_expand': '/intent-expand',  // 意图扩展 → US 本机，查 OKR/Vision 链路补全 PRD
  // Initiative 执行
  'initiative_execute': '/dev',       // Initiative 执行 → US 本机，/dev 全流程
  // 内容工厂 Pipeline（Content Factory）
  'content-pipeline': '/content-creator',
  'content-research': '/notebooklm',
  'content-copywriting': '/content-creator',
  'content-copy-review': '/content-creator',
  'content-generate': '/content-creator',
  'content-image-review': '/content-creator',
  'content-export': '/content-creator',
  'content_publish': '/content-creator',  // 发布阶段 → executor 按 payload.platform 路由到对应 publisher skill
  // Codex Gate 审查任务类型
  'prd_review': '/prd-review',              // PRD 审查
  'spec_review': '/spec-review',            // Spec 审查
  'code_review_gate': '/code-review-gate',  // 代码质量门禁
  'initiative_review': '/initiative-review', // Initiative 整体审查
  // Harness v3.x 旧类型（向后兼容）
  'sprint_planner': '/sprint-planner',
  'sprint_contract_propose': '/sprint-contract-proposer',
  'sprint_contract_review': '/sprint-contract-reviewer',
  'sprint_generate': '/dev',
  'sprint_evaluate': '/sprint-evaluator',
  'sprint_fix': '/dev',
  'sprint_report': '/sprint-report',
  // Harness v4.0 新类型
  'harness_planner': '/harness-planner',                      // Layer 1: 需求→PRD
  'harness_contract_propose': '/harness-contract-proposer',   // Layer 2a: 提合同草案
  'harness_contract_review': '/harness-contract-reviewer',    // Layer 2b: 挑战合同
  'harness_generate': '/harness-generator',                   // Layer 3a: Generator 写代码
  'harness_ci_watch': '/_internal',                           // Brain tick 内联处理（不派 agent）
  'harness_evaluate': '/harness-evaluator',                   // Layer 3c: Evaluator 验证 PR diff
  'harness_fix': '/harness-generator',                        // Layer 3d: Generator 修复（同 generator skill）
  'harness_deploy_watch': '/_internal',                       // Brain tick 内联处理（不派 agent）
  'harness_report': '/harness-report',                        // Layer 4: 最终报告
  // Scope 层飞轮（Project→Scope→Initiative）
  'scope_plan': '/decomp',        // Scope 内规划下一个 Initiative
  'project_plan': '/decomp',      // Project 内规划下一个 Scope
  // OKR 新表飞轮（okr_projects→okr_scopes→okr_initiatives）
  'okr_initiative_plan': '/decomp',  // OKR Scope 内规划下一个 Initiative
  'okr_scope_plan': '/decomp',       // OKR Project 内规划下一个 Scope
  'okr_project_plan': '/decomp',     // OKR Project 层完成后规划
  // 发布后数据回收（Brain 内部处理，声明 skill 避免路由校验失败）
  'platform_scraper': '/media-scraping',
};

// Fallback strategies when primary routing fails
const FALLBACK_STRATEGIES = {
  // skill fallback: when skill not available, try alternative
  // NOTE: dev→talk removed (silent failure: coding task degraded to chat)
  'skill': {
    'review': 'code_review',
    'code_review': 'dev'
  },
  // location fallback: when location not reachable, try alternative
  'location': {
    'us': 'xian',
    'xian': 'us'
  }
};

// Task type patterns for identifying single tasks
const SINGLE_TASK_PATTERNS = [
  /修复/i,
  /fix/i,
  /改一下/i,
  /加个/i,
  /删掉/i,
  /更新/i,
  /调整/i,
  /修改/i,
  /bugfix/i,
  /hotfix/i,
  /patch/i,
  /typo/i,
  /refactor\s+small/i
];

// Task type patterns for identifying features
const FEATURE_PATTERNS = [
  /实现/i,
  /做一个/i,
  /新功能/i,
  /系统/i,
  /模块/i,
  /重构/i,
  /implement/i,
  /feature/i,
  /build/i,
  /create\s+(a|an|new)/i,
  /develop/i,
  /设计/i,
  /架构/i
];

// Location mapping based on task_type
// US = Claude Code (Opus/Sonnet), HK = MiniMax + N8N
const LOCATION_MAP = {
  'dev': 'us',        // 写代码 → US (Nobel + Opus + /dev)
  'review': 'us',     // 代码审查 → US (Sonnet + /review)
  'qa': 'us',         // QA → US (Sonnet)
  'audit': 'us',      // 审计 → US (Sonnet)
  'codex_qa': 'xian',  // Codex 免疫检查 → 西安 Mac mini (Codex CLI via codex-bridge)
  'codex_dev': 'xian', // Codex /dev → 西安 Mac mini (runner.sh + devloop-check.sh SSOT)
  // crystallize 能力蒸馏流水线 → 西安 M4 (playwright-runner.sh + CDP → PC)
  'crystallize': 'xian',
  'crystallize_scope': 'xian',
  'crystallize_forge': 'xian',
  'crystallize_verify': 'xian',
  'crystallize_register': 'xian',
  'codex_test_gen': 'xian',   // 自动生成测试 → 西安 M4 (Codex 扫描覆盖率低模块 + 生成测试)
  'pr_review': 'xian',  // 异步 PR 审查 → 西安 Mac mini (MiniMax via Codex CLI, 独立账号)
  'code_review': 'us',      // 代码审查 → US 本机 Codex (需读代码上下文，/code-review skill)
  'decomp_review': 'us',    // 拆解审查 → US 本机 Codex (需读代码结构，Vivian 角色)
  'dept_heartbeat': 'us',   // 部门心跳 → US (MiniMax-M2.5-highspeed via cecelia-run)
  'initiative_plan': 'us',        // Initiative 规划 → US 本机 Codex (需读现有代码，/decomp skill)
  'initiative_verify': 'us',      // Initiative 验收 → US 本机 Codex (需核查代码实现，/arch-review verify)
  'suggestion_plan': 'xian',      // Suggestion 层级识别 → 西安 Codex (B類纯策略，/plan skill)
  'architecture_design': 'us',    // Architecture 设计 → US 本机 Codex (需读代码，/architect design)
  'architecture_scan': 'us',      // 系统扫描 → US 本机 Codex (需读代码，/architect scan)
  'arch_review': 'us',             // 架构巡检 → US 本机（需读本地代码+DB，/arch-review review）
  'strategy_session': 'xian',     // 战略会议 → 西安 Codex (B類，/strategy-session)
  'intent_expand': 'us',          // 意图扩展 → US 本机（需读本地 Brain DB，补全 PRD）
  'initiative_execute': 'us',     // Initiative 执行 → US 本机（/dev 全流程，A類）
  'explore': 'xian',  // 快速调研 → 西安 Codex (general，任意可用机器)
  'knowledge': 'xian',  // 知识记录 → 西安 Codex (B類，/knowledge skill)
  'talk': 'xian',     // 对话 → 西安 Codex (general，任意可用机器)
  'research': 'xian', // 深度调研 → 西安 Codex (general，任意可用机器)
  'data': 'xian',     // 数据处理 → 西安 Codex (general)
  // 内容工厂 Pipeline（Content Factory）→ 西安 Codex 执行
  'content-pipeline': 'xian',  // Pipeline 编排入口 → 西安 Codex
  'content-research': 'xian',  // 调研阶段 → 西安 (/notebooklm)
  'content-copywriting': 'xian', // 文案生成 → 西安 (/content-creator)
  'content-copy-review': 'xian', // 文案审核 → 西安（纯规则检查）
  'content-generate': 'xian',  // 图片生成 → 西安 (/content-creator)
  'content-image-review': 'xian', // 图片审核 → 西安（规则+视觉检查）
  'content-export': 'xian',    // 导出阶段 → 西安 (card-renderer.mjs)
  'content_publish': 'us',     // 发布阶段 → US 本机（publisher skills 需要浏览器 CDP，在 US Mac mini 跑）
  // Harness v3.x 旧类型（向后兼容）→ US 本机
  'sprint_planner': 'us',
  'sprint_contract_propose': 'us',
  'sprint_contract_review': 'us',
  'sprint_generate': 'us',
  'sprint_evaluate': 'us',
  'sprint_fix': 'us',
  'sprint_report': 'us',
  // Harness v4.0 → US 本机
  'harness_planner': 'us',            // Layer 1: Planner → US（写 PRD）
  'harness_contract_propose': 'us',   // Layer 2a: Generator 提合同草案 → US
  'harness_contract_review': 'us',    // Layer 2b: Evaluator 挑战合同 → US
  'harness_generate': 'us',           // Layer 3a: Generator 写代码 → US
  'harness_ci_watch': 'us',           // Layer 3b: CI 监控（Brain tick 内联处理）→ US
  'harness_evaluate': 'us',           // Layer 3c: Evaluator 验证 PR diff → US
  'harness_fix': 'us',                // Layer 3d: Generator 修复 → US
  'harness_deploy_watch': 'us',       // Layer 3e: Deploy 监控（Brain tick 内联处理）→ US
  'harness_report': 'us',             // Layer 4: 最终报告 → US
  // Codex Gate 审查任务类型 → US 本机（需读 worktree diff + Brain DB）
  'prd_review': 'us',            // PRD 审查 → US 本机 Codex
  'spec_review': 'us',           // Spec 审查 → US 本机 Codex
  'code_review_gate': 'us',      // 代码质量门禁 → US 本机 Codex
  'initiative_review': 'us',     // Initiative 整体审查 → US 本机 Codex
  // Scope 层飞轮
  'scope_plan': 'xian',            // Scope 规划 → 西安 Codex (B類，/decomp skill)
  'project_plan': 'xian',          // Project 规划 → 西安 Codex (B類，/decomp skill)
  // OKR 新表飞轮
  'okr_initiative_plan': 'xian',   // OKR Initiative 规划 → 西安 Codex (B類，/decomp skill)
  'okr_scope_plan': 'xian',        // OKR Scope 规划 → 西安 Codex (B類，/decomp skill)
  'okr_project_plan': 'xian',      // OKR Project 规划 → 西安 Codex (B類，/decomp skill)
  'pipeline_rescue': 'us',        // Pipeline 救援 → US 本机（需读 .dev-mode + worktree）
  'platform_scraper': 'us',       // 数据采集任务 → Brain 内部处理（不走外部 executor，见 post-publish-data-collector.js）
};

// Default location
const DEFAULT_LOCATION = 'us';

// Capability requirements per task type (machine registry routing)
// Tags: 'has_git' = needs code/git access (US M4 only)
//       'general' = any available machine
//       'has_browser' = needs browser/CDP access
const TASK_REQUIREMENTS = {
  // A类 - 需要 git/代码访问（US M4 独有）
  'dev':                ['has_git'],
  'review':             ['has_git'],
  'qa':                 ['has_git'],
  'audit':              ['has_git'],
  'code_review':        ['has_git'],
  'decomp_review':      ['has_git'],
  'initiative_plan':    ['has_git'],
  'initiative_verify':  ['has_git'],
  'arch_review':        ['has_git'],
  'architecture_design':['has_git'],
  'architecture_scan':  ['has_git'],
  'prd_review':         ['has_git'],
  'spec_review':        ['has_git'],
  'code_review_gate':   ['has_git'],
  'initiative_review':  ['has_git'],
  'intent_expand':      ['has_git'],
  'initiative_execute': ['has_git'],
  'pipeline_rescue':    ['has_git'],
  'codex_dev':          ['has_git'],
  // 需要浏览器（crystallize 各阶段均通过 CDP 控制西安 PC 浏览器）
  'crystallize':          ['has_browser'],
  'crystallize_scope':    ['has_browser'],
  'crystallize_forge':    ['has_browser'],
  'crystallize_verify':   ['has_browser'],
  'crystallize_register': ['has_browser'],
  // B类通用 - 任意 general 机器
  'codex_qa':           ['general'],
  'codex_test_gen':     ['general'],
  'pr_review':          ['general'],
  'suggestion_plan':    ['general'],
  'strategy_session':   ['general'],
  'scope_plan':         ['general'],
  'project_plan':       ['general'],
  'okr_initiative_plan': ['general'],
  'okr_scope_plan':     ['general'],
  'okr_project_plan':   ['general'],
  'knowledge':          ['general'],
  'talk':               ['general'],
  'research':           ['general'],
  'explore':            ['general'],
  'data':               ['general'],
  'dept_heartbeat':     ['general'],
  'content-pipeline':   ['general'],
  'content-research':   ['general'],
  'content-copywriting': ['general'],
  'content-copy-review': ['general'],
  'content-generate':   ['general'],
  'content-image-review': ['general'],
  'content-export':     ['general'],
  'platform_scraper':   ['has_browser'],  // 需要 CDP 浏览器接入各平台
  'content_publish':    ['has_browser'],  // 发布 skill（douyin/kuaishou 等）需要 CDP 浏览器控制
};

/**
 * Identify work type: single task or feature
 * @param {string} input - User input or task description
 * @returns {'single' | 'feature' | 'ask_autumnrice'} - Work type
 */
function identifyWorkType(input) {
  if (!input || typeof input !== 'string') {
    return 'ask_autumnrice';
  }

  const normalizedInput = input.trim();

  // Check for single task patterns
  for (const pattern of SINGLE_TASK_PATTERNS) {
    if (pattern.test(normalizedInput)) {
      return 'single';
    }
  }

  // Check for feature patterns
  for (const pattern of FEATURE_PATTERNS) {
    if (pattern.test(normalizedInput)) {
      return 'feature';
    }
  }

  // When uncertain, ask Autumnrice to decide
  return 'ask_autumnrice';
}

/**
 * Get task location based on task_type
 * @param {string} taskType - Task type (dev, review, talk, data, etc.)
 * @returns {'us' | 'hk'} - Location
 */
function getTaskLocation(taskType) {
  if (!taskType || typeof taskType !== 'string') {
    return DEFAULT_LOCATION;
  }

  const location = LOCATION_MAP[taskType.toLowerCase()];
  return location || DEFAULT_LOCATION;
}

/**
 * Get capability requirements for a task type
 * @param {string} taskType - Task type (dev, research, talk, etc.)
 * @returns {string[]} - Required capability tags
 */
function getTaskRequirements(taskType) {
  if (!taskType || typeof taskType !== 'string') {
    return ['has_git']; // default to most restrictive
  }
  return TASK_REQUIREMENTS[taskType.toLowerCase()] || ['has_git'];
}

/**
 * Determine execution mode for a task
 * @param {Object} options - Options
 * @param {string} options.input - User input
 * @param {string} options.feature_id - Feature ID if part of a feature
 * @param {boolean} options.is_recurring - Whether it's a recurring task
 * @returns {'single' | 'feature_task' | 'recurring'} - Execution mode
 */
function determineExecutionMode({ input, feature_id, is_recurring }) {
  if (is_recurring) {
    return 'recurring';
  }

  if (feature_id) {
    return 'feature_task';
  }

  const workType = identifyWorkType(input);

  // All tasks dispatched by Cecelia use 'cecelia' execution_mode
  return 'cecelia';
}

/**
 * Get domain-based skill override for a task type.
 *
 * When a task has a known domain, this function returns the primary skill
 * for that domain's owner role, overriding the default task_type routing.
 *
 * Rules:
 * - null/undefined domain → null (fallback to task_type routing)
 * - domain=coding + task_type=dev → null (use default /dev, no override)
 * - other domain → look up DOMAIN_TO_ROLE → ROLES[role].skills[0]
 * - unknown domain or role with no skills → null
 *
 * @param {string} taskType - Task type (e.g. 'dev', 'review')
 * @param {string|null} domain - Business domain (e.g. 'coding', 'product', 'quality')
 * @returns {string|null} - Skill override (e.g. '/plan', '/qa') or null
 */
function getDomainSkillOverride(taskType, domain) {
  if (!domain || typeof domain !== 'string') return null;

  const domainLower = domain.toLowerCase();

  // coding domain: use default task_type routing (no override)
  if (domainLower === 'coding') return null;

  // Look up the owner role for this domain
  const roleId = DOMAIN_TO_ROLE[domainLower];
  if (!roleId) return null;

  const role = ROLES[roleId];
  if (!role || !Array.isArray(role.skills) || role.skills.length === 0) return null;

  // Return the primary skill for this domain's role
  return role.skills[0];
}

/**
 * Route task to appropriate location and execution mode
 * @param {Object} taskData - Task data
 * @returns {Object} - Routing decision
 */
function routeTaskCreate(taskData) {
  const {
    title,
    task_type = 'dev',
    feature_id,
    is_recurring,
    kr_id,
    initiative_id,
    project_id,
    task_id,
    domain
  } = taskData;

  const location = getTaskLocation(task_type);
  const executionMode = determineExecutionMode({
    input: title,
    feature_id,
    is_recurring
  });

  // Domain-aware skill routing: override if domain provides a specific skill
  const domainSkill = getDomainSkillOverride(task_type, domain);
  const skill = domainSkill || SKILL_WHITELIST[task_type?.toLowerCase()] || '/dev';

  const routing = {
    location,
    execution_mode: executionMode,
    task_type,
    skill,
    domain: domain || null,
    routing_reason: domain
      ? `domain=${domain} → skill=${skill}, task_type=${task_type} → location=${location}`
      : `task_type=${task_type} → location=${location}, execution_mode=${executionMode}`
  };

  // Enhanced log: include all available context for traceability
  const logCtx = [
    `task_type=${task_type}`,
    domain ? `domain=${domain}` : null,
    `location=${location}`,
    `skill=${skill}`,
    `execution_mode=${executionMode}`,
    title ? `title="${title.substring(0, 50)}"` : null,
    kr_id ? `kr_id=${kr_id}` : null,
    initiative_id ? `initiative_id=${initiative_id}` : null,
    project_id ? `project_id=${project_id}` : null,
    task_id ? `task_id=${task_id}` : null,
    feature_id ? `feature_id=${feature_id}` : null,
    is_recurring ? 'is_recurring=true' : null
  ].filter(Boolean).join(', ');

  console.log(`[task-router] routeTaskCreate: ${logCtx}`);

  return routing;
}

/**
 * Validate task type
 * @param {string} taskType - Task type to validate
 * @returns {boolean} - Whether task type is valid
 */
function isValidTaskType(taskType) {
  return VALID_TASK_TYPES.includes(taskType?.toLowerCase());
}

/**
 * Validate location
 * @param {string} location - Location to validate
 * @returns {boolean} - Whether location is valid
 */
function isValidLocation(location) {
  return ['us', 'xian', 'xian_m1'].includes(location?.toLowerCase());
}

/**
 * Get all valid task types
 * @returns {string[]} - Array of valid task types
 */
function getValidTaskTypes() {
  return Object.keys(LOCATION_MAP);
}

/**
 * Get location for multiple task types (batch)
 * @param {string[]} taskTypes - Array of task types
 * @returns {Object} - Map of task_type → location
 */
function getLocationsForTaskTypes(taskTypes) {
  const result = {};
  for (const taskType of taskTypes) {
    result[taskType] = getTaskLocation(taskType);
  }
  return result;
}

/**
 * Detect routing failure reasons
 * @param {Object} routing - Current routing decision
 * @returns {Object} - Failure detection result { failed: boolean, reason: string|null }
 */
function detectRoutingFailure(routing) {
  const { task_type, location, skill } = routing;

  // Check if task_type is valid
  if (task_type && !VALID_TASK_TYPES.includes(task_type.toLowerCase())) {
    return { failed: true, reason: `invalid_task_type:${task_type}` };
  }

  // Check if location is valid
  if (location && !['us', 'hk', 'xian', 'xian_m1'].includes(location.toLowerCase())) {
    return { failed: true, reason: `invalid_location:${location}` };
  }

  // Check if skill exists in whitelist
  if (skill && !Object.values(SKILL_WHITELIST).includes(skill)) {
    return { failed: true, reason: `invalid_skill:${skill}` };
  }

  return { failed: false, reason: null };
}

/**
 * Get fallback strategy for a given failure type
 * @param {string} failureType - Type of failure (skill|location|task_type)
 * @param {string} currentValue - Current value that failed
 * @returns {Object|null} - Fallback strategy { strategy: string, fallbackValue: string }
 */
function getFallbackStrategy(failureType, currentValue) {
  if (failureType === 'skill') {
    const fallback = FALLBACK_STRATEGIES.skill[currentValue];
    if (fallback) {
      return { strategy: 'skill_fallback', fallbackValue: fallback };
    }
  }

  if (failureType === 'location') {
    const fallback = FALLBACK_STRATEGIES.location[currentValue];
    if (fallback) {
      return { strategy: 'location_fallback', fallbackValue: fallback };
    }
  }

  return null;
}

/**
 * Route task with fallback strategies
 * @param {Object} taskData - Task data
 * @returns {Object} - Routing decision with fallback info
 */
function routeTaskWithFallback(taskData) {
  const {
    title,
    task_type = 'dev',
    feature_id,
    is_recurring
  } = taskData;

  // Initial routing
  let location = getTaskLocation(task_type);
  let executionMode = determineExecutionMode({
    input: title,
    feature_id,
    is_recurring
  });
  let skill = SKILL_WHITELIST[task_type?.toLowerCase()] || '/dev';

  // Build initial routing result
  let routing = {
    location,
    execution_mode: executionMode,
    task_type,
    skill,
    routing_status: 'success',
    failure_reason: null,
    fallback_strategy: null
  };

  // Check for routing failure
  const failure = detectRoutingFailure(routing);

  if (failure.failed) {
    // Try fallback strategies
    const [failureType, failedValue] = failure.reason.split(':');

    const fallback = getFallbackStrategy(failureType, failedValue);

    if (fallback) {
      // Apply fallback
      if (failureType === 'skill') {
        routing.skill = SKILL_WHITELIST[fallback.fallbackValue] || '/dev';
        routing.task_type = fallback.fallbackValue;
      } else if (failureType === 'location') {
        routing.location = fallback.fallbackValue;
      }

      routing.routing_status = 'fallback';
      routing.failure_reason = failure.reason;
      routing.fallback_strategy = fallback.strategy;
    } else {
      // No fallback available, use defaults
      routing.routing_status = 'failed';
      routing.failure_reason = failure.reason;
      routing.location = DEFAULT_LOCATION;
      routing.skill = '/dev';
    }
  }

  routing.routing_reason = `task_type=${routing.task_type} → location=${routing.location}, skill=${routing.skill}, status=${routing.routing_status}`;

  if (routing.routing_status === 'success') {
    console.log(`[task-router] routeTaskWithFallback: task_type=${routing.task_type}, location=${routing.location}, skill=${routing.skill}`);
  } else if (routing.routing_status === 'fallback') {
    console.warn(`[task-router] routeTaskWithFallback: FALLBACK triggered, reason=${routing.failure_reason}, strategy=${routing.fallback_strategy}, final_location=${routing.location}, final_skill=${routing.skill}`);
  } else {
    console.error(`[task-router] routeTaskWithFallback: FAILED, reason=${routing.failure_reason}, using defaults location=${routing.location}, skill=${routing.skill}`);
  }

  return routing;
}

/**
 * Diagnose task dispatch status for a KR
 *
 * Returns a detailed report on why tasks under a KR may not be dispatching:
 * - All initiatives under the KR (via okr_projects → okr_scopes → okr_initiatives)
 * - Task counts and statuses per initiative
 * - Dispatch blockers (reasons why tasks are not being queued/dispatched)
 *
 * @param {string} krId - KR (goal) ID to diagnose
 * @param {Object} pool - PostgreSQL pool instance (dependency injection)
 * @returns {Promise<Object>} - Diagnosis report
 */
async function diagnoseKR(krId, pool) {
  console.log(`[task-router] diagnoseKR: starting diagnosis for kr_id=${krId}`);

  // 1. Load KR info
  const krResult = await pool.query(
    `SELECT id, title, status FROM key_results WHERE id = $1`,
    [krId]
  );

  if (krResult.rows.length === 0) {
    console.warn(`[task-router] diagnoseKR: kr_id=${krId} not found`);
    return null;
  }

  const kr = krResult.rows[0];
  console.log(`[task-router] diagnoseKR: kr found: "${kr.title}" (status=${kr.status})`);

  // 2. Load all Projects under this KR (via okr_projects)
  const projectsResult = await pool.query(`
    SELECT p.id, p.title AS name, p.status, p.created_at
    FROM okr_projects p
    WHERE p.kr_id = $1
    ORDER BY p.created_at ASC
  `, [krId]);

  const projects = projectsResult.rows;
  console.log(`[task-router] diagnoseKR: found ${projects.length} projects under KR`);

  // 3. For each project, load all initiatives
  const initiativesData = [];
  const dispatchBlockers = [];

  for (const project of projects) {
    const initResult = await pool.query(`
      SELECT i.id, i.title AS name, i.status, i.created_at,
             (SELECT COUNT(*) FROM tasks t WHERE t.okr_initiative_id = i.id) AS task_count,
             (SELECT COUNT(*) FROM tasks t WHERE t.okr_initiative_id = i.id AND t.status IN ('queued', 'in_progress')) AS active_task_count,
             (SELECT COUNT(*) FROM tasks t WHERE t.okr_initiative_id = i.id AND t.status = 'completed') AS completed_task_count,
             (SELECT COUNT(*) FROM tasks t WHERE t.okr_initiative_id = i.id AND t.status IN ('failed', 'cancelled')) AS failed_task_count
      FROM okr_initiatives i
      INNER JOIN okr_scopes s ON s.id = i.scope_id
      WHERE s.project_id = $1
      ORDER BY i.created_at ASC
    `, [project.id]);

    const initiatives = initResult.rows;
    console.log(`[task-router] diagnoseKR: project "${project.name}" has ${initiatives.length} initiatives`);

    for (const initiative of initiatives) {
      // Load recent tasks for this initiative
      const tasksResult = await pool.query(`
        SELECT id, title, task_type, status, priority, created_at, updated_at
        FROM tasks
        WHERE okr_initiative_id = $1
        ORDER BY created_at DESC
        LIMIT 10
      `, [initiative.id]);

      const tasks = tasksResult.rows;
      const taskCount = parseInt(initiative.task_count, 10);
      const activeTaskCount = parseInt(initiative.active_task_count, 10);

      // Detect blockers
      if (initiative.status === 'active' && taskCount === 0) {
        const blocker = {
          initiative_id: initiative.id,
          initiative_name: initiative.name,
          reason: 'no_tasks_created',
          detail: '该 Initiative 下没有任何 Task，需要运行 initiative_plan 拆解'
        };
        dispatchBlockers.push(blocker);
        console.warn(`[task-router] diagnoseKR: BLOCKER initiative="${initiative.name}" reason=no_tasks_created`);
      } else if (initiative.status === 'active' && taskCount > 0 && activeTaskCount === 0) {
        // Check if all tasks are completed or failed
        const allCompleted = parseInt(initiative.completed_task_count, 10) === taskCount;
        const allFailed = parseInt(initiative.failed_task_count, 10) === taskCount;

        if (allCompleted) {
          const blocker = {
            initiative_id: initiative.id,
            initiative_name: initiative.name,
            reason: 'all_tasks_completed_initiative_still_active',
            detail: '所有 Task 已完成，但 Initiative 仍为 active 状态，可能需要验收或关闭'
          };
          dispatchBlockers.push(blocker);
          console.warn(`[task-router] diagnoseKR: BLOCKER initiative="${initiative.name}" reason=all_tasks_completed_initiative_still_active`);
        } else if (allFailed) {
          const blocker = {
            initiative_id: initiative.id,
            initiative_name: initiative.name,
            reason: 'all_tasks_failed',
            detail: '所有 Task 已失败，需要人工干预或重新规划'
          };
          dispatchBlockers.push(blocker);
          console.warn(`[task-router] diagnoseKR: BLOCKER initiative="${initiative.name}" reason=all_tasks_failed`);
        } else {
          const blocker = {
            initiative_id: initiative.id,
            initiative_name: initiative.name,
            reason: 'no_active_tasks',
            detail: `有 ${taskCount} 个 Task 但无 queued/in_progress，Task 可能处于异常状态`
          };
          dispatchBlockers.push(blocker);
          console.warn(`[task-router] diagnoseKR: BLOCKER initiative="${initiative.name}" reason=no_active_tasks task_count=${taskCount}`);
        }
      } else if (initiative.status !== 'active') {
        console.log(`[task-router] diagnoseKR: initiative="${initiative.name}" skipped (status=${initiative.status})`);
      }

      initiativesData.push({
        id: initiative.id,
        name: initiative.name,
        status: initiative.status,
        created_at: initiative.created_at,
        project_id: project.id,
        project_name: project.name,
        task_count: taskCount,
        active_task_count: activeTaskCount,
        completed_task_count: parseInt(initiative.completed_task_count, 10),
        failed_task_count: parseInt(initiative.failed_task_count, 10),
        tasks: tasks.map(t => ({
          id: t.id,
          title: t.title,
          task_type: t.task_type,
          status: t.status,
          priority: t.priority,
          created_at: t.created_at,
          updated_at: t.updated_at,
          routing: routeTaskCreate({ title: t.title, task_type: t.task_type, kr_id: krId, initiative_id: initiative.id })
        }))
      });
    }

    // Check if project has no initiatives at all
    if (initiatives.length === 0 && project.status === 'active') {
      const blocker = {
        project_id: project.id,
        project_name: project.name,
        reason: 'no_initiatives',
        detail: '该 Project 下没有任何 Initiative，需要秋米拆解'
      };
      dispatchBlockers.push(blocker);
      console.warn(`[task-router] diagnoseKR: BLOCKER project="${project.name}" reason=no_initiatives`);
    }
  }

  // 4. Summary
  const totalInitiatives = initiativesData.length;
  const activeInitiatives = initiativesData.filter(i => i.status === 'active').length;
  const initiativesWithQueuedTasks = initiativesData.filter(i => i.active_task_count > 0).length;
  const diagnosis = dispatchBlockers.length === 0 ? 'healthy' : 'blocked';

  console.log(`[task-router] diagnoseKR: kr_id=${krId} diagnosis=${diagnosis} blockers=${dispatchBlockers.length} total_initiatives=${totalInitiatives} active=${activeInitiatives} with_queued=${initiativesWithQueuedTasks}`);

  return {
    kr_id: kr.id,
    kr_title: kr.title,
    kr_status: kr.status,
    kr_priority: kr.priority ?? null,
    kr_progress: kr.progress ?? null,
    summary: {
      total_projects: projects.length,
      total_initiatives: totalInitiatives,
      active_initiatives: activeInitiatives,
      initiatives_with_active_tasks: initiativesWithQueuedTasks,
      dispatch_blocker_count: dispatchBlockers.length,
      diagnosis
    },
    dispatch_blockers: dispatchBlockers,
    projects: projects.map(p => ({
      id: p.id,
      name: p.name,
      status: p.status,
      initiatives: initiativesData.filter(i => i.project_id === p.id)
    }))
  };
}

export {
  identifyWorkType,
  getTaskLocation,
  getTaskRequirements,
  determineExecutionMode,
  getDomainSkillOverride,
  routeTaskCreate,
  routeTaskWithFallback,
  detectRoutingFailure,
  getFallbackStrategy,
  isValidTaskType,
  isValidLocation,
  getValidTaskTypes,
  getLocationsForTaskTypes,
  diagnoseKR,
  LOCATION_MAP,
  TASK_REQUIREMENTS,
  SINGLE_TASK_PATTERNS,
  FEATURE_PATTERNS,
  DEFAULT_LOCATION,
  VALID_TASK_TYPES,
  SKILL_WHITELIST,
  FALLBACK_STRATEGIES,
  ASYNC_CALLBACK_TYPES
};
