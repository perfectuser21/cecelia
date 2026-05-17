/**
 * 欲望反馈闭环（P0-B）
 *
 * 任务完成/失败后，解析 task.description 中的 desire_id，
 * 回写对应 desire 状态和效能评分。
 *
 * 调用方：execution-callback（routes.js）
 */

/**
 * 根据任务结果回写对应欲望的状态
 * @param {string} task_id
 * @param {'completed'|'failed'} outcome
 * @param {import('pg').Pool} pool
 */
export async function updateDesireFromTask(task_id, outcome, pool) {
  const taskRow = await pool.query(
    'SELECT description FROM tasks WHERE id = $1 LIMIT 1',
    [task_id]
  );
  const description = taskRow.rows[0]?.description || '';

  // 从 description 提取 desire_id（三种格式兼容）
  const match = description.match(/\*\*来源 desire ID\*\*：([a-f0-9-]+)/i)
    || description.match(/来源：好奇心信号 desire\s+([a-f0-9-]+)/i)
    || description.match(/来源：desire\s+([a-f0-9-]+)/i);

  if (!match) return; // 非欲望驱动任务，跳过

  const desireId = match[1];

  if (outcome === 'completed') {
    await pool.query(`
      UPDATE desires
      SET status = 'completed',
          completed_at = NOW(),
          effectiveness_score = 8.0
      WHERE id = $1 AND status = 'acted'
    `, [desireId]);
  } else if (outcome === 'failed') {
    await pool.query(`
      UPDATE desires
      SET status = 'failed',
          failed_at = NOW(),
          effectiveness_score = 2.0
      WHERE id = $1 AND status = 'acted'
    `, [desireId]);
  }

  console.log(`[desire-feedback] desire ${desireId} → ${outcome}`);
}
