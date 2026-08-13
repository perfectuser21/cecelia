/**
 * heartbeat.js —— 每跳心跳（IO 薄层，D8）。
 *
 * UPDATE initiative_runs 三列（migration 312）：orchestrator_heartbeat_at / orchestrator_host /
 * orchestrator_pid。host+pid 一起才可用于 watchdog 重拉判断（跨主机裸 pid 无意义）。
 * now 从参数注入（确定性纪律：本文件不自取时间）。
 */

export async function writeHeartbeat(pool, { runId, host, pid, now, leaseSeconds = 1800 }) {
  const { rows } = await pool.query(
    `WITH authority AS (
       SELECT run.controller_session_id,run.controller_generation FROM initiative_runs run
       JOIN kernel_controller_sessions session ON session.id=run.controller_session_id
        AND session.generation=run.controller_generation AND session.status='active'
       WHERE run.id=$1 AND run.phase NOT IN ('done','failed')
     ), renewed AS (
       UPDATE kernel_controller_sessions session
       SET last_heartbeat_at=$2::timestamptz,
           lease_expires_at=$2::timestamptz+($5*INTERVAL '1 second'),
           updated_at=$2::timestamptz
       FROM authority WHERE session.id=authority.controller_session_id
        AND session.generation=authority.controller_generation AND session.status='active'
       RETURNING session.id,session.generation,session.lease_expires_at
     )
     UPDATE initiative_runs run SET orchestrator_heartbeat_at=$2::timestamptz,orchestrator_host=$3,
       orchestrator_pid=$4,controller_lease_expires_at=renewed.lease_expires_at
     FROM renewed WHERE run.id=$1 AND run.controller_session_id=renewed.id
       AND run.controller_generation=renewed.generation RETURNING run.id`,
    [runId,now,host,pid,leaseSeconds],
  );
  if (rows.length !== 1) throw new Error('controller_lease_renewal_lost');
}
