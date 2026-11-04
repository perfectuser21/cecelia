// 第12路真实PG回归只接受显式的本地 scratch，不提供默认连接。
export function assertScratchEnvironment() {
  if (process.env.DB_NAME !== 'cecelia_scratch' || process.env.DB_HOST !== '127.0.0.1'
      || !/^\d+$/.test(process.env.DB_PORT || '') || process.env.DB_PORT === '5432'
      || !process.env.DB_USER) {
    throw new Error('debt-12: require explicit loopback/private-port cecelia_scratch DB');
  }
}

export async function verifyScratchPool(pool) {
  assertScratchEnvironment();
  const { rows: [identity] } = await pool.query(
    'SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port',
  );
  if (identity.name !== 'cecelia_scratch' || identity.host !== '127.0.0.1'
      || identity.port !== Number(process.env.DB_PORT)) {
    throw new Error('debt-12: connected database identity mismatch');
  }
}
