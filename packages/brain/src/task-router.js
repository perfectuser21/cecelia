/**
 * Task Router - Task Type Identification and Location Routing
 *
 * Implements:
 * 1. Single Task vs Feature identification
 * 2. Location routing based on task_type (US/HK)
 * 3. Routing failure detection and fallback strategies
 */

// Valid task types (for failure detection)
const VALID_TASK_TYPES = [
  'dev', 'review', 'talk', 'data', 'qa', 'audit',
  'research', 'codex_qa', 'code_review', 'decomp_review',
  'dept_heartbeat', 'initiative_plan', 'initiative_verify',
  'suggestion_plan'
];

// Skill whitelist based on task type
const SKILL_WHITELIST = {
  'dev': '/dev',
  'review': '/code-review',
  'talk': '/cecelia',
  'data': '/sync-hk',
  'qa': '/qa',
  'audit': '/review',
  'research': '/exploratory',
  'codex_qa': '/codex',
  'code_review': '/code-review',
  'decomp_review': '/decomp-check',
  'dept_heartbeat': '/cecelia',
  'initiative_plan': '/decomp',
  'initiative_verify': '/decomp',
  'suggestion_plan': '/plan'
};

// Fallback strategies when primary routing fails
const FALLBACK_STRATEGIES = {
  // skill fallback: when skill not available, try alternative
  'skill': {
    'dev': 'talk',
    'review': 'qa',
    'code_review': 'review'
  },
  // location fallback: when location not reachable, try alternative
  'location': {
    'us': 'hk',
    'hk': 'us'
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
  'codex_qa': 'us',    // Codex 免疫检查 → US (Codex CLI)
  'code_review': 'us', // 代码审查 → US (Claude + /code-review skill)
  'decomp_review': 'us', // 拆解审查 → US (Vivian, claude-haiku)
  'dept_heartbeat': 'us', // 部门心跳 → US (MiniMax-M2.5-highspeed via cecelia-run)
  'initiative_plan': 'us',      // Initiative 规划 → US (Opus)
  'initiative_verify': 'us',    // Initiative 验收 → US (Opus)
  'suggestion_plan': 'us',      // Suggestion 层级识别 → US (Sonnet + /plan)
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
  return VALID_TASK_TYPES.includes(taskType?.toLowerCase());
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
  if (location && !['us', 'hk'].includes(location.toLowerCase())) {
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

  return routing;
}

export {
  identifyWorkType,
  getTaskLocation,
  determineExecutionMode,
  routeTaskCreate,
  routeTaskWithFallback,
  detectRoutingFailure,
  getFallbackStrategy,
  isValidTaskType,
  isValidLocation,
  getValidTaskTypes,
  getLocationsForTaskTypes,
  LOCATION_MAP,
  SINGLE_TASK_PATTERNS,
  FEATURE_PATTERNS,
  DEFAULT_LOCATION,
  VALID_TASK_TYPES,
  SKILL_WHITELIST,
  FALLBACK_STRATEGIES
};
