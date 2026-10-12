/**
 * device-pool.js — 设备池（派发总闸 G，任务 c5f6e683；迁移 553 device_pools / device_pool_members）。
 *
 * 手机按池登记（pool_key=<平台>.<账号类型>，同平台同账号类型一池）。派发时按 priority 依次过同一道设备闸
 * （manual-dispatch-device-gate：资源健康 + Brain 设备锁），第一台放行的即选中并已持锁；
 * 被占 / 不健康 / 未注册 → 换下一台。全被占 → all_busy（调用方只等不接管，铁律 never-take-over-another-run）；
 * 池里没有可用成员 → pool_empty；全部未注册 → pool_unregistered。
 * 机器 / profile 取手机台账 phone_registry（唯一真身），账号取成员行 account_ref（调度单 biz）。
 */

export async function listPoolCandidates(pool, poolKey) {
  const { rows } = await pool.query(
    `SELECT m.serial, m.account_ref, m.priority, r.host AS machine, r.profile, r.nickname
       FROM device_pool_members m
       JOIN device_pools p ON p.pool_key = m.pool_key
       JOIN phone_registry r ON r.serial = m.serial
      WHERE m.pool_key = $1 AND p.enabled AND m.enabled AND r.enabled
      ORDER BY m.priority ASC, m.serial ASC`,
    [poolKey],
  );
  return rows ?? [];
}

async function defaultLockGate(task) {
  const { checkDeviceLockForManualDispatch } = await import('./manual-dispatch-device-gate.js');
  return checkDeviceLockForManualDispatch(task, 'device-pool');
}

/**
 * 从池里选一台并持锁。
 * @returns {Promise<{ok:true, member:object, tried:object[]}|{ok:false, reason:string, tried:object[]}>}
 */
export async function selectDeviceFromPool(pool, poolKey, task, { lockGate = defaultLockGate, ttlMinutes } = {}) {
  const candidates = await listPoolCandidates(pool, poolKey);
  const tried = [];
  if (!candidates.length) return { ok: false, reason: 'pool_empty', tried };
  for (const c of candidates) {
    const probeTask = {
      ...task,
      payload: { ...(task?.payload || {}), device_serial: c.serial, ...(ttlMinutes ? { device_ttl_minutes: ttlMinutes } : {}) },
    };
    let gate;
    try {
      gate = await lockGate(probeTask);
    } catch (err) {
      gate = { pass: false, status: 0, body: { error: `gate_error: ${err.message}` } };
    }
    if (gate?.pass) return { ok: true, member: c, tried };
    tried.push({ serial: c.serial, status: gate?.status ?? 0, error: gate?.body?.error ?? null, locked_by: gate?.body?.locked_by ?? null });
  }
  const reason = tried.every((t) => t.status === 422) ? 'pool_unregistered' : 'all_busy';
  return { ok: false, reason, tried };
}
