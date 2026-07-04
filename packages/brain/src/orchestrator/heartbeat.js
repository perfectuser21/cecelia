/**
 * heartbeat.js —— 每跳心跳（IO 薄层，D8）。
 *
 * UPDATE initiative_runs 三列（migration 312）：orchestrator_heartbeat_at / orchestrator_host /
 * orchestrator_pid。host+pid 一起才可用于 watchdog 重拉判断（跨主机裸 pid 无意义）。
 * now 从参数注入（确定性纪律：本文件不自取时间）。
 */

export async function writeHeartbeat(pool, { runId, host, pid, now }) {
  await pool.query(
    `UPDATE initiative_runs
        SET orchestrator_heartbeat_at = $2,
            orchestrator_host = $3,
            orchestrator_pid = $4
      WHERE id = $1`,
    [runId, now, host, pid],
  );
}
