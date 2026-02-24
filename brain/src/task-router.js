/**
 * Task Router - Task Type Identification and Location Routing
 *
 * Implements:
 * 1. Single Task vs Feature identification
 * 2. Location routing based on task_type (US/HK)
 */

// Task type patterns for identification
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
  'codex_qa': 'us',    // Codex 免疫检查 → US (Codex CLI)
  'code_review': 'us', // 代码审查 → US (Claude + /code-review skill)
  'decomp_review': 'us', // 拆解审查 → US (Vivian, claude-haiku)
  'dept_heartbeat': 'us', // 部门心跳 → US (MiniMax-M2.5-highspeed via cecelia-run)
  'initiative_plan': 'us',      // Initiative 规划 → US (Opus)
  'initiative_verify': 'us',    // Initiative 验收 → US (Opus)
  'talk': 'hk',       // 对话 → HK (MiniMax)
  'research': 'hk',   // 调研 → HK (MiniMax)
  'data': 'hk',       // 数据处理 → HK (N8N)
};

// Default location
const DEFAULT_LOCATION = 'us';

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

  // If it's clearly a single task, return single
  if (workType === 'single') {
    return 'single';
  }

  // For feature or uncertain, default to single (user can upgrade to feature later)
  return 'single';
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
    is_recurring
  } = taskData;

  const location = getTaskLocation(task_type);
  const executionMode = determineExecutionMode({
    input: title,
    feature_id,
    is_recurring
  });

  return {
    location,
    execution_mode: executionMode,
    task_type,
    routing_reason: `task_type=${task_type} → location=${location}, execution_mode=${executionMode}`
  };
}

/**
 * Validate task type
 * @param {string} taskType - Task type to validate
 * @returns {boolean} - Whether task type is valid
 */
function isValidTaskType(taskType) {
  const validTypes = ['dev', 'review', 'talk', 'data', 'qa', 'audit', 'research', 'codex_qa', 'code_review', 'decomp_review', 'dept_heartbeat', 'initiative_plan', 'initiative_verify'];
  return validTypes.includes(taskType?.toLowerCase());
}

/**
 * Validate location
 * @param {string} location - Location to validate
 * @returns {boolean} - Whether location is valid
 */
function isValidLocation(location) {
  return ['us', 'hk'].includes(location?.toLowerCase());
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

export {
  identifyWorkType,
  getTaskLocation,
  determineExecutionMode,
  routeTaskCreate,
  isValidTaskType,
  isValidLocation,
  getValidTaskTypes,
  getLocationsForTaskTypes,
  LOCATION_MAP,
  SINGLE_TASK_PATTERNS,
  FEATURE_PATTERNS,
  DEFAULT_LOCATION
};
