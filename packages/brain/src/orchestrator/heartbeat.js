/**
 * heartbeat.js —— 每跳心跳 + Controller lease 续租（IO 薄层，D8）。
 *
 * 在同一事务内 UPDATE initiative_runs 三列心跳（migration 312）：orchestrator_heartbeat_at /
 * orchestrator_host / orchestrator_pid，host+pid 一起才可用于 watchdog 重拉判断
 * （跨主机裸 pid 无意义）；并在同一条 UPDATE 里续租 Controller ownership lease
 * （migration 415 的 controller_lease_expires_at）。
 *
 * 续租走单条 UPDATE...FROM CAS（sprint 08132021）：WHERE 同时约束 run id +
 * controller_session_id + active phase + parent task 非终态，只有仍绑定非终态 task、
 * 且持有创建端 session 的活跃 run 才能续租——
 * 心跳仅凭 run_id 无法区分真 Controller 与假冒/串号，会给无主/错主 run 续命，
 * 绕过「无主 fail-closed」铁律（INV-9）。rowCount=0（session mismatch / 终态）
 * 交调用方做 Kernel fail-closed，不静默续跑。parent task 判定与 run UPDATE 共用一个
 * PostgreSQL statement snapshot，禁止应用层先 SELECT 再 UPDATE 的 TOCTOU。
 *
 * lease 只增不减（GREATEST）：并发/时钟回拨下直接赋值会缩短已有租约、诱发误杀，
 * 故取 GREATEST(existing, now + lease)，过去时刻的心跳不缩短已有租约。
 *
 * 每个被 CAS 接受的 hop 在同一事务写一条 cecelia_events 审计事件；同 run +
 * heartbeat_at 作为 hop 身份，在 advisory lock 下幂等去重。审计失败时续租整体回滚，
 * session mismatch / 终态则不写假事件；payload 只含可审计字段，不含 session secret。
 *
 * 续租时长复用单一 SSOT CONTROLLER_LEASE_DEFAULT_SECONDS（禁止本文件另写死秒数，
 * INV-2）；now 从参数注入（确定性纪律：本文件不自取时间）。
 */
import {
  CONTROLLER_LEASE_DEFAULT_SECONDS,
  CONTROLLER_SESSION_BLANK_SQL_PATTERN,
} from './kernel-run-store.js';

export async function writeHeartbeat(pool, {
  runId,
  host,
  pid,
  now,
  controllerSessionId,
  leaseSeconds = CONTROLLER_LEASE_DEFAULT_SECONDS,
}) {
  const heartbeatAt = new Date(now).toISOString();
  const auditIdentity = `kernel_controller_lease_renewed:${runId}:${heartbeatAt}`;
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [auditIdentity],
    );
    const result = await client.query(
      `UPDATE initiative_runs AS run
          SET orchestrator_heartbeat_at = $2,
              orchestrator_host = $3,
              orchestrator_pid = $4,
              controller_lease_expires_at = GREATEST(
                controller_lease_expires_at,
                $2::timestamptz + ($6 * INTERVAL '1 second')
              ),
              updated_at = NOW()
         FROM tasks AS parent_task
        WHERE run.id = $1
          AND run.current_task_id = parent_task.id
          AND parent_task.status NOT IN ('completed', 'failed', 'cancelled', 'canceled')
          AND run.controller_session_id = $5
          AND run.controller_session_id !~ $7
          AND $5::text !~ $7
          AND run.phase NOT IN ('done', 'failed')
        RETURNING run.id, run.current_task_id, run.controller_lease_expires_at`,
      [runId, now, host, pid, controllerSessionId, leaseSeconds, CONTROLLER_SESSION_BLANK_SQL_PATTERN],
    );
    if (result.rowCount === 1) {
      const renewed = result.rows[0];
      const payload = {
        run_id: renewed.id,
        task_id: renewed.current_task_id,
        heartbeat_at: heartbeatAt,
        lease_expires_at: new Date(renewed.controller_lease_expires_at).toISOString(),
        host,
        pid,
      };
      await client.query(
        `INSERT INTO cecelia_events (event_type, source, task_id, payload)
         SELECT 'kernel_controller_lease_renewed',
                'kernel_orchestrator',
                $2,
                $3::jsonb
          WHERE NOT EXISTS (
            SELECT 1
              FROM cecelia_events
             WHERE event_type = 'kernel_controller_lease_renewed'
               AND source = 'kernel_orchestrator'
               AND task_id = $2
               AND payload->>'run_id' = $1
               AND payload->>'heartbeat_at' = $4
          )`,
        [renewed.id, renewed.current_task_id, JSON.stringify(payload), heartbeatAt],
      );
    }
    await client.query('COMMIT');
    committed = true;
    return result;
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
