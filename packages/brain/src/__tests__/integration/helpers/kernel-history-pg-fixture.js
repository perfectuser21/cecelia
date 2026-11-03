import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { DB_DEFAULTS } from '../../../db-config.js';

// Historical Kernel rows only. Copy the safety constraints and triggers used by
// these tests; never invoke a retired creation API or write the public schema.
const tables = ['tasks', 'initiative_runs', 'kernel_controller_sessions', 'harness_attempts',
  'harness_attempt_cleanup_outbox', 'harness_run_events', 'initiative_run_events', 'work_routing_receipts',
  'cecelia_events', 'orchestrator_decision_log', 'planner_recovery_receipts',
  'planner_recovery_consumptions', 'headed_task_takeovers', 'schema_version', 'task_runs', 'captures', 'capture_atoms', 'task_leases'];
const quote = value => `"${value.replaceAll('"', '""')}"`;
export async function kernelHistoryPgFixture({ prepareHistory } = {}) {
  if (!['127.0.0.1', 'localhost'].includes(DB_DEFAULTS.host)
    || !['cecelia_scratch', ...(process.env.CI === 'true' ? ['cecelia_test'] : [])].includes(DB_DEFAULTS.database)) {
    throw Error('Kernel history fixture requires isolated loopback scratch/CI PostgreSQL');
  }
  const schema = `kernel_history_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ ...DB_DEFAULTS, max: 1 });
  let pool, created = false;
  const close = async () => {
    await pool?.end();
    try { if (created) await admin.query(`DROP SCHEMA ${quote(schema)} CASCADE`); }
    finally { await admin.end(); }
  };
  try {
    const identity = (await admin.query('SELECT current_database() AS database,current_user AS actor')).rows[0];
    if (identity.database !== DB_DEFAULTS.database || identity.actor !== DB_DEFAULTS.user) throw Error('fixture identity mismatch');
    await admin.query(`CREATE SCHEMA ${quote(schema)}`); created = true;
    for (const table of tables) await admin.query(`CREATE TABLE ${quote(schema)}.${quote(table)} (LIKE public.${quote(table)} INCLUDING ALL)`);
    const serials = (await admin.query(`SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema=$1 AND column_default LIKE 'nextval(%'`, [schema])).rows;
    for (const { table_name: table, column_name: column } of serials) {
      const sequence = `${table}_${column}_seq`;
      await admin.query(`CREATE SEQUENCE ${quote(schema)}.${quote(sequence)}`);
      await admin.query(`ALTER TABLE ${quote(schema)}.${quote(table)} ALTER COLUMN ${quote(column)} SET DEFAULT nextval('${schema}.${sequence}'::regclass)`);
    }
    pool = new pg.Pool({ ...DB_DEFAULTS, max: 12, options: `-c search_path=${schema},pg_catalog -c statement_timeout=10000 -c lock_timeout=5000` });
    await prepareHistory?.(pool);
    const rewrite = sql => sql.replaceAll('public.', `${schema}.`);
    // Include the real authority, append-only, cleanup and event triggers, plus
    // their two called helpers. Task projection delivery belongs to its own suite.
    const triggers = (await admin.query(`SELECT pg_get_triggerdef(t.oid) AS definition,p.oid AS function_id
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal
      AND c.relname NOT IN ('task_runs','captures','capture_atoms','task_leases')
      AND (c.relname<>'tasks' OR t.tgname IN ('aa_headed_task_owner_guard','work_routing_task_projection_immutable'))`, [tables])).rows;
    const names = new Set(triggers.map(trigger => trigger.definition.match(/CREATE (?:CONSTRAINT )?TRIGGER ([^ ]+)/)?.[1]));
    for (const name of ['v2_controller_authority_required','initiative_run_insert_identity_lock',
      'planner_recovery_run_authority','planner_recovery_run_binding_immutable',
      'terminalize_v2_run_active_attempts','guard_harness_attempt_terminal_identity',
      'enqueue_terminal_harness_attempt_cleanup','work_routing_receipts_immutable']) {
      if (!names.has(name)) throw Error(`historical fixture missing real safety trigger: ${name}`);
    }
    const functions = (await admin.query(`SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p
      WHERE p.oid=ANY($1::oid[]) OR (p.pronamespace='public'::regnamespace AND p.proname IN
      ('headed_lock_task','append_harness_run_event','cecelia_controller_session_is_blank'))`, [triggers.map(t => t.function_id)])).rows;
    for (const { definition } of functions) await pool.query(rewrite(definition));
    for (const { definition } of triggers) await pool.query(rewrite(definition));
    const foreignKeys = (await admin.query(`SELECT c.relname,con.conname,pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_class target ON target.oid=con.confrelid
      WHERE con.contype='f' AND c.relnamespace='public'::regnamespace
      AND c.relname=ANY($1::text[]) AND target.relname=ANY($1::text[])`, [tables])).rows;
    for (const fk of foreignKeys) await pool.query(`ALTER TABLE ${quote(fk.relname)} ADD CONSTRAINT ${quote(fk.conname)} ${rewrite(fk.definition)}`);
    return { pool, schema, identity, close };
  } catch (error) { await close(); throw error; }
}
