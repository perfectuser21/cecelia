/**
 * Feature Tick - Feature State Machine
 * Implements "边做边拆" (decompose while executing) for multi-task Features
 *
 * Feature Status Flow:
 * planning → task_created → task_running → task_completed → evaluating → (loop or completed)
 */

import pool from './db.js';
import { emit } from './event-bus.js';
import { checkAntiCrossing, validateTaskCompletion } from './anti-crossing.js';
import { getTaskLocation, identifyWorkType } from './task-router.js';

// Feature Tick configuration
const FEATURE_TICK_INTERVAL_MS = parseInt(process.env.CECELIA_FEATURE_TICK_INTERVAL_MS || '30000', 10); // 30 seconds

// Feature status values
const FEATURE_STATUS = {
  PLANNING: 'planning',
  TASK_CREATED: 'task_created',
  TASK_RUNNING: 'task_running',
  TASK_COMPLETED: 'task_completed',
  EVALUATING: 'evaluating',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

// Loop state
let _featureLoopTimer = null;
let _featureTickRunning = false;

/**
 * Get features by status
 * @param {string} status - Status to filter by
 * @returns {Promise<Array>} - Array of feature objects
 */
async function getFeaturesByStatus(status) {
  const result = await pool.query(`
    SELECT id, title, description, prd, goal_id, project_id, status,
           active_task_id, current_pr_number, created_at, updated_at
    FROM features
    WHERE status = $1
    ORDER BY created_at ASC
  `, [status]);
  return result.rows;
}

/**
 * Get a single feature by ID
 * @param {string} featureId - Feature UUID
 * @returns {Promise<Object|null>}
 */
async function getFeature(featureId) {
  const result = await pool.query(
    'SELECT * FROM features WHERE id = $1',
    [featureId]
  );
  return result.rows[0] || null;
}

/**
 * Update feature status and fields
 * @param {string} featureId - Feature UUID
 * @param {Object} updates - Fields to update
 */
async function updateFeature(featureId, updates) {
  const fields = [];
  const values = [featureId];
  let paramIndex = 2;

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'status') {
      fields.push(`status = $${paramIndex}`);
    } else if (key === 'active_task_id') {
      fields.push(`active_task_id = $${paramIndex}`);
    } else if (key === 'current_pr_number') {
      fields.push(`current_pr_number = $${paramIndex}`);
    } else if (key === 'completed_at') {
      fields.push(`completed_at = $${paramIndex}`);
    }
    values.push(value);
    paramIndex++;
  }

  if (fields.length === 0) return;

  fields.push('updated_at = NOW()');

  await pool.query(`
    UPDATE features
    SET ${fields.join(', ')}
    WHERE id = $1
  `, values);

  await emit('feature_updated', 'feature-tick', {
    feature_id: featureId,
    updates
  });
}

/**
 * Get completed tasks for a feature
 * @param {string} featureId - Feature UUID
 * @returns {Promise<Array>}
 */
async function getCompletedTasks(featureId) {
  const result = await pool.query(`
    SELECT id, title, status, summary, artifact_ref, quality_gate,
           created_at, completed_at
    FROM tasks
    WHERE feature_id = $1 AND status = 'completed'
    ORDER BY completed_at ASC
  `, [featureId]);
  return result.rows;
}

/**
 * Create a task for a feature
 * @param {Object} taskData - Task data including feature_id
 * @returns {Promise<Object>} - Created task
 */
