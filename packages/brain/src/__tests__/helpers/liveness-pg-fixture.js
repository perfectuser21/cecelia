import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {DB_DEFAULTS} from '../../db-config.js';

const tables = ['tasks', 'task_runs', 'task_events', 'phone_registry', 'working_memory',
  'ops_workflows', 'ops_schedule_entries', 'ops_source_heartbeats', 'recurring_tasks', 'value_streams', 'capabilities', 'areas'];
const quote = value => `"${value.replaceAll('"', '""')}"`;

function assertTarget(env) {
  if (!['localhost', '127.0.0.1'].includes(DB_DEFAULTS.host)) throw Error('liveness fixture requires loopback PostgreSQL');
  if (DB_DEFAULTS.database === 'cecelia_scratch') return new Set(['127.0.0.1', '::1']);
  if (env.CI !== 'true' || env.POSTGRES_INTEGRATION !== '1' || DB_DEFAULTS.database !== 'cecelia_test'
    || DB_DEFAULTS.port !== 5432) throw Error('liveness fixture requires local scratch or dedicated CI test');
  const uri = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(uri.protocol) || !['localhost', '127.0.0.1'].includes(uri.hostname)
    || (uri.port || '5432') !== '5432' || uri.pathname !== '/cecelia_test' || uri.search || uri.hash
    || decodeURIComponent(uri.username) !== DB_DEFAULTS.user) throw Error('liveness fixture CI database identity mismatch');
  if (!isIP(env.CI_PG_SERVER_ADDRESS || '')) throw Error('liveness fixture requires exact CI PostgreSQL service address');
  return new Set([env.CI_PG_SERVER_ADDRESS]);
}

// 只读已迁移public结构；所有数据、sequence和清理归随机私有schema。
export async function livenessPgFixture() {
  const serverAddresses = assertTarget(process.env);
  const schema = `liveness_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({...DB_DEFAULTS, max: 1});
  let pool, created = false;
  const close = async () => {
    await pool?.end();
    try { if (created) await admin.query(`DROP SCHEMA ${quote(schema)} CASCADE`); }
    finally { await admin.end(); }
  };
  try {
    const identity = (await admin.query(`SELECT current_database() AS database, current_user AS actor,
      host(inet_server_addr()) AS address, inet_server_port() AS port`)).rows[0];
    if (identity.database !== DB_DEFAULTS.database || identity.actor !== DB_DEFAULTS.user
      || !serverAddresses.has(identity.address) || identity.port !== DB_DEFAULTS.port) {
      throw Error('liveness fixture actual PostgreSQL identity mismatch');
    }
    await admin.query(`CREATE SCHEMA ${quote(schema)}`); created = true;
    for (const table of tables) {
      await admin.query(`CREATE TABLE ${quote(schema)}.${quote(table)} (LIKE public.${quote(table)} INCLUDING ALL)`);
    }
    // LIKE会复制serial默认值；重绑到本schema的sequence后才允许业务写入。
    const serials = (await admin.query(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema=$1 AND column_default LIKE 'nextval(%'`, [schema])).rows;
    for (const {table_name: table, column_name: column} of serials) {
      const sequence = `${table}_${column}_seq`;
      await admin.query(`CREATE SEQUENCE ${quote(schema)}.${quote(sequence)}`);
      await admin.query(`ALTER TABLE ${quote(schema)}.${quote(table)} ALTER COLUMN ${quote(column)}
        SET DEFAULT nextval('${schema}.${sequence}'::regclass)`);
      await admin.query(`ALTER SEQUENCE ${quote(schema)}.${quote(sequence)}
        OWNED BY ${quote(schema)}.${quote(table)}.${quote(column)}`);
    }
    const view = (await admin.query("SELECT pg_get_viewdef('public.journeys'::regclass, true) AS definition")).rows[0].definition;
    await admin.query(`SET search_path=${quote(schema)},pg_catalog`);
    await admin.query(`CREATE VIEW ${quote(schema)}.journeys AS ${view.replaceAll('public.', `${quote(schema)}.`)}`);
    pool = new pg.Pool({...DB_DEFAULTS, max: 2,
      options: `-c search_path=${schema},pg_catalog -c statement_timeout=5000`});
    return {pool, schema, identity, close};
  } catch (error) {
    await close();
    throw error;
  }
}
