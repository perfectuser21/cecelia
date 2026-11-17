/** 历史自动修复任务统计；不创建或派发开发任务。 */
import pool from './db.js';

/**
 * Get auto-fix statistics
 *
 * @returns {Promise<Object>} Stats object
 */
export async function getAutoFixStats() {
  const query = `
    SELECT
      COUNT(*) AS total_auto_fixes,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed_fixes,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed_fixes,
      COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress_fixes,
      COUNT(*) FILTER (WHERE status = 'queued') AS queued_fixes
    FROM tasks
    WHERE 'auto-fix' = ANY(tags)
  `;

  const result = await pool.query(query);
  return result.rows[0];
}
