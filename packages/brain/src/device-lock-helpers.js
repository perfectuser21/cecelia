/**
 * device-lock-helpers.js — 手机/设备资源锁（管家 G5 横切件，task 104ab89f）
 *
 * 三条原子 SQL，全部 DB 侧 NOW()（时钟死规矩：禁收执行体自报时间戳）。
 * 释放的正确性由 recovery-loop 的 sweepStaleDeviceLocks 对账保证（executor 有
 * 47 处终态直写 + psql 直设病史，逐回写点接线必漏）；task-updater 终态即时
 * 释放只是低延迟优化。
 * 多设备：当前单 serial。将来同任务多台手机必须按 device_name 排序 + 单条
 * 原子多行 UPDATE all-or-nothing，防死锁。
 */
import defaultPool from './db.js';

const TTL_MIN = 1;
const TTL_MAX = 240;
const TTL_DEFAULT = 30;

function clampTtl(ttlMinutes) {
  const n = Number(ttlMinutes);
  if (!Number.isFinite(n)) return TTL_DEFAULT;
  return Math.min(TTL_MAX, Math.max(TTL_MIN, Math.round(n)));
}

/**
 * 原子抢锁。占用判定：locked_by 非空 且（expires_at NULL=永久锁 或 未过期 或
 * 过期但持有任务仍 in_progress——双重判据，防长任务锁被抢导致双 RPA 同机）。
 * @returns {{result:'acquired',lock:object}|{result:'locked',holder:object}|{result:'unknown_device'}}
 */
export async function acquireDeviceLock(taskId, deviceName, ttlMinutes = TTL_DEFAULT, pool = defaultPool) {
  const ttl = clampTtl(ttlMinutes);
  const { rows } = await pool.query(
    `UPDATE device_locks
        SET locked_by = $1, locked_at = NOW(),
            expires_at = NOW() + ($2 || ' minutes')::interval
      WHERE device_name = $3
        AND (
          locked_by IS NULL
          OR locked_by = $1
          OR (
            expires_at IS NOT NULL AND expires_at < NOW()
            AND NOT EXISTS (
              SELECT 1 FROM tasks t
               WHERE t.id::text = device_locks.locked_by AND t.status = 'in_progress'
            )
          )
        )
      RETURNING *`,
    [String(taskId), String(ttl), deviceName],
  );
  if (rows.length > 0) return { result: 'acquired', lock: rows[0] };
  const { rows: existing } = await pool.query(
    'SELECT device_name, locked_by, locked_at, expires_at FROM device_locks WHERE device_name = $1',
    [deviceName],
  );
  if (existing.length === 0) return { result: 'unknown_device' };
  return { result: 'locked', holder: existing[0] };
}

/** 释放某任务持有的全部设备锁（无锁时 no-op）。 */
export async function releaseDeviceLocksHeldBy(taskId, pool = defaultPool) {
  const { rowCount } = await pool.query(
    'UPDATE device_locks SET locked_by = NULL, locked_at = NULL, expires_at = NULL WHERE locked_by = $1',
    [String(taskId)],
  );
  return rowCount;
}

/**
 * 对账式释放：持有任务已非活跃（不在 queued/in_progress，含 task 被删/psql 直设
 * quarantined/blocked/dep_failed/archived 等一切非活跃态）→ 立即释放。
 * 注意 queued 算活跃：dispatch revert 回 queued 的任务保留锁，二次派发走同持有者
 * reacquire；真死的 queued 由其自身超时链收尾。
 * uuid 守卫：只回收 locked_by 是 uuid 形状（tasks.id）的行——非 uuid 持有者
 * （手工 acquire 的自由身份如 'manual-alex'）在 tasks 表必然无对应行，没守卫
 * 会被对账秒扫；它们靠 TTL 过期 + acquire 双重判据解开。
 */
export async function sweepStaleDeviceLocks(pool = defaultPool) {
  const { rowCount } = await pool.query(
    `UPDATE device_locks
        SET locked_by = NULL, locked_at = NULL, expires_at = NULL
      WHERE locked_by IS NOT NULL
        AND locked_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND NOT EXISTS (
          SELECT 1 FROM tasks t
           WHERE t.id::text = device_locks.locked_by
             AND t.status IN ('queued','in_progress')
        )`,
  );
  return rowCount;
}
