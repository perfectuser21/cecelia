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
import { handleIntervention } from './harness-intervention-handler.js';
import {
  VALID_TASK_TYPES, ASYNC_CALLBACK_TASK_TYPES,
  SKILL_WHITELIST as SKILL_WHITELIST_REGISTRY,
  LOCATION_MAP as LOCATION_MAP_REGISTRY,
  TASK_REQUIREMENTS as TASK_REQUIREMENTS_REGISTRY,
} from './lib/task-type-registry.js';

// Valid task types (for failure detection) — 名单见 lib/task-type-registry.js（VALID_TASK_TYPES）。
// 注：harness_planner 已退役（PR retire-harness-planner，2026-04-26），
// subsumed by harness_initiative full graph；触达即被 _RETIRED_HARNESS_TYPES
// 标 terminal_failure（见 executor.js）。下方多处"见 VALID_TASK_TYPES 注释"指的就是这段。

// 支持 P2P 异步回调的任务类型
// 当飞书 P2P 创建这些类型的任务后，自动注册 task_interest 订阅，任务完成时回调用户
// 扩展新能力：改 lib/task-type-registry.js 的 ASYNC_CALLBACK_TASK_TYPES 派生集合，无需改 ops.js
const ASYNC_CALLBACK_TYPES = new Set(ASYNC_CALLBACK_TASK_TYPES);

// Skill whitelist based on task type — 名单见 lib/task-type-registry.js（SKILL_WHITELIST）。
const SKILL_WHITELIST = SKILL_WHITELIST_REGISTRY;

// Internal task handlers — Brain tick 内联处理的 task_type（skill='/_internal'），
// 不派外部 agent，由 Brain 进程内的 handler 函数直接处理。
// WS5: harness_intervention → harness-intervention-handler（读 Docker logs + LLM 分析 → retry/skip/alert）
const INTERNAL_TASK_HANDLERS = {
  'harness_intervention': handleIntervention,
};

/**
 * 查询某个 task_type 对应的 Brain 内联 handler。
 * @param {string} taskType
 * @returns {Function|null} handler 函数，未注册则返回 null
 */
function getInternalTaskHandler(taskType) {
  if (!taskType || typeof taskType !== 'string') return null;
  return INTERNAL_TASK_HANDLERS[taskType.toLowerCase()] || null;
}

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

// Location mapping based on task_type — 名单见 lib/task-type-registry.js（LOCATION_MAP）。
// US = Claude Code (Opus/Sonnet), HK = MiniMax + N8N
const LOCATION_MAP = LOCATION_MAP_REGISTRY;

// Default location
const DEFAULT_LOCATION = 'us';

// Capability requirements per task type (machine registry routing) — 名单见 lib/task-type-registry.js（TASK_REQUIREMENTS）。
// Tags: 'has_git' = needs code/git access (US M4 only)
//       'general' = any available machine
//       'has_browser' = needs browser/CDP access
const TASK_REQUIREMENTS = TASK_REQUIREMENTS_REGISTRY;

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
function getTaskLocation(taskTypeOrTask) {
  // 对象入参：task.location DB 字段优先（非 null/undefined 才覆盖）
  if (taskTypeOrTask && typeof taskTypeOrTask === 'object') {
    if (taskTypeOrTask.location != null) {
      return taskTypeOrTask.location;
    }
    // 对象但无 location 字段 → 回退到 task_type 静态映射
    const taskType = taskTypeOrTask.task_type;
    return LOCATION_MAP[taskType?.toLowerCase()] || DEFAULT_LOCATION;
  }
  // 原有字符串签名：零回归
  if (!taskTypeOrTask || typeof taskTypeOrTask !== 'string') {
    return DEFAULT_LOCATION;
  }
  return LOCATION_MAP[taskTypeOrTask.toLowerCase()] || DEFAULT_LOCATION;
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

  const _workType = identifyWorkType(input);

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

/** 诊断 KR 下 Project 的直接任务，不再读取退役层。 */
async function diagnoseKR(krId, pool) {
  const krResult = await pool.query(
    `SELECT id, title, status, priority, progress_pct AS progress FROM key_results WHERE id = $1`, [krId]
  );
  if (krResult.rows.length === 0) return null;
  const kr = krResult.rows[0];
  const projectsResult = await pool.query(
    `SELECT id, name, status, created_at FROM projects WHERE kr_id = $1 ORDER BY created_at ASC`, [krId]
  );
  const projects = [];
  const dispatchBlockers = [];
  for (const project of projectsResult.rows) {
    const statsResult = await pool.query(
      `SELECT COUNT(*) AS task_count,
              COUNT(*) FILTER (WHERE status IN ('queued','in_progress')) AS active_task_count,
              COUNT(*) FILTER (WHERE status = 'completed') AS completed_task_count,
              COUNT(*) FILTER (WHERE status IN ('failed','cancelled')) AS failed_task_count
       FROM tasks WHERE project_id = $1 AND task_type <> 'project'`, [project.id]
    );
    const counts = statsResult.rows[0] || {};
    const taskCount = Number(counts.task_count || 0);
    const activeTaskCount = Number(counts.active_task_count || 0);
    const completedTaskCount = Number(counts.completed_task_count || 0);
    const failedTaskCount = Number(counts.failed_task_count || 0);
    const taskResult = await pool.query(
      `SELECT id, title, task_type, status, priority, created_at, updated_at
       FROM tasks WHERE project_id = $1 AND task_type <> 'project' ORDER BY created_at DESC LIMIT 10`, [project.id]
    );
    let reason = null;
    let detail = '';
    if (project.status === 'active') {
      if (taskCount === 0) {
        reason = 'no_tasks_created'; detail = '该 Project 下没有 Task，需要拆解项目';
      } else if (activeTaskCount === 0) {
        if (completedTaskCount === taskCount) {
          reason = 'all_tasks_completed_project_still_active'; detail = '任务全部完成，Project 仍需验收关闭';
        } else if (failedTaskCount === taskCount) {
          reason = 'all_tasks_failed'; detail = '任务全部失败，需要重新规划';
        } else {
          reason = 'no_active_tasks'; detail = '项目有任务但无 queued/in_progress 任务';
        }
      }
    }
    if (reason) dispatchBlockers.push({ project_id: project.id, project_name: project.name, reason, detail });
    projects.push({
      ...project, task_count: taskCount, active_task_count: activeTaskCount,
      completed_task_count: completedTaskCount, failed_task_count: failedTaskCount,
      tasks: taskResult.rows.map(task => ({
        ...task, routing: routeTaskCreate({ title: task.title, task_type: task.task_type, kr_id: krId, project_id: project.id })
      }))
    });
  }
  return {
    kr_id: kr.id, kr_title: kr.title, kr_status: kr.status,
    kr_priority: kr.priority ?? null, kr_progress: kr.progress ?? null,
    summary: {
      total_projects: projects.length,
      active_projects: projects.filter(project => project.status === 'active').length,
      projects_with_active_tasks: projects.filter(project => project.active_task_count > 0).length,
      dispatch_blocker_count: dispatchBlockers.length,
      diagnosis: dispatchBlockers.length === 0 ? 'healthy' : 'blocked'
    },
    dispatch_blockers: dispatchBlockers, projects
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
  ASYNC_CALLBACK_TYPES,
  INTERNAL_TASK_HANDLERS,
  getInternalTaskHandler
};