async function createFeatureTask(taskData) {
  const {
    title,
    feature_id,
    task_type = 'dev',
    priority = 'P1',
    context,
    goal_id,
    project_id
  } = taskData;

  // Anti-crossing check: ensure feature has no active task
  const antiCrossCheck = await checkAntiCrossing(feature_id);
  if (!antiCrossCheck.allowed) {
    throw new Error(`Anti-crossing violation: ${antiCrossCheck.reason}`);
  }

  // Determine location based on task_type
  const location = getTaskLocation(task_type);

  const result = await pool.query(`
    INSERT INTO tasks (
      title, feature_id, execution_mode, task_type, location,
      priority, context, goal_id, project_id, status, quality_gate
    )
    VALUES ($1, $2, 'feature_task', $3, $4, $5, $6, $7, $8, 'queued', 'pending')
    RETURNING *
  `, [title, feature_id, task_type, location, priority, context, goal_id, project_id]);

  const task = result.rows[0];

  await emit('feature_task_created', 'feature-tick', {
    task_id: task.id,
    feature_id,
    title,
    task_type,
    location
  });

  return task;
}

/**
 * Plan the first task for a feature (calls Autumnrice)
 * @param {Object} feature - Feature object
 */
async function planFirstTask(feature) {
  console.log(`[feature-tick] Planning first task for feature: ${feature.title}`);

  // Build prompt for Autumnrice
  const prompt = `/autumnrice 规划 Feature 第一个 Task

## Feature 信息
- ID: ${feature.id}
- 标题: ${feature.title}
- 描述: ${feature.description || '无'}
- PRD: ${feature.prd || '无'}
- Goal ID: ${feature.goal_id || '未指定'}
- Project ID: ${feature.project_id || '未指定'}

## 要求
1. 分析 Feature PRD，规划第一个可执行的 Task
2. Task 必须是独立可完成的，有明确验收标准
3. 返回 JSON 格式：
{
  "title": "任务标题",
  "task_type": "dev",
  "priority": "P1",
  "context": "任务描述和验收标准"
}
`;

  // Call Autumnrice Bridge
  const bridgeUrl = process.env.AUTUMNRICE_BRIDGE_URL || 'http://localhost:5225/trigger';

  try {
    const response = await fetch(bridgeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'plan_first_task',
        feature_id: feature.id,
        feature_prd: feature.prd,
        prompt
      })
    });

    const result = await response.json();

    if (result.success && result.task) {
      // Create the task
      const task = await createFeatureTask({
        ...result.task,
        feature_id: feature.id,
        goal_id: feature.goal_id,
        project_id: feature.project_id
      });

      // Update feature status
      await updateFeature(feature.id, {
        status: FEATURE_STATUS.TASK_CREATED,
        active_task_id: task.id
      });

      return { success: true, task };
    } else {
      console.error(`[feature-tick] Autumnrice failed to plan task: ${result.error || 'unknown error'}`);
      return { success: false, error: result.error };
    }
  } catch (err) {
    console.error(`[feature-tick] Failed to call Autumnrice: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Evaluate completed task and plan next task (calls Autumnrice)
 * @param {Object} feature - Feature object
 */
async function evaluateAndPlanNext(feature) {
  console.log(`[feature-tick] Evaluating feature: ${feature.title}`);

  // Get completed tasks
  const completedTasks = await getCompletedTasks(feature.id);

  // Build prompt for Autumnrice
  const prompt = `/autumnrice 评估 Feature 并规划下一步

## Feature 信息
- ID: ${feature.id}
- 标题: ${feature.title}
- PRD: ${feature.prd || '无'}
- 当前 PR 数: ${feature.current_pr_number}

## 已完成的 Tasks
${completedTasks.map(t => `
- [${t.id}] ${t.title}
  状态: ${t.status}
  摘要: ${t.summary || '无'}
  产物: ${t.artifact_ref || '无'}
  质量门: ${t.quality_gate}
`).join('\n')}

## 要求
1. 评估当前进度，判断 Feature 是否已完成
2. 如果未完成，规划下一个 Task
3. 返回 JSON 格式：
{
  "feature_completed": false,
  "completion_reason": "如果完成，说明原因",
  "next_task": {
    "title": "任务标题",
    "task_type": "dev",
    "priority": "P1",
    "context": "任务描述和验收标准"
  }
}
`;

  // Call Autumnrice Bridge
  const bridgeUrl = process.env.AUTUMNRICE_BRIDGE_URL || 'http://localhost:5225/trigger';

  try {
    const response = await fetch(bridgeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'evaluate_and_plan',
        feature_id: feature.id,
        feature_prd: feature.prd,
        completed_tasks: completedTasks,
        prompt
      })
    });

    const result = await response.json();

    if (!result.success) {
      console.error(`[feature-tick] Autumnrice evaluation failed: ${result.error}`);
      return { success: false, error: result.error };
    }

    if (result.feature_completed) {
      // Feature is complete
      await updateFeature(feature.id, {
        status: FEATURE_STATUS.COMPLETED,
        completed_at: new Date().toISOString()
      });

      await emit('feature_completed', 'feature-tick', {
        feature_id: feature.id,
        title: feature.title,
        tasks_completed: completedTasks.length,
        reason: result.completion_reason
      });

      return { success: true, completed: true, reason: result.completion_reason };
    } else {
      // Plan next task
      const task = await createFeatureTask({
        ...result.next_task,
        feature_id: feature.id,
        goal_id: feature.goal_id,
        project_id: feature.project_id
      });

      // Update feature
      await updateFeature(feature.id, {
        status: FEATURE_STATUS.TASK_CREATED,
        active_task_id: task.id,
        current_pr_number: feature.current_pr_number + 1
      });

      return { success: true, completed: false, task };
    }
  } catch (err) {
    console.error(`[feature-tick] Failed to evaluate: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Handle task completion for a feature task
 * Called when a task with feature_id completes
 * @param {string} taskId - Task UUID
 * @param {Object} result - Task result (summary, artifact_ref, quality_gate)
 */
async function handleFeatureTaskComplete(taskId, result) {
  // Validate task completion (anti-crossing check)
  const validation = await validateTaskCompletion(taskId);
  if (!validation.valid) {
    throw new Error(`Task completion validation failed: ${validation.reason}`);
  }

  const { task, feature } = validation;

  // Update task with result
  await pool.query(`
    UPDATE tasks
    SET status = 'completed',
        summary = $2,
        artifact_ref = $3,
        quality_gate = $4,
        completed_at = NOW()
    WHERE id = $1
  `, [taskId, result.summary, result.artifact_ref, result.quality_gate || 'pass']);

  // Update feature status
  await updateFeature(feature.id, {
    status: FEATURE_STATUS.TASK_COMPLETED,
    active_task_id: null
  });

  await emit('feature_task_completed', 'feature-tick', {
    task_id: taskId,
    feature_id: feature.id,
    summary: result.summary
  });

  return { success: true, feature_id: feature.id };
}

/**
 * Execute Feature Tick - the feature state machine loop
 *
 * 1. Process 'planning' features - plan first task
 * 2. Process 'task_completed' features - evaluate and plan next
 */
async function executeFeatureTick() {
  const actionsTaken = [];

  // 1. Process 'planning' features
  const planningFeatures = await getFeaturesByStatus(FEATURE_STATUS.PLANNING);

  for (const feature of planningFeatures) {
    try {
      const result = await planFirstTask(feature);
      actionsTaken.push({
        action: 'plan_first_task',
        feature_id: feature.id,
        title: feature.title,
        success: result.success,
        task_id: result.task?.id
      });
    } catch (err) {
      console.error(`[feature-tick] Failed to plan first task for ${feature.id}:`, err.message);
      actionsTaken.push({
        action: 'plan_first_task',
        feature_id: feature.id,
        title: feature.title,
        success: false,
        error: err.message
      });
    }
  }

  // 2. Process 'task_completed' features
  const completedFeatures = await getFeaturesByStatus(FEATURE_STATUS.TASK_COMPLETED);

  for (const feature of completedFeatures) {
    try {
      // First update to evaluating
      await updateFeature(feature.id, { status: FEATURE_STATUS.EVALUATING });

      const result = await evaluateAndPlanNext(feature);
      actionsTaken.push({
        action: 'evaluate_and_plan',
        feature_id: feature.id,
        title: feature.title,
        success: result.success,
        completed: result.completed,
        task_id: result.task?.id
      });
    } catch (err) {
      console.error(`[feature-tick] Failed to evaluate ${feature.id}:`, err.message);
      // Revert to task_completed on failure
      await updateFeature(feature.id, { status: FEATURE_STATUS.TASK_COMPLETED });
      actionsTaken.push({
        action: 'evaluate_and_plan',
        feature_id: feature.id,
        title: feature.title,
        success: false,
        error: err.message
      });
    }
  }

  return {
    success: true,
    planning_processed: planningFeatures.length,
    completed_processed: completedFeatures.length,
    actions_taken: actionsTaken
  };
}

/**
 * Run feature tick safely with reentry guard
 */
async function runFeatureTickSafe() {
  if (_featureTickRunning) {
    console.log('[feature-tick] Already running, skipping');
    return { skipped: true, reason: 'already_running' };
  }

  _featureTickRunning = true;

  try {
    const result = await executeFeatureTick();
    console.log(`[feature-tick] Completed, actions: ${result.actions_taken.length}`);
    return result;
  } catch (err) {
    console.error('[feature-tick] Failed:', err.message);
    return { success: false, error: err.message };
  } finally {
    _featureTickRunning = false;
  }
}

/**
 * Start feature tick loop
 */
function startFeatureTickLoop() {
  if (_featureLoopTimer) {
    console.log('[feature-tick] Loop already running');
    return false;
  }

  _featureLoopTimer = setInterval(async () => {
    try {
      await runFeatureTickSafe();
    } catch (err) {
      console.error('[feature-tick] Unexpected error in loop:', err.message);
    }
  }, FEATURE_TICK_INTERVAL_MS);

  if (_featureLoopTimer.unref) {
    _featureLoopTimer.unref();
  }

  console.log(`[feature-tick] Started (interval: ${FEATURE_TICK_INTERVAL_MS}ms)`);
  return true;
}

/**
 * Stop feature tick loop
 */
function stopFeatureTickLoop() {
  if (!_featureLoopTimer) {
    console.log('[feature-tick] No loop running');
    return false;
  }

  clearInterval(_featureLoopTimer);
  _featureLoopTimer = null;
  console.log('[feature-tick] Stopped');
  return true;
}

/**
 * Get feature tick status
 */
function getFeatureTickStatus() {
  return {
    loop_running: _featureLoopTimer !== null,
    interval_ms: FEATURE_TICK_INTERVAL_MS,
    tick_running: _featureTickRunning
  };
}

/**
 * Create a new feature
 * @param {Object} featureData - Feature data
 * @returns {Promise<Object>} - Created feature
 */
async function createFeature(featureData) {
  const { title, description, prd, goal_id, project_id } = featureData;

  const result = await pool.query(`
    INSERT INTO features (title, description, prd, goal_id, project_id, status)
    VALUES ($1, $2, $3, $4, $5, 'planning')
    RETURNING *
  `, [title, description, prd, goal_id, project_id]);

  const feature = result.rows[0];

  await emit('feature_created', 'feature-tick', {
    feature_id: feature.id,
    title,
    goal_id,
    project_id
  });

  return feature;
}

export {
  executeFeatureTick,
  runFeatureTickSafe,
  startFeatureTickLoop,
  stopFeatureTickLoop,
  getFeatureTickStatus,
  getFeaturesByStatus,
  getFeature,
  updateFeature,
  createFeature,
  createFeatureTask,
  getCompletedTasks,
  planFirstTask,
  evaluateAndPlanNext,
  handleFeatureTaskComplete,
  FEATURE_STATUS,
  FEATURE_TICK_INTERVAL_MS
};
