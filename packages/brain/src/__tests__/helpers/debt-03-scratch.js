import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';
import pg from 'pg';
import { readFile } from 'node:fs/promises';

export const pool = new pg.Client(privatePgConfig());
export async function beginScratch() {
  await pool.connect();
  await verifyPrivatePg(pool);
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
