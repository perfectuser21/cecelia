/** 显式KR问题与回答台账；状态由调用方管理。 */
import pool from './db.js';

const OKR_STATUS = {
  PENDING: 'pending',
  NEEDS_INFO: 'needs_info',
  READY: 'ready',
  DECOMPOSING: 'decomposing',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

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

export { addQuestionToGoal, answerQuestionForGoal, getPendingQuestions, OKR_STATUS };
