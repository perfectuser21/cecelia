/**
 * heartbeat.js —— 每跳心跳 + Controller lease 续租（IO 薄层，D8）。
 *
 * UPDATE initiative_runs 三列心跳（migration 312）：orchestrator_heartbeat_at /
 * orchestrator_host / orchestrator_pid，host+pid 一起才可用于 watchdog 重拉判断
 * （跨主机裸 pid 无意义）；并在同一条 UPDATE 里续租 Controller ownership lease
 * （migration 415 的 controller_lease_expires_at）。
 *
 * 续租走 CAS（sprint 08132021）：WHERE 同时约束 id + controller_session_id +
 * phase NOT IN ('done','failed')，只有持有创建端 session 的活跃 run 才能续租——
 * 心跳仅凭 run_id 无法区分真 Controller 与假冒/串号，会给无主/错主 run 续命，
 * 绕过「无主 fail-closed」铁律（INV-9）。rowCount=0（session mismatch / 终态）
 * 交调用方做 Kernel fail-closed，不静默续跑。
 *
 * lease 只增不减（GREATEST）：并发/时钟回拨下直接赋值会缩短已有租约、诱发误杀，
 * 故取 GREATEST(existing, now + lease)，过去时刻的心跳不缩短已有租约。
 *
 * 续租时长复用单一 SSOT CONTROLLER_LEASE_DEFAULT_SECONDS（禁止本文件另写死秒数，
 * INV-2）；now 从参数注入（确定性纪律：本文件不自取时间）。
 */
import { CONTROLLER_LEASE_DEFAULT_SECONDS } from './kernel-run-store.js';

export async function writeHeartbeat(pool, {
  runId,
  host,
  pid,
  now,
  controllerSessionId,
  leaseSeconds = CONTROLLER_LEASE_DEFAULT_SECONDS,
}) {
  return pool.query(
    `UPDATE initiative_runs
        SET orchestrator_heartbeat_at = $2,
            orchestrator_host = $3,
            orchestrator_pid = $4,
            controller_lease_expires_at = GREATEST(
              controller_lease_expires_at,
              $2::timestamptz + ($6 * INTERVAL '1 second')
            ),
            updated_at = NOW()
      WHERE id = $1
        AND controller_session_id = $5
        AND NULLIF(BTRIM(controller_session_id), '') IS NOT NULL
        AND NULLIF(BTRIM($5::text), '') IS NOT NULL
        AND phase NOT IN ('done', 'failed')`,
    [runId, now, host, pid, controllerSessionId, leaseSeconds],
  );
}
