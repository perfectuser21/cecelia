import pool from './db.js';
import { updateTask } from './actions.js';

/**
 * Handler: Handle Stuck Run
 * 处置卡住的任务
 *
 * 策略：
 * 1st time: restart (requeue task)
 * 2nd time: retry with lower priority
 * 3rd time: quarantine + open incident
 */
export async function handleStuckRun(stuck) {
  const minutesStuck = parseFloat(stuck.minutes_since_heartbeat) || 0;
  console.log(`[Monitor] Stuck detected: task=${stuck.task_id}, run=${stuck.run_id}, stuck_for=${minutesStuck.toFixed(1)}min`);

  // Get task retry count + status
  const taskQuery = await pool.query(
    'SELECT retry_count, status FROM tasks WHERE id = $1',
    [stuck.task_id]
  );

  if (taskQuery.rows.length === 0) {
    console.log(`[Monitor] Task ${stuck.task_id} not found, skipping`);
    return;
  }

  // 终态调和（issue 219a9efc）：任务已终态但 run_events 没关（callback 路径漏关）
  // → 只关闭 stale run，绝不 requeue。completed 任务被打回 queued 会造成
  // completed↔queued 振荡 + 同任务重复执行。
  const taskStatus = taskQuery.rows[0].status;
  if (['completed', 'cancelled', 'failed'].includes(taskStatus)) {
    console.log(
      `[Monitor] Task ${stuck.task_id} already terminal (${taskStatus}), ` +
      `closing stale run ${stuck.run_id} as reconciled instead of restarting`
    );
    await pool.query(
      `UPDATE run_events
       SET status = $2,
           ts_end = NOW(),
           reason_code = 'MONITOR_STALE_RUN_RECONCILED',
           reason_kind = 'RECONCILED'
       WHERE run_id = $1 AND status = 'running'`,
      [stuck.run_id, taskStatus === 'completed' ? 'completed' : 'failed']
    );
    return;
  }

  const retryCount = taskQuery.rows[0].retry_count || 0;

  if (retryCount === 0) {
    // First time: restart (requeue)
    console.log(`[Monitor] Action: RESTART task ${stuck.task_id} (1st stuck)`);
    await updateTask({
      task_id: stuck.task_id,
      status: 'queued'
    });

    // Mark run as failed
    await pool.query(
      `UPDATE run_events
       SET status = 'failed',
           ts_end = NOW(),
           reason_code = 'MONITOR_RESTART',
           reason_kind = 'TRANSIENT'
       WHERE run_id = $1 AND status = 'running'`,
      [stuck.run_id]
    );

  } else if (retryCount === 1) {
    // Second time: retry with lower priority
    console.log(`[Monitor] Action: RETRY task ${stuck.task_id} with lower priority (2nd stuck)`);
    await pool.query(
      `UPDATE tasks
       SET status = 'queued',
           claimed_by = NULL,
           claimed_at = NULL,
           priority = CASE
             WHEN priority = 'P0' THEN 'P1'
             WHEN priority = 'P1' THEN 'P2'
             ELSE priority
           END,
           retry_count = retry_count + 1
       WHERE id = $1
         AND status NOT IN ('completed', 'cancelled')`,
      [stuck.task_id]
    );

    await pool.query(
      `UPDATE run_events
       SET status = 'failed',
           ts_end = NOW(),
           reason_code = 'MONITOR_RETRY',
           reason_kind = 'TRANSIENT'
       WHERE run_id = $1 AND status = 'running'`,
      [stuck.run_id]
    );

  } else {
    // Third time: quarantine
    console.log(`[Monitor] Action: QUARANTINE task ${stuck.task_id} (3rd+ stuck)`);
    const { quarantineTask } = await import('./quarantine.js');
    await quarantineTask(stuck.task_id, 'stuck_repeatedly', {
      run_id: stuck.run_id,
      stuck_count: retryCount + 1,
      last_layer: stuck.layer,
      last_step: stuck.step_name
    });

    // 写入 stuck_incident 事件，供 dashboard/告警系统消费
    try {
      await pool.query(
        `INSERT INTO cecelia_events (event_type, source, payload)
         VALUES ('stuck_incident', 'monitor_loop', $1)`,
        [JSON.stringify({
          task_id: stuck.task_id,
          run_id: stuck.run_id,
          stuck_count: retryCount + 1,
          last_layer: stuck.layer,
          last_step: stuck.step_name,
          action: 'quarantined',
          timestamp: new Date().toISOString()
        })]
      );
      console.log(`[Monitor] Incident recorded for task ${stuck.task_id} (stuck_incident event)`);
    } catch (incidentErr) {
      console.error(`[Monitor] Failed to record stuck_incident: ${incidentErr.message}`);
    }
  }
}
