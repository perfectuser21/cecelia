/**
 * OKR Tick - OKR State Machine
 * Manages OKR status transitions and triggers planner for decomposition
 */

import pool from './db.js';
import { emit } from './event-bus.js';

// OKR Tick configuration
const OKR_TICK_INTERVAL_MS = parseInt(process.env.CECELIA_OKR_TICK_INTERVAL_MS || '300000', 10); // 5 minutes

// OKR status values
const OKR_STATUS = {
  PENDING: 'pending',
  NEEDS_INFO: 'needs_info',
  READY: 'ready',
  DECOMPOSING: 'decomposing',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

// Loop state
let _okrLoopTimer = null;
let _okrTickRunning = false;

/**
 * Get goals by status
 * @param {string} status - Status to filter by
 * @returns {Array} - Array of goal objects
 */
async function getGoalsByStatus(status) {
  const result = await pool.query(`
    SELECT id, title, description, status, priority, progress, metadata, parent_id, project_id
    FROM goals
    WHERE status = $1
    ORDER BY priority ASC, created_at ASC
  `, [status]);
  return result.rows;
}

/**
 * Update goal status
 * @param {string} goalId - Goal UUID
 * @param {string} newStatus - New status value
 */
async function updateGoalStatus(goalId, newStatus) {
  await pool.query(`
    UPDATE goals
    SET status = $2, updated_at = NOW()
    WHERE id = $1
  `, [goalId, newStatus]);

  await emit('goal_status_changed', 'okr-tick', {
    goal_id: goalId,
    new_status: newStatus
  });
}

/**
 * Check if all pending questions in goal metadata are answered
 * @param {Object} goal - Goal object with metadata
 * @returns {boolean}
 */
function areAllQuestionsAnswered(goal) {
  const questions = goal.metadata?.pending_questions;
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return true; // No questions = all answered
  }
  return questions.every(q => q.answered === true);
}

/**
 * Get goals with all questions answered (ready to transition from needs_info)
 * @returns {Array}
 */
async function getGoalsWithAnsweredQuestions() {
  const needsInfoGoals = await getGoalsByStatus(OKR_STATUS.NEEDS_INFO);
  return needsInfoGoals.filter(areAllQuestionsAnswered);
}

/**
 * Trigger planner for goal decomposition
 * Calls Autumnrice to decompose the goal into tasks
 * @param {Object} goal - Goal to decompose
 */
async function triggerPlannerForGoal(goal) {
  console.log(`[okr-tick] Triggering Autumnrice for goal: ${goal.title} (${goal.id})`);

  // Emit event for monitoring
  await emit('goal_ready_for_decomposition', 'okr-tick', {
    goal_id: goal.id,
    title: goal.title,
    priority: goal.priority,
    description: goal.description
  });

  // Build the prompt for Autumnrice
  const prompt = `/autumnrice 拆解目标

## Goal 信息
- ID: ${goal.id}
- 标题: ${goal.title}
- 描述: ${goal.description || '无'}
- 优先级: ${goal.priority}
- 项目ID: ${goal.project_id || '未指定'}

## 要求
1. 分析这个目标，拆解成具体可执行的 Tasks
2. 每个 Task 必须指定 task_type (dev/automation/qa/audit/research)
3. 每个 Task 必须关联 goal_id = ${goal.id}
4. 通过 Brain API 创建 Tasks: POST http://localhost:5221/api/brain/action/create-task
5. 完成后更新 Goal 状态为 in_progress

## Brain API 创建 Task 格式
curl -X POST http://localhost:5221/api/brain/action/create-task \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "任务标题",
    "task_type": "dev",
    "goal_id": "${goal.id}",
    "priority": "${goal.priority}",
    "context": "任务描述"
  }'
`;

  // Call Autumnrice Bridge (runs on host, port 5225)
  const bridgeUrl = process.env.AUTUMNRICE_BRIDGE_URL || 'http://localhost:5225/trigger';

  try {
    const response = await fetch(bridgeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal_id: goal.id,
        title: goal.title,
        description: goal.description,
        priority: goal.priority,
        project_id: goal.project_id,
        prompt
      })
    });

    const result = await response.json();
    console.log(`[okr-tick] Autumnrice triggered for goal ${goal.id}: ${JSON.stringify(result)}`);

    return {
      triggered: result.success,
      goal_id: goal.id,
      title: goal.title,
      pid: result.pid,
      log_file: result.log_file
    };
  } catch (err) {
    console.error(`[okr-tick] Failed to trigger Autumnrice: ${err.message}`);
    return {
      triggered: false,
      goal_id: goal.id,
      title: goal.title,
      error: err.message
    };
  }
}

/**
 * Execute OKR Tick - the OKR state machine loop
 *
 * 1. Check for goals with status='ready' and start decomposition
 * 2. Check for goals with status='needs_info' where all questions are answered
 */
