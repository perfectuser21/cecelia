/**
 * device-lock-helpers.js — 手机/设备资源锁（管家 G5 横切件，task 104ab89f）
 *
 * 三条原子 SQL，全部 DB 侧 NOW()（时钟死规矩：禁收执行体自报时间戳）。
 * 普通资源仍由 recovery-loop 按 Task 终态对账释放。手机锁是外部设备 fence：
 * Task 终态、租约到期或 Brain 进程失联都不能证明手机及其原生请求已停，
 * 只能由持有者在核实收尾后按 device_name + owner 显式释放。
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

/** 无租约的旧持有者：in_progress 最多再保护到 locked_at + 此分钟数（= TTL 上限），不再无限压住。 */
export const LEGACY_HOLDER_PROTECT_MIN = TTL_MAX;

/**
 * 原子抢锁。占用判定：locked_by 非空 且（expires_at NULL=永久锁 或 未过期 或
 * 过期但持有任务仍 in_progress 且「租约未过期」——锁跟租约走（派发总闸 G，任务 c5f6e683））。
 * 持有任务没有活跃租约（旧执行者）时，in_progress 只保护到 locked_at + 240 分钟。
 * 手机锁即使过期也不可被其它 owner 抢占；TTL 是续租/告警时间，不是手机
 * 原生执行已经停止的证明。其它资源保留原过期回收合同。
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
            device_type IS DISTINCT FROM 'phone'
            AND expires_at IS NOT NULL AND expires_at < NOW()
            AND NOT EXISTS (
              SELECT 1 FROM tasks t
               WHERE t.id::text = device_locks.locked_by AND t.status = 'in_progress'
                 AND (
                   EXISTS (SELECT 1 FROM task_leases l
                            WHERE l.task_id = t.id AND l.released_at IS NULL AND l.lease_until > NOW())
                   OR (
                     NOT EXISTS (SELECT 1 FROM task_leases l WHERE l.task_id = t.id AND l.released_at IS NULL)
                     AND device_locks.locked_at > NOW() - make_interval(mins => ${LEGACY_HOLDER_PROTECT_MIN})
                   )
                 )
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

/** 内部状态机仅释放非手机资源；手机必须走精确 owner 的显式安全收尾。 */
export async function releaseDeviceLocksHeldBy(taskId, pool = defaultPool) {
  const { rowCount } = await pool.query(
    "UPDATE device_locks SET locked_by = NULL, locked_at = NULL, expires_at = NULL WHERE locked_by = $1 AND device_type IS DISTINCT FROM 'phone'",
    [String(taskId)],
  );
  return rowCount;
}

/**
 * 正式手机控制器只在真实终态及已核清场后释放本任务的精确设备集合
 * （含 MMV instance 别名，别名在台账中可能不是 phone 类型）。
 * 未知原生请求、缺 cleanup 或仅 Task failed 不能构造此证明。
 */
export async function releaseVerifiedPhoneLocksHeldBy(taskId, deviceNames, proof, pool = defaultPool) {
  if (!Array.isArray(deviceNames) || deviceNames.length === 0
      || deviceNames.some((name) => typeof name !== 'string' || !name)
      || proof?.execution_stopped !== true
      || !(proof.cleanup_verified === true || proof.execution_started === false)) {
    throw new Error('phone_lock_safe_stop_unverified');
  }
  const { rowCount } = await pool.query(
    `UPDATE device_locks
        SET locked_by = NULL, locked_at = NULL, expires_at = NULL
      WHERE locked_by = $1 AND device_name = ANY($2::text[])`,
    [String(taskId), [...new Set(deviceNames)]],
  );
  return rowCount;
}

/**
 * 对账式释放仅适用于非手机资源。手机持有任务的终态、删除或 TTL 到期均
 * 不能当作原生操作结束的证明，必须保留 fence 等候精确 owner 安全收尾。
 * 注意 queued 算活跃：sweeper 不扫 queued 持有者，保护"acquire 成功→任务尚在
 * 派发中"的窗口不被对账误放（revert 点自身会主动释放；万一漏放，二次派发走
 * 同持有者 reacquire 自愈，真死的 queued 由其自身超时链收尾）。
 * uuid 守卫：只回收 locked_by 是 uuid 形状（tasks.id）的行——非 uuid 持有者
 * （手工 acquire 的自由身份如 'manual-alex'）在 tasks 表必然无对应行，没守卫
 * 会被对账秒扫；非手机资源可经 TTL 到期再占，手机仍须精确 owner 收尾。
 */
export async function sweepStaleDeviceLocks(pool = defaultPool) {
  const { rowCount } = await pool.query(
    `UPDATE device_locks
        SET locked_by = NULL, locked_at = NULL, expires_at = NULL
      WHERE locked_by IS NOT NULL
        AND device_type IS DISTINCT FROM 'phone'
        AND locked_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND NOT EXISTS (
          SELECT 1 FROM tasks t
           WHERE t.id::text = device_locks.locked_by
             AND t.status IN ('queued','in_progress')
        )`,
  );
  return rowCount;
}
