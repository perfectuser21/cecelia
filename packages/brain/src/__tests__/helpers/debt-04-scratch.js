// 仅供本组真实PG回归：不读取凭据，不接受任何默认库或远程地址。
export function assertScratchConfig(env = process.env) {
  const port = Number(env.DB_PORT);
  if (env.DB_HOST !== '127.0.0.1' || env.DB_NAME !== 'cecelia_scratch' ||
      !Number.isInteger(port) || port < 1 || port > 65535 || env.TEST_DATABASE_URL) {
    throw new Error('第04路回归要求显式 DB_HOST=127.0.0.1、DB_PORT、DB_NAME=cecelia_scratch；禁止连接串覆盖');
  }
}

export async function assertScratchIdentity(pool, env = process.env) {
  assertScratchConfig(env);
  const { rows: [row] } = await pool.query(
    'SELECT current_database() AS database, host(inet_server_addr()) AS address, inet_server_port() AS port',
  );
  if (row.database !== 'cecelia_scratch' || row.address !== '127.0.0.1' || row.port !== Number(env.DB_PORT)) {
    throw new Error('第04路回归拒绝未核验的数据库身份');
  }
}