async function executeOkrTick() {
  const actionsTaken = [];

  // 1. Process 'ready' goals - trigger decomposition
  const readyGoals = await getGoalsByStatus(OKR_STATUS.READY);

  for (const goal of readyGoals) {
    try {
      // Mark as decomposing
      await updateGoalStatus(goal.id, OKR_STATUS.DECOMPOSING);

      // Trigger planner
      const result = await triggerPlannerForGoal(goal);

      actionsTaken.push({
        action: 'decompose_goal',
        goal_id: goal.id,
        title: goal.title,
        result
      });
    } catch (err) {
      console.error(`[okr-tick] Failed to decompose goal ${goal.id}:`, err.message);
      // Revert to ready status on failure
      await updateGoalStatus(goal.id, OKR_STATUS.READY);
    }
  }

  // 2. Process 'needs_info' goals with all questions answered
  const answeredGoals = await getGoalsWithAnsweredQuestions();

  for (const goal of answeredGoals) {
    await updateGoalStatus(goal.id, OKR_STATUS.READY);

    actionsTaken.push({
      action: 'promote_to_ready',
      goal_id: goal.id,
      title: goal.title,
      reason: 'all_questions_answered'
    });
  }

  return {
    success: true,
    ready_goals_processed: readyGoals.length,
    needs_info_promoted: answeredGoals.length,
    actions_taken: actionsTaken
  };
}

/**
 * Run OKR tick safely with reentry guard
 */
async function runOkrTickSafe() {
  if (_okrTickRunning) {
    console.log('[okr-tick] Already running, skipping');
    return { skipped: true, reason: 'already_running' };
  }

  _okrTickRunning = true;

  try {
    const result = await executeOkrTick();
    console.log(`[okr-tick] Completed, actions: ${result.actions_taken.length}`);
    return result;
  } catch (err) {
    console.error('[okr-tick] Failed:', err.message);
    return { success: false, error: err.message };
  } finally {
    _okrTickRunning = false;
  }
}

/**
 * Start OKR tick loop
 */
function startOkrTickLoop() {
  if (_okrLoopTimer) {
    console.log('[okr-tick] Loop already running');
    return false;
  }

  _okrLoopTimer = setInterval(async () => {
    try {
      await runOkrTickSafe();
    } catch (err) {
      console.error('[okr-tick] Unexpected error in loop:', err.message);
    }
  }, OKR_TICK_INTERVAL_MS);

  if (_okrLoopTimer.unref) {
    _okrLoopTimer.unref();
  }

  console.log(`[okr-tick] Started (interval: ${OKR_TICK_INTERVAL_MS}ms)`);
  return true;
}

/**
 * Stop OKR tick loop
 */
function stopOkrTickLoop() {
  if (!_okrLoopTimer) {
    console.log('[okr-tick] No loop running');
    return false;
  }

  clearInterval(_okrLoopTimer);
  _okrLoopTimer = null;
  console.log('[okr-tick] Stopped');
  return true;
}

/**
 * Get OKR tick status
 */
function getOkrTickStatus() {
  return {
    loop_running: _okrLoopTimer !== null,
    interval_ms: OKR_TICK_INTERVAL_MS,
    tick_running: _okrTickRunning
  };
}

/**
 * Add a question to a goal's pending_questions
 * @param {string} goalId - Goal UUID
 * @param {string} question - Question text
 */
async function addQuestionToGoal(goalId, question) {
  const questionId = `q-${Date.now()}`;

  await pool.query(`
    UPDATE goals
    SET
      metadata = COALESCE(metadata, '{}'::jsonb) ||
        jsonb_build_object(
          'pending_questions',
          COALESCE(metadata->'pending_questions', '[]'::jsonb) ||
            jsonb_build_array(jsonb_build_object(
              'id', $2::text,
              'question', $3::text,
              'answered', false,
              'answer', NULL::text
            ))
        ),
      status = $4,
      updated_at = NOW()
    WHERE id = $1
  `, [goalId, questionId, question, OKR_STATUS.NEEDS_INFO]);

  return { question_id: questionId, goal_id: goalId };
}

/**
 * Answer a question for a goal
 * @param {string} goalId - Goal UUID
 * @param {string} questionId - Question ID
 * @param {string} answer - Answer text
 */
async function answerQuestionForGoal(goalId, questionId, answer) {
  // Get current metadata
  const result = await pool.query(
    'SELECT metadata FROM goals WHERE id = $1',
    [goalId]
  );

  if (result.rows.length === 0) {
    throw new Error('Goal not found');
  }

  const metadata = result.rows[0].metadata || {};
  const questions = metadata.pending_questions || [];

  // Find and update the question
  const questionIndex = questions.findIndex(q => q.id === questionId);
  if (questionIndex === -1) {
    throw new Error('Question not found');
  }

  questions[questionIndex].answered = true;
  questions[questionIndex].answer = answer;
  metadata.pending_questions = questions;

  // Update goal
  await pool.query(`
    UPDATE goals
    SET metadata = $2, updated_at = NOW()
    WHERE id = $1
  `, [goalId, metadata]);

  return { success: true, question_id: questionId, goal_id: goalId };
}

/**
 * Get pending questions for a goal
 * @param {string} goalId - Goal UUID
 */
async function getPendingQuestions(goalId) {
  const result = await pool.query(
    'SELECT metadata FROM goals WHERE id = $1',
    [goalId]
  );

  if (result.rows.length === 0) {
    throw new Error('Goal not found');
  }

  const metadata = result.rows[0].metadata || {};
  return metadata.pending_questions || [];
}

export {
  executeOkrTick,
  runOkrTickSafe,
  startOkrTickLoop,
  stopOkrTickLoop,
  getOkrTickStatus,
  getGoalsByStatus,
  updateGoalStatus,
  addQuestionToGoal,
  answerQuestionForGoal,
  getPendingQuestions,
  areAllQuestionsAnswered,
  OKR_STATUS,
  OKR_TICK_INTERVAL_MS
};
