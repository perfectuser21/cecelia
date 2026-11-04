// 本组真实 PG 回归必须显式绑定独占 scratch，禁止默认连接。
export async function assertDebt10Scratch(pool) {
  if (process.env.DB_NAME !== 'cecelia_scratch' || process.env.DB_HOST !== '127.0.0.1' || !process.env.DB_PORT || process.env.DB_PORT === '5432') {
    throw new Error('debt-10 requires explicit private loopback cecelia_scratch port');
  }
  const { rows: [identity] } = await pool.query('SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port');
  if (identity.db !== 'cecelia_scratch' || identity.host !== '127.0.0.1' || identity.port !== Number(process.env.DB_PORT)) throw new Error('scratch identity mismatch');
}

// 使用真实连接和事务，append-only 回执随事务回滚，绝不删除或禁用其守卫。
export async function openDebt10Transaction() {
  if (process.env.DB_NAME !== 'cecelia_scratch' || process.env.DB_HOST !== '127.0.0.1' || !process.env.DB_PORT || process.env.DB_PORT === '5432') throw new Error('private scratch required');
  const { default: pg } = await import('pg');
  const { DB_DEFAULTS } = await import('../../db-config.js');
  const client = new pg.Client(DB_DEFAULTS);
  await client.connect();
  await assertDebt10Scratch(client);
  await client.query('BEGIN');
  return client;
}
export async function closeDebt10Transaction(client) {
  if (!client) return;
  try { await client.query('ROLLBACK'); } finally { await client.end(); }
}
