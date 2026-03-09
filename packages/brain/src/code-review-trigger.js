/**
 * 小任务积累触发器
 *
 * 当同一 project 下 7 天内完成的 dev 任务数 >= 阈值，
 * 且无 pending code_review 任务时，自动创建 code_review 任务。
 *
 * 调用方：execution-callback（routes.js）
 * 调用方式：fire-and-forget，不阻塞主流程
 */

const ACCUMULATION_THRESHOLD = 5; // N 个 dev 任务完成后触发
const WINDOW_DAYS = 7;             // 统计窗口（天）

/**
 * 检查是否需要触发 code_review，需要时自动创建任务
 *
 * @param {import('pg').Pool} pool - DB pool
 * @param {string} projectId - 任务所属的 project_id
 * @returns {Promise<object|null>} 创建的任务行，或 null（未触发/已存在/出错）
 */
export async function checkAndCreateCodeReviewTrigger(pool, projectId) {
  if (!projectId) return null;

  try {
    // Fix 1: initiative 类型 project 有自己的 pipeline（断链#5），不走积累触发
    const projectTypeResult = await pool.query(
      'SELECT type FROM projects WHERE id = $1',
      [projectId]
    );
    const projectType = projectTypeResult.rows[0]?.type;
    if (projectType === 'initiative') {
      console.log(`[code-review-trigger] project=${projectId} type=initiative, skip accumulation trigger (use pipeline instead)`);
      return null;
    }

    // 统计窗口内完成的 dev 任务数
    const countResult = await pool.query(
      `SELECT COUNT(*) AS cnt FROM tasks
       WHERE project_id = $1
         AND task_type = 'dev'
         AND status = 'completed'
         AND completed_at > NOW() - INTERVAL '${WINDOW_DAYS} days'`,
      [projectId]
    );

    const count = parseInt(countResult.rows[0]?.cnt ?? '0', 10);
    if (count < ACCUMULATION_THRESHOLD) return null;

    // 检查是否已有活跃的 code_review 任务（覆盖所有非终态状态，含 pending）
    const existingResult = await pool.query(
      `SELECT id FROM tasks
       WHERE project_id = $1
         AND task_type = 'code_review'
         AND status NOT IN ('completed', 'failed', 'cancelled', 'completed_no_pr')
       LIMIT 1`,
      [projectId]
    );

    if (existingResult.rows.length > 0) return null;

    // 创建 code_review 任务
    const insertResult = await pool.query(
      `INSERT INTO tasks (title, task_type, priority, project_id, status, trigger_source)
       VALUES ($1, 'code_review', 'P2', $2, 'queued', 'accumulation_trigger')
       RETURNING *`,
      [
        `代码审查：${count} 个 dev 任务已完成`,
        projectId,
      ]
    );

    console.log(`[code-review-trigger] 积累触发 code_review: project=${projectId}, count=${count}`);
    return insertResult.rows[0];
  } catch (err) {
    console.error('[code-review-trigger] 触发失败:', err.message);
    return null;
  }
}
