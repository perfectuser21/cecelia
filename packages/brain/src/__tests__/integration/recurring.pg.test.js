import {assertPhoneFixtureDatabase} from '../fixtures/phone-main-schema.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { createPhoneScheduleSchema, applyPhoneScheduleMigration } from '../fixtures/phone-schedule-schema.js';
import { importLegacyPolicy } from '../../execution-directory/store.js';
import { LEGACY_BINDINGS } from '../../execution-directory/legacy-policy.js';
import { PHONE_SCHEDULE_REGISTRY_AUTHORITY } from '../../phone-dispatch/task-authority.js';
const holder = vi.hoisted(() => ({ pool: null }));
vi.mock('../../db.js', () => ({ default: {
  get options() { return holder.pool.options; }, query: (...args) => holder.pool.query(...args), connect: () => holder.pool.connect(),
} }));
vi.mock('../../task-updater.js', () => ({ broadcastTaskState: vi.fn() }));
assertPhoneFixtureDatabase(DB_DEFAULTS.database,process.env.CI,'recurring_fixture_scratch_required');
const schema = `recurring_expiry_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client(DB_DEFAULTS), now = new Date(); now.setSeconds(10, 0);
const due = new Date(now); due.setSeconds(0, 0);
const expired = new Date(now.getTime() - 3600000).toISOString();
let pool, engine, defaultDb, ownerTask, phoneBefore, leaseBefore;
const oldLease = randomUUID(), historicalPhone = randomUUID();
const phone = { machine_id: 'xian-mac-m1', serial: `expiry-${process.pid}`, host: 'xian-m1', profile: 'fixture', account_id: 'fixture', action: 'adb_get_state' };

beforeAll(async () => {
  await admin.connect(); await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new pg.Pool({ ...DB_DEFAULTS, max: 4, options: `-c search_path=${schema}` }); holder.pool = pool;
  expect((await pool.query('SELECT current_database() db,current_schema() schema')).rows[0]).toEqual({ db: DB_DEFAULTS.database, schema });
  await createPhoneScheduleSchema(pool);
  await pool.query(`ALTER TABLE tasks ADD COLUMN assigned_to TEXT,ADD COLUMN queued_at TIMESTAMPTZ DEFAULT now(),ADD COLUMN started_at TIMESTAMPTZ,ADD COLUMN error_message TEXT,ADD COLUMN status_history JSONB;
    ALTER TABLE recurring_tasks ADD COLUMN created_at TIMESTAMPTZ DEFAULT now(),ADD COLUMN executor TEXT;`);
  // Execute only the actual tasks index body; no fabricated migration-history entry.
  const indexSql = readFileSync(new URL('../../../migrations/074_entity_state_constraints.sql', import.meta.url), 'utf8').match(/CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_title_cancelled_unique[\s\S]*?;/)[0];
  await pool.query(indexSql);
  for (const [, id, name] of LEGACY_BINDINGS) await pool.query("INSERT INTO system_registry(id,type,name,status) VALUES($1,'machine',$2,'active') ON CONFLICT(id) DO NOTHING", [id, name]);
  await importLegacyPolicy({ pool, env: { FLEET_WORKER_XIAN_MAC_M1_URL: 'http://fixture:5231' } });
  await pool.query("INSERT INTO phone_registry(serial,nickname,host,profile,douyin_accounts,enabled) VALUES($1,'expiry fixture',$2,$3,$4,true)", [phone.serial, phone.host, phone.profile, JSON.stringify([{ id: 'fixture', current: true }])]);
  await seedHistorical(); // Real 508 task/lease, before 519; no historical owner backfill.
  await applyPhoneScheduleMigration(pool, '519_phone_scheduled_slots');
  // Fixture-only creation hook: never UPDATE a phone payload or disable a guard.
  await pool.query(`CREATE FUNCTION fixture_phone_expiry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload ? 'phone_schedule' THEN NEW.payload:=NEW.payload||jsonb_build_object('expires_at','${expired}');NEW.created_at:=now()-interval '2 hours';END IF;RETURN NEW;END $$;
    CREATE TRIGGER fixture_phone_expiry BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION fixture_phone_expiry()`);
  const id = randomUUID();
  await pool.query("INSERT INTO recurring_tasks(id,title,task_type,cron_expression,recurrence_type,is_active,next_run_at,template) VALUES($1,'expiry producer','device_job','* * * * *','cron',true,$2,$3)", [id, due, { timezone: 'UTC', catchup_minutes: 30 }]);
  const store = await import('../../phone-dispatch/schedule-store.js'), auth = { registryAuthority: PHONE_SCHEDULE_REGISTRY_AUTHORITY };
  const registration = await store.registerPhoneSchedule(pool, { templateId: id, phone, expiresAt: new Date(Date.now() + 120000) }, auth);
  await store.setPhoneScheduleState(pool, { registrationId: registration.id, revision: Number(registration.revision), state: 'active' }, auth);
  engine = await import('../../recurring.js'); defaultDb = (await import('../../db.js')).default;
  const produced = await engine.runRecurringTasksJob(defaultDb, { now, raiseFn: vi.fn() });
  expect(produced.created).toHaveLength(1);
  ownerTask = produced.created[0].task_id;
  expect((await pool.query('SELECT * FROM phone_task_owners WHERE task_id=$1', [ownerTask])).rows).toHaveLength(1);
  const receipt = (await pool.query('SELECT * FROM work_routing_receipts WHERE task_id=$1', [ownerTask])).rows[0];
  expect(receipt).toMatchObject({ source: 'scheduler', task_id: ownerTask });
  expect((await pool.query('SELECT task_id,routing_receipt_id FROM phone_scheduled_slots WHERE task_id=$1', [ownerTask])).rows[0]).toEqual({ task_id: ownerTask, routing_receipt_id: receipt.id });
  await pool.query('UPDATE recurring_tasks SET is_active=false');
  phoneBefore = await protectedRows(); leaseBefore = await leaseRows();
}, 30000);
afterAll(async () => { if (pool) await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); });

async function seedHistorical() {
  await pool.query("INSERT INTO tasks(id,title,status,task_type,executor_kind,trigger_source,payload) VALUES($1,'old reserved expiry','queued','device_job','phone-ssh-controller','recurring',$3),($2,'historical executor expiry','queued','device_job','phone-ssh-controller','recurring',$3)", [oldLease, historicalPhone, { expires_at: expired }]);
  const original = (await pool.query('SELECT v.* FROM execution_nodes n JOIN execution_node_versions v ON v.id=n.current_version_id WHERE n.canonical_id=$1', [phone.machine_id])).rows[0];
  const version = randomUUID(), grant = randomUUID(), reservation = randomUUID(), dispatch = randomUUID(), execution = randomUUID();
  await pool.query("INSERT INTO execution_node_versions(id,machine_registry_id,revision,identity_mode,worker_id,platform,endpoints,profile,config_hash,state) VALUES($1,$2,2,'legacy-v1','expiry-worker','darwin',$3,$4,$5,'active')", [version, original.machine_registry_id, { phone_ssh: { host: 'xian-m1', port: 22, user: 'administrator', hub: { host: 'mmv', port: 22, user: 'administrator' } } }, original.profile, original.config_hash]);
  await pool.query('UPDATE execution_nodes SET current_version_id=$1 WHERE canonical_id=$2', [version, phone.machine_id]);
  await pool.query("INSERT INTO execution_grants(id,node_version_id,surface,provider,account_id,profile_id,provenance,state) VALUES($1,$2,'phone_ssh','adb','fixture','adb_get_state','expiry_historical_fixture','active')", [grant, version]);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("INSERT INTO capacity_reservations(id,machine_id,owner_kind,owner_key,task_id,config_digest,allocation_mode,policy_version,snapshot_time,snapshot_digest,intent_id,worker_id,worker_boot_id,execution_version_id,execution_grant_id) VALUES($1,$2,'phone',$3,$4,$5,'exclusive_unclassified','fixture',now(),$5,$6,'expiry-worker','expiry-boot',$7,$8)", [reservation, phone.machine_id, `phone-${dispatch}`, oldLease, 'f'.repeat(64), execution, version, grant]);
    await c.query("INSERT INTO phone_dispatches(id,task_id,reservation_id,serial,machine_id,host,profile,account_id,execution_version_id,execution_grant_id,lease_token,execution_id,worker_id,worker_boot_id,config_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'expiry-worker','expiry-boot',$13)", [dispatch, oldLease, reservation, phone.serial, phone.machine_id, phone.host, phone.profile, phone.account_id, version, grant, randomUUID(), execution, 'f'.repeat(64)]);
    await c.query('COMMIT');
  } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
  // The producer uses its own serial; the old real lease remains reserved.
  phone.serial += '-producer';
  await pool.query("INSERT INTO phone_registry(serial,nickname,host,profile,douyin_accounts,enabled) VALUES($1,'producer',$2,$3,$4,true)", [phone.serial, phone.host, phone.profile, JSON.stringify([{ id: 'fixture', current: true }])]);
}
async function protectedRows() { return (await pool.query('SELECT * FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY id', [[oldLease, historicalPhone, ownerTask].filter(Boolean)])).rows; }
async function leaseRows() { return { dispatch: (await pool.query('SELECT * FROM phone_dispatches')).rows, capacity: (await pool.query('SELECT * FROM capacity_reservations')).rows, grants: (await pool.query('SELECT * FROM execution_grants ORDER BY id')).rows }; }
async function ordinary(title, payload = {}, status = 'paused') {
  const id = randomUUID(); await pool.query("INSERT INTO tasks(id,title,status,task_type,trigger_source,payload) VALUES($1,$2,$3,'research','recurring',$4)", [id, title, status, { expires_at: expired, ...payload }]); return id;
}

it('expiry actual job mixed batch preserves real producer owner, historical 508 lease and ownerless phone; ordinary same-title and spoofed payload still expire', async () => {
  const title = (await pool.query('SELECT title FROM tasks WHERE id=$1', [ownerTask])).rows[0].title;
  const sameTitle = await ordinary(title), fake = await ordinary('fake phone payload', { executor_kind: 'phone-ssh-controller', phone_authority: true, verified: true });
  const alerts = vi.fn(), summary = await engine.runRecurringTasksJob(defaultDb, { now, raiseFn: alerts });
  expect(summary).toMatchObject({ errors: 0, expired: 2 });
  expect(await protectedRows()).toEqual(phoneBefore); expect(await leaseRows()).toEqual(leaseBefore);
  const rows = (await pool.query('SELECT * FROM tasks WHERE id=ANY($1::uuid[])', [[sameTitle, fake]])).rows;
  expect(rows).toHaveLength(2);
  for (const row of rows) { expect(row.status).toBe('cancelled'); expect(row.blocked_reason).toBe('unclaimed_expired'); expect(row.error_message).toBe('unclaimed_expired'); expect(row.status_history.at(-1)).toMatchObject({ from: 'paused', to: 'cancelled', source: 'recurring_unclaimed_expired' }); }
  expect(alerts).toHaveBeenCalledTimes(1); expect(alerts.mock.calls[0][2]).toContain('2');
});

it('expiry keeps cancelled title collision and DISTINCT ON ordinary dedup, counts only RETURNING rows', async () => {
  await ordinary('already cancelled', {}, 'cancelled'); const blocked = await ordinary('already cancelled');
  const first = await ordinary('ordinary duplicates'), second = await ordinary('ordinary duplicates');
  const alerts = vi.fn(), summary = await engine.runRecurringTasksJob(defaultDb, { now, raiseFn: alerts });
  expect(summary).toMatchObject({ errors: 0, expired: 1 });
  expect((await pool.query('SELECT status FROM tasks WHERE id=$1', [blocked])).rows[0].status).toBe('paused');
  expect((await pool.query('SELECT status FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY created_at', [[first, second]])).rows.map(r => r.status)).toEqual(['cancelled', 'paused']);
  expect(alerts).toHaveBeenCalledTimes(1); expect(await protectedRows()).toEqual(phoneBefore);
});

it('final UPDATE rejects actual protected target IDs even when candidate CTE is deliberately stale (SQL negative, not an illegal rebinding race)', async () => {
  let checked = false;
  const db = { query: async (sql, args) => {
    if (String(sql).includes('WITH cand AS')) {
      checked = true; const tail = sql.slice(sql.indexOf('UPDATE tasks'));
      return pool.query(`WITH cand AS (SELECT id FROM tasks WHERE id=ANY($1::uuid[])) ${tail}`, [[oldLease, historicalPhone, ownerTask]]);
    }
    return pool.query(sql, args);
  } };
  const alerts = vi.fn(), summary = await engine.runRecurringTasksJob(db, { now, raiseFn: alerts });
  expect(checked).toBe(true); expect(summary).toMatchObject({ errors: 0, expired: 0 });
  expect(alerts).not.toHaveBeenCalled(); expect(await protectedRows()).toEqual(phoneBefore); expect(await leaseRows()).toEqual(leaseBefore);
});
