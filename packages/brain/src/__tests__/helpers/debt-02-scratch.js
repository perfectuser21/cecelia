import { DB_DEFAULTS } from '../../db-config.js';

// Fail closed before the first connection; never fall back to a developer database.
export async function verifyDebt02Scratch(pool) {
  if (DB_DEFAULTS.database !== 'cecelia_scratch' || DB_DEFAULTS.host !== '127.0.0.1'
      || !process.env.DB_PORT || DB_DEFAULTS.port === 5432) {
    throw new Error('debt-02 requires an explicit private loopback cecelia_scratch PostgreSQL port');
  }
  const { rows: [identity] } = await pool.query(
    'SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port');
  if (identity.db !== 'cecelia_scratch' || identity.host !== '127.0.0.1'
      || identity.port !== DB_DEFAULTS.port) throw new Error('debt-02 scratch identity mismatch');
}
