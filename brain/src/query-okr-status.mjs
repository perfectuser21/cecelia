#!/usr/bin/env node
/**
 * Query OKR system status
 */
import pool from './db.js';

async function main() {
  try {
    // 1. Count Objectives and KRs
    const objectivesResult = await pool.query(`
      SELECT COUNT(*) as count FROM goals
      WHERE type = 'objective' AND status NOT IN ('completed', 'cancelled')
    `);

    const krsResult = await pool.query(`
      SELECT COUNT(*) as count FROM goals
      WHERE type = 'key_result' AND status NOT IN ('completed', 'cancelled')
    `);

    // 2. Get recent top-level goals
    const goalsResult = await pool.query(`
      SELECT id, title, type, status, progress, priority
      FROM goals
      WHERE parent_id IS NULL
      ORDER BY created_at DESC
      LIMIT 5
    `);

    // 3. Count tasks by status
    const queuedResult = await pool.query(`
      SELECT COUNT(*) as count FROM tasks WHERE status = 'queued'
    `);

    const inProgressResult = await pool.query(`
      SELECT COUNT(*) as count FROM tasks WHERE status = 'in_progress'
    `);

    const completedTodayResult = await pool.query(`
      SELECT COUNT(*) as count FROM tasks
      WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'
    `);

    // 4. Get decomposition tasks
    const decompResult = await pool.query(`
      SELECT id, title, status, payload->>'decomposition' as decomp_type
      FROM tasks
      WHERE payload->>'decomposition' IN ('true', 'continue')
      ORDER BY created_at DESC
      LIMIT 5
    `);

    // 5. Check for OKR gaps (Objectives without KRs)
    const noKrObjectivesResult = await pool.query(`
      SELECT o.id, o.title FROM goals o
      WHERE o.type = 'objective'
        AND o.parent_id IS NULL
        AND o.status NOT IN ('completed', 'cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM goals kr WHERE kr.parent_id = o.id
        )
    `);

    // 6. Check for KRs without Tasks
    const noTaskKrsResult = await pool.query(`
      SELECT kr.id, kr.title FROM goals kr
      WHERE kr.type = 'key_result'
        AND kr.status NOT IN ('completed', 'cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM tasks t WHERE t.goal_id = kr.id
        )
      LIMIT 10
    `);

    // 7. Check tick status
    const tickResult = await pool.query(`
      SELECT key, value_json FROM working_memory
      WHERE key IN ('tick_enabled', 'tick_last')
    `);

    const tickStatus = {};
    for (const row of tickResult.rows) {
      tickStatus[row.key] = row.value_json;
    }

    const status = {
      okr_counts: {
        objectives: parseInt(objectivesResult.rows[0].count),
        key_results: parseInt(krsResult.rows[0].count)
      },
      recent_goals: goalsResult.rows,
      task_counts: {
        queued: parseInt(queuedResult.rows[0].count),
        in_progress: parseInt(inProgressResult.rows[0].count),
        completed_today: parseInt(completedTodayResult.rows[0].count)
      },
      decomposition_tasks: decompResult.rows,
      okr_gaps: {
        objectives_without_krs: noKrObjectivesResult.rows,
        krs_without_tasks: noTaskKrsResult.rows
      },
      tick_status: tickStatus
    };

    console.log(JSON.stringify(status, null, 2));

  } catch (err) {
    console.error('Query error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
