/**
 * heartbeat.js —— 每跳心跳（IO 薄层，D8）。
 *
 * UPDATE initiative_runs 三列（migration 312）：orchestrator_heartbeat_at / orchestrator_host /
 * orchestrator_pid。host+pid 一起才可用于 watchdog 重拉判断（跨主机裸 pid 无意义）。
 * now 从参数注入（确定性纪律：本文件不自取时间）。
 */

export async function writeHeartbeat(pool, {
  runId,controllerSessionId,controllerGeneration,host,pid,now,leaseSeconds=1800,
}) {
  const expectedGeneration=Number(controllerGeneration);
  if (!controllerSessionId || !Number.isSafeInteger(expectedGeneration) || expectedGeneration<1) {
    throw new Error('controller_lease_identity_missing');
  }
  const client=await pool.connect();
  let committed=false;
  try {
    await client.query('BEGIN');
    const task=await client.query(
      `SELECT current_task_id FROM initiative_runs WHERE id=$1`,[runId],
    );
    if (!task.rows[0]) throw new Error('controller_lease_renewal_lost');
    await client.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[task.rows[0].current_task_id]);
    const run=await client.query(
      `SELECT controller_session_id,controller_generation FROM initiative_runs
        WHERE id=$1 AND phase NOT IN ('done','failed') FOR UPDATE`,[runId],
    );
    if (run.rows[0]?.controller_session_id!==controllerSessionId
        || Number(run.rows[0]?.controller_generation)!==expectedGeneration) {
      throw new Error('controller_lease_renewal_lost');
    }
    const session=await client.query(
      `UPDATE kernel_controller_sessions SET last_heartbeat_at=$2::timestamptz,
         lease_expires_at=$2::timestamptz+($3*INTERVAL '1 second'),updated_at=$2::timestamptz
       WHERE id=$1 AND generation=$4 AND run_id=$5 AND status='active'
         AND lease_expires_at >= $2::timestamptz
       RETURNING lease_expires_at`,
      [controllerSessionId,now,leaseSeconds,expectedGeneration,runId],
    );
    if (session.rows.length!==1) throw new Error('controller_lease_renewal_lost');
    await client.query(
      `UPDATE initiative_runs SET orchestrator_heartbeat_at=$2,orchestrator_host=$3,
       orchestrator_pid=$4,controller_lease_expires_at=$5 WHERE id=$1`,
      [runId,now,host,pid,session.rows[0].lease_expires_at],
    );
    await client.query('COMMIT');committed=true;
  } catch(error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
