import pg from 'pg';
import { readFile } from 'node:fs/promises';

// 无默认数据库：未显式提供私有 scratch URL 时拒绝执行，绝不触达 db.js。
const raw = process.env.CECELIA_DEBT03_DATABASE_URL;
if (!raw) throw new Error('Cecelia debt-03 requires explicit CECELIA_DEBT03_DATABASE_URL');
const url = new URL(raw);
if (url.hostname !== '127.0.0.1' || url.pathname !== '/cecelia_scratch' || !url.port || ['5432','5221'].includes(url.port)) {
  throw new Error('debt-03 only accepts explicit loopback private-port cecelia_scratch');
}
export const pool = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 3000 });
export async function beginScratch() {
  await pool.connect();
  const { rows: [identity] } = await pool.query('SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port');
  if (identity.db !== 'cecelia_scratch' || identity.host !== '127.0.0.1' || identity.port !== Number(url.port)) {
    throw new Error('scratch server identity mismatch');
  }
  console.info('[debt-03 scratch identity]', identity);
  await pool.query('BEGIN');
}
export async function finishScratch() {
  try { await pool.query('ROLLBACK'); } finally { await pool.end(); }
}
export async function applyMigration(name) {
  await pool.query(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), 'utf8'));
}
export async function baseSchema() {
  await pool.query(`
    CREATE TABLE schema_version(version text PRIMARY KEY, description text, applied_at timestamptz DEFAULT now());
    CREATE TABLE tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, description text, status text,
      task_type text DEFAULT 'dev', metadata jsonb, project_id uuid, created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE cecelia_events(id serial PRIMARY KEY, created_at timestamptz DEFAULT now());
  `);
}
