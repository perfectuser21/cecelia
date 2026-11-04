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

// Execute checked-in migration SQL in a private schema; no pre-applied migration can mask a missing ALTER.
export async function createDebt02MigrationFixture(bootstrap, migrations) {
  const { default: pg } = await import('pg');
  const { randomUUID } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const admin = new pg.Pool(DB_DEFAULTS);
  const schema = `debt02_${randomUUID().replaceAll('-', '')}`;
  let pool;
  try {
    await verifyDebt02Scratch(admin);
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ ...DB_DEFAULTS, options: `-c search_path=${schema},public` });
    await pool.query(bootstrap);
    const apply = async (name) => pool.query(readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), 'utf8'));
    for (const migration of migrations) await apply(migration);
    return { pool, apply, close: async () => {
      try { await pool.end(); } finally {
        try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await admin.end(); }
      }
    } };
  } catch (error) {
    try { await pool?.end(); } finally {
      try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await admin.end(); }
    }
    throw error;
  }
}
