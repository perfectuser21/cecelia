import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const ALLOWED_DATABASES = new Set(['cecelia_test', 'cecelia_scratch']);
const unsafe = () => new Error('CRM integration requires an explicitly allowed test database');

/** Select CI connection settings without exposing credentials, never default CI to a production DB. */
export function crmPgTestConfig(env = process.env) {
  const ci = env.POSTGRES_INTEGRATION === '1', scratch = env.CRM_STORE_SCRATCH_TEST === '1';
  if (!ci && !scratch) return { enabled: false };
  let config;
  if (env.DATABASE_URL) {
    let url;
    try { url = new URL(env.DATABASE_URL); } catch { throw unsafe(); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.searchParams.has('database') || url.searchParams.has('dbname')) throw unsafe();
    config = { connectionString: env.DATABASE_URL };
  } else {
    const database = env.DB_NAME ?? (!ci && scratch ? 'cecelia_scratch' : undefined);
    if (!database) throw unsafe();
    config = {
      host: env.DB_HOST ?? (!ci && scratch ? '/tmp' : 'localhost'),
      port: Number(env.DB_PORT ?? 5432), database,
      user: env.DB_USER ?? (!ci && scratch ? 'administrator' : 'cecelia'),
      ...(env.DB_PASSWORD === undefined ? {} : { password: env.DB_PASSWORD }),
    };
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw unsafe();
  }
  // Validate the database selected by pg itself; do not infer it from a URL suffix.
  let database;
  try { database = new pg.Client(config).connectionParameters.database; } catch { throw unsafe(); }
  if (!ALLOWED_DATABASES.has(database)) throw unsafe();
  return { enabled: true, config, database };
}

/** All fixture tables live in a unique owned schema; no migration or cleanup touches public. */
export async function createCrmPgFixture(env = process.env) {
  const selected = crmPgTestConfig(env);
  if (!selected.enabled) throw unsafe();
  const db = new pg.Client({ ...selected.config, connectionTimeoutMillis: 5000, query_timeout: 10000 });
  const schema = `crm_pg_${randomUUID().replaceAll('-', '')}`;
  let connected = false, created = false, closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      if (connected && created) {
        await db.query('ROLLBACK');
        await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { if (connected) await db.end(); }
  };
  try {
    await db.connect(); connected = true;
    const identity = (await db.query('SELECT current_database() AS database')).rows[0]?.database;
    if (identity !== selected.database || !ALLOWED_DATABASES.has(identity)) throw unsafe();
    await db.query(`CREATE SCHEMA "${schema}"`); created = true;
    await db.query(`SET search_path TO "${schema}"`);
    if ((await db.query('SELECT current_schema() AS schema')).rows[0]?.schema !== schema) throw unsafe();
    await db.query('CREATE TABLE schema_version(version text primary key,description text)');
    await db.query(await readFile(new URL('../../../migrations/555_crm_canonical.sql', import.meta.url), 'utf8'));
    return { db, schema, close };
  } catch (error) {
    await close();
    throw error;
  }
}
