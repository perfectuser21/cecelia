/**
 * OKR Tick - OKR State Machine
 * Manages OKR question status transitions; legacy decomposition is retired
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
 * Get key_results by status（新 OKR 表：key_results）
 * @param {string|string[]} status - Status or array of statuses to filter by
 * @returns {Array} - Array of key_result objects
 */
async function getGoalsByStatus(status) {
  const statuses = Array.isArray(status) ? status : [status];
  const placeholders = statuses.map((_, i) => `$${i + 1}`).join(', ');
  const result = await pool.query(`
    SELECT id, title, description, status, NULL::text AS priority,
           NULL::numeric AS progress, metadata, objective_id AS parent_id, NULL::uuid AS project_id
    FROM key_results
    WHERE status IN (${placeholders})
    ORDER BY created_at ASC
  `, statuses);
  return result.rows;
}

/**
 * Update key_result status（新 OKR 表：key_results）
 * @param {string} goalId - KR UUID
 * @param {string} newStatus - New status value
 */
async function updateGoalStatus(goalId, newStatus) {
  await pool.query(`
    UPDATE key_results
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

/** 保留调用合同：旧 OKR 拆解已退役，不创建任务、不修改 KR。 */
async function triggerPlannerForGoal(goal) {
  return { triggered: false, reason: 'decomposition_retired', goal_id: goal.id, title: goal.title };
}

/**
 * Execute OKR Tick - the OKR state machine loop
 *
 * Check goals with status='needs_info' where all questions are answered
 */
async function executeOkrTick() {
  const actionsTaken = [];

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
    ready_goals_processed: 0,
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
 * Add a question to a key_result's pending_questions（新 OKR 表：key_results）
 * @param {string} goalId - KR UUID
 * @param {string} question - Question text
 */
async function addQuestionToGoal(goalId, question) {
  const questionId = `q-${Date.now()}`;

  await pool.query(`
    UPDATE key_results
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
 * Answer a question for a key_result（新 OKR 表：key_results）
 * @param {string} goalId - KR UUID
 * @param {string} questionId - Question ID
 * @param {string} answer - Answer text
 */
async function answerQuestionForGoal(goalId, questionId, answer, db = pool) {
  // Get current metadata
  const result = await db.query(
    'SELECT metadata FROM key_results WHERE id = $1',
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

  // Update key_result metadata
  await db.query(`
    UPDATE key_results
    SET metadata = jsonb_set(COALESCE(metadata,'{}'::jsonb), '{pending_questions}', $2::jsonb, true), updated_at = NOW()
    WHERE id = $1
  `, [goalId, JSON.stringify(questions)]);

  return { success: true, question_id: questionId, goal_id: goalId };
}

/**
 * Get pending questions for a key_result（新 OKR 表：key_results）
 * @param {string} goalId - KR UUID
 */
async function getPendingQuestions(goalId) {
  const result = await pool.query(
    'SELECT metadata FROM key_results WHERE id = $1',
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
  triggerPlannerForGoal,
  addQuestionToGoal,
  answerQuestionForGoal,
  getPendingQuestions,
  areAllQuestionsAnswered,
  OKR_STATUS,
  OKR_TICK_INTERVAL_MS
};
