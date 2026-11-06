/** 周期过期claim恢复；旧startup-recovery入口继续转出。 */
export async function cleanupStaleClaims(pool, opts = {}) {
  const stats = { cleaned: 0, errors: [] };
  if (!pool || typeof pool.query !== 'function') {
    stats.errors.push('pool not provided');
    return stats;
  }

  const staleMinutes = Number.isFinite(opts.staleMinutes) ? opts.staleMinutes : 60;
  // 相同进程标识也可能来自当前公开claim/周期恢复，并不等于崩溃残留。
  // self仍免旧时间阈值，但必须与其它owner一样重读并保护有效同owner租约。
  const selfClaimerId = process.env.BRAIN_RUNNER_ID || `brain-tick-${process.pid}`;

  try {
    // 先锁task，再锁lease，与heartbeat/claim保持同一锁序；不touch业务字段。
    const selfResult = await pool.query(
      `WITH self_tasks AS MATERIALIZED (
         SELECT id, claimed_by FROM tasks
          WHERE status IN ('queued', 'paused') AND claimed_by = $1
          ORDER BY id FOR UPDATE
       ), self_leases AS MATERIALIZED (
         SELECT lease.task_id, lease.claimer, lease.lease_until, lease.released_at
           FROM task_leases lease JOIN self_tasks candidate ON lease.task_id = candidate.id
          ORDER BY lease.task_id FOR UPDATE OF lease
       )
       UPDATE tasks AS target SET claimed_by = NULL, claimed_at = NULL
         FROM self_tasks candidate WHERE target.id = candidate.id
          AND NOT EXISTS (
            SELECT 1 FROM self_leases lease
             WHERE lease.task_id = target.id AND lease.claimer = candidate.claimed_by
               AND lease.released_at IS NULL AND lease.lease_until > NOW()
          )
      RETURNING target.id, target.status`,
      [selfClaimerId]
    );
    if (selfResult.rowCount > 0) {
      const byStatus = selfResult.rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
      console.log(
        `[StartupRecovery:cleanupStaleClaims] cleared ${selfResult.rowCount} self-PID claims (${selfClaimerId}) by_status=${JSON.stringify(byStatus)}`,
        JSON.stringify({ cleanup_type: 'self_pid_claim', cleaned: selfResult.rowCount, by_status: byStatus })
      );
      stats.cleaned += selfResult.rowCount;
    }

    // Step 2: Clear stale claims from other claimerIds (time-window based).
    // 同覆盖 paused —— 防 brain-tick-N 离线后 paused+claimed_by 永久死锁。
    const { rows } = await pool.query(
      `SELECT id, claimed_by, claimed_at, status, xmin::text AS claim_version
         FROM tasks
        WHERE status IN ('queued', 'paused')
          AND claimed_by IS NOT NULL
          AND claimed_by != $1
          AND (claimed_at IS NULL OR claimed_at < NOW() - ($2::int * INTERVAL '1 minute'))
          AND NOT EXISTS (
            SELECT 1 FROM task_leases lease
             WHERE lease.task_id = tasks.id AND lease.claimer = tasks.claimed_by
               AND lease.released_at IS NULL AND lease.lease_until > NOW()
          )`,
      [selfClaimerId, staleMinutes]
    );

    if (rows.length === 0) {
      if (stats.cleaned === 0) {
        console.log('[StartupRecovery:cleanupStaleClaims] no stale claims found');
      }
      return stats;
    }

    // 先按原xmin锁tasks，再锁lease重读；与heartbeat统一task→lease顺序。
    // 只锁不touch业务字段；等待续租提交后仍需排除有效同owner租约。
    const taskIds = rows.map(r => r.id);
    const result = await pool.query(
      `WITH candidate_tasks AS MATERIALIZED (
         SELECT target.id, target.claimed_by, target.xmin::text AS claim_version
           FROM tasks target
           JOIN unnest($1::uuid[], $2::text[]) AS snapshot(id, claim_version)
             ON target.id = snapshot.id AND target.xmin::text = snapshot.claim_version
          ORDER BY target.id FOR UPDATE OF target
       ), locked_leases AS MATERIALIZED (
         SELECT lease.task_id, lease.claimer, lease.lease_until, lease.released_at
           FROM task_leases lease JOIN candidate_tasks candidate ON lease.task_id = candidate.id
          ORDER BY lease.task_id FOR UPDATE OF lease
       )
       UPDATE tasks AS target SET claimed_by = NULL, claimed_at = NULL
         FROM candidate_tasks candidate
        WHERE target.id = candidate.id AND target.xmin::text = candidate.claim_version
          AND NOT EXISTS (
            SELECT 1 FROM locked_leases lease
             WHERE lease.task_id = target.id AND lease.claimer = candidate.claimed_by
               AND lease.released_at IS NULL AND lease.lease_until > NOW()
          )
      RETURNING target.id`,
      [taskIds, rows.map(r => r.claim_version)]
    );

    const otherCleaned = result.rowCount || 0;
    stats.cleaned += otherCleaned;
    const sample = rows.slice(0, 5).map(r => `${r.id}@${r.claimed_by}`);
    console.log(
      `[StartupRecovery:cleanupStaleClaims] cleared ${otherCleaned} stale claims from other pids (staleMinutes=${staleMinutes})`,
      JSON.stringify({ cleanup_type: 'stale_claim', cleaned: otherCleaned, sample })
    );
  } catch (e) {
    stats.errors.push(e.message);
    console.warn('[StartupRecovery:cleanupStaleClaims] failed:', e.message);
  }

  return stats;
}
