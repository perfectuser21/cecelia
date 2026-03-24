/**
 * KR 完成检测与激活模块
 *
 * 每次 tick 触发，纯 SQL 逻辑，无 LLM。
 *
 * checkKRCompletion：
 *   查所有 in_progress 的 KR，若其下所有 Project 均已 completed → 标记 KR completed
 *
 * activateNextKRs：
 *   从 pending KR 中按优先级激活下一批（容量控制：同时 in_progress KR ≤ MAX_ACTIVE_KRS）
 */

const MAX_ACTIVE_KRS = 6;

/**
 * 检查并关闭已完成的 KR。
 * KR 完成条件：其下所有关联 Project 均 completed，且至少有 1 个 Project。
 */
async function checkKRCompletion(pool) {
  // 迁移：goals WHERE type='area_okr' → objectives
  const krsResult = await pool.query(`
    SELECT id, title
    FROM objectives
    WHERE status NOT IN ('completed', 'cancelled')
  `);

  const closed = [];

  for (const kr of krsResult.rows) {
    // 迁移：projects WHERE kr_id=... AND type='project' → okr_projects
    const projectsResult = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_count
      FROM okr_projects
      WHERE kr_id = $1
    `, [kr.id]);

    const { total, completed_count: completedCount } = projectsResult.rows[0];
    const totalNum = parseInt(total, 10);
    const completedNum = parseInt(completedCount, 10);

    if (totalNum > 0 && totalNum === completedNum) {
      // UPDATE 保留旧表（触发器同步到 objectives）
      await pool.query(`
        UPDATE goals
        SET status = 'completed', updated_at = NOW()
        WHERE id = $1
      `, [kr.id]);

      await pool.query(`
        INSERT INTO cecelia_events (event_type, source, payload)
        VALUES ('kr_completed', 'kr_completion_check', $1)
      `, [JSON.stringify({
        kr_id: kr.id,
        kr_title: kr.title,
        total_projects: totalNum,
        timestamp: new Date().toISOString(),
      })]);

      closed.push({ id: kr.id, title: kr.title });
      console.log(`[kr-completion] KR completed: ${kr.title}`);
    }
  }

  return { closedCount: closed.length, closed };
}

/**
 * 激活下一批 pending KR。
 * 容量控制：当前 in_progress KR 数量 < MAX_ACTIVE_KRS 时才激活。
 */
async function activateNextKRs(pool) {
  // 迁移：goals WHERE type='area_okr' AND status='in_progress' → objectives
  const activeCountResult = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM objectives
    WHERE status NOT IN ('completed', 'cancelled')
  `);
  const currentActive = parseInt(activeCountResult.rows[0].cnt, 10);
  const availableSlots = MAX_ACTIVE_KRS - currentActive;

  if (availableSlots <= 0) {
    return 0;
  }

  // UPDATE 保留旧表（触发器同步到 objectives）；子查询迁移到 objectives
  const activateResult = await pool.query(`
    UPDATE goals
    SET status = 'in_progress', updated_at = NOW()
    WHERE id IN (
      SELECT id FROM objectives
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT $1
    )
    RETURNING id, title
  `, [availableSlots]);

  const activated = activateResult.rowCount ?? 0;

  if (activated > 0) {
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('krs_activated', 'kr_completion_check', $1)
    `, [JSON.stringify({
      activated_count: activated,
      activated_titles: activateResult.rows.map(r => r.title),
      timestamp: new Date().toISOString(),
    })]);
    console.log(`[kr-completion] KRs activated: ${activated}`);
  }

  return activated;
}

export { checkKRCompletion, activateNextKRs };
