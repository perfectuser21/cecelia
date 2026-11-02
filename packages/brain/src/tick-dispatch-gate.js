/** Same persistent switch used by tick status and every new common Runner start. */
export function tickDispatchEnabled(record, env = process.env) {
  return env.CECELIA_TICK_HARD_OFF === '1' ? false : (record?.enabled ?? true);
}

export async function readTickDispatchEnabled(pool, env = process.env) {
  const { rows } = await pool.query('SELECT value_json FROM working_memory WHERE key=$1', ['tick_enabled']);
  return tickDispatchEnabled(rows[0]?.value_json, env);
}
