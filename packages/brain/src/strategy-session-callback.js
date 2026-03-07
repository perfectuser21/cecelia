/**
 * strategy-session-callback.js
 *
 * execution-callback 的 strategy_session 闭环处理：
 * 解析 Skill 输出 JSON，将 KR 写入 goals 表，meeting_summary 写入任务 summary 字段。
 */

/**
 * 处理 strategy_session 任务完成回调
 *
 * @param {object} pool   - pg.Pool 实例
 * @param {string} task_id - 任务 UUID
 * @param {*} result      - Skill 输出（字符串或对象）
 * @returns {Promise<{ krs_inserted: number, summary_written: boolean }>}
 */
export async function handleStrategySessionCompletion(pool, task_id, result) {
  // 获取任务的 task_type 和 project_id
  const taskRow = await pool.query(
    'SELECT task_type, project_id FROM tasks WHERE id = $1',
    [task_id]
  );
  const task = taskRow.rows[0];

  if (!task || task.task_type !== 'strategy_session') {
    return { krs_inserted: 0, summary_written: false };
  }

  // 解析 result 字段（Skill 可能输出字符串或对象）
  let ssOutput = null;
  try {
    const rawResult = (result !== null && typeof result === 'object')
      ? (result.result || result)
      : result;
    ssOutput = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
  } catch (parseErr) {
    console.warn(`[strategy-session-callback] JSON 解析失败（非致命）: ${parseErr.message}`);
    return { krs_inserted: 0, summary_written: false };
  }

  if (!ssOutput) {
    return { krs_inserted: 0, summary_written: false };
  }

  const { meeting_summary, key_tensions, krs } = ssOutput;
  let summaryWritten = false;
  let krsInserted = 0;

  // 将 meeting_summary + key_tensions 写入任务 summary 字段
  if (meeting_summary) {
    const summaryText = [
      meeting_summary,
      key_tensions?.length ? `\n张力点：${key_tensions.join('；')}` : null,
    ].filter(Boolean).join('');
    try {
      await pool.query(
        'UPDATE tasks SET summary = $1 WHERE id = $2',
        [summaryText, task_id]
      );
      summaryWritten = true;
      console.log(`[strategy-session-callback] summary 写入成功: task=${task_id}`);
    } catch (summaryErr) {
      console.error(`[strategy-session-callback] summary 写入失败: ${summaryErr.message}`);
    }
  }

  // 逐条写入 KR 到 goals 表
  if (!krs || krs.length === 0) {
    console.warn(`[strategy-session-callback] krs 为空，跳过写入: task=${task_id}`);
    return { krs_inserted: 0, summary_written: summaryWritten };
  }

  for (const kr of krs) {
    try {
      await pool.query(
        `INSERT INTO goals (title, domain, owner_role, priority, status, project_id)
         VALUES ($1, $2, $3, $4, 'pending', $5)`,
        [
          kr.title,
          kr.domain || null,
          kr.owner_role || null,
          kr.priority || 'P1',
          task.project_id || null,
        ]
      );
      krsInserted++;
      console.log(`[strategy-session-callback] KR 写入 goals: "${kr.title}"`);
    } catch (krErr) {
      console.error(`[strategy-session-callback] KR 写入失败（继续其他 KR）: "${kr.title}" - ${krErr.message}`);
    }
  }

  return { krs_inserted: krsInserted, summary_written: summaryWritten };
}
