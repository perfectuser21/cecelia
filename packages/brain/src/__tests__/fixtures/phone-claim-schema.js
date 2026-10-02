import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { createPhoneScheduleSchema, applyPhoneScheduleMigration } from './phone-schedule-schema.js';
import { importLegacyPolicy } from '../../execution-directory/store.js';
import { LEGACY_BINDINGS } from '../../execution-directory/legacy-policy.js';
import { PHONE_SCHEDULE_REGISTRY_AUTHORITY } from '../../phone-dispatch/task-authority.js';

export async function createPhoneClaimFixture(onPool, { busyLegacy = false, workerHistorical = true, publicClaims = false } = {}) {
  if (DB_DEFAULTS.database !== 'cecelia_scratch' && !(process.env.CI === 'true' && /_test$/.test(DB_DEFAULTS.database))) throw Error('phone_claim_fixture_scratch_required');
  const schema = `phone_claim_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client(DB_DEFAULTS); let pool, created = false;
  try {
  await admin.connect(); await admin.query(`CREATE SCHEMA ${schema}`); created = true;
  pool = new pg.Pool({ ...DB_DEFAULTS, max: 5, options: `-c search_path=${schema}` }); onPool(pool);
  await createPhoneScheduleSchema(pool, { publicClaims });
  await pool.query(`ALTER TABLE tasks ADD COLUMN metadata JSONB DEFAULT '{}',ADD COLUMN assigned_to TEXT,ADD COLUMN queued_at TIMESTAMPTZ DEFAULT now(),ADD COLUMN started_at TIMESTAMPTZ,ADD COLUMN error_message TEXT,ADD COLUMN status_history JSONB;
    ALTER TABLE recurring_tasks ADD COLUMN created_at TIMESTAMPTZ DEFAULT now(),ADD COLUMN executor TEXT;
    CREATE TABLE task_dependencies(from_task_id UUID,to_task_id UUID,edge_type TEXT,status TEXT);
    CREATE TABLE harness_gap_dependencies(source_task_id UUID,status TEXT);
    CREATE TABLE dispatch_events(id UUID DEFAULT gen_random_uuid(),task_id UUID,event_type TEXT,reason TEXT,created_at TIMESTAMPTZ DEFAULT now());`);
  const location = (await pool.query('SELECT current_database() db,current_schema() schema')).rows[0];
  if (location.db !== DB_DEFAULTS.database || location.schema !== schema) throw Error('phone_claim_fixture_wrong_location');
  for (const [, id, name] of LEGACY_BINDINGS) await pool.query("INSERT INTO system_registry(id,type,name,status) VALUES($1,'machine',$2,'active') ON CONFLICT(id) DO NOTHING", [id, name]);
  await importLegacyPolicy({ pool, env: { FLEET_WORKER_XIAN_MAC_M1_URL: 'http://fixture:5231' } });
  const old = randomUUID(), historical = randomUUID(), dispatch = randomUUID(), reservation = randomUUID(), grant = randomUUID(), version = randomUUID(), execution = randomUUID();
  const pin = { machine_id: 'xian-mac-m1', serial: `claim-${old}`, host: 'xian-m1', profile: 'fixture', account_id: 'fixture', action: 'adb_get_state' };
  const workerPayload = { parallel_worker: true, pipeline: 'canvas', canonical: 'exploratory' };
  await pool.query("INSERT INTO phone_registry(serial,nickname,host,profile,douyin_accounts,enabled) VALUES($1,'claim',$2,$3,$4,true)", [pin.serial, pin.host, pin.profile, JSON.stringify([{ id: 'fixture', current: true }])]);
  await pool.query("INSERT INTO tasks(id,title,status,task_type,executor_kind,priority,payload,claimed_by,created_at,location) VALUES($1,'legacy phone queue','queued','device_job','phone-ssh-controller','P0',$3,$4,now()-interval '3 hours','xian'),($2,'historic physical inventory','queued','research','phone-ssh-controller','P0',$5,NULL,now()-interval '2 hours','xian')", [old, historical, { ...workerPayload, phone_dispatch_id: dispatch }, busyLegacy ? 'interactive-dev-skill' : null, workerHistorical ? workerPayload : {}]);
  const original = (await pool.query('SELECT v.* FROM execution_nodes n JOIN execution_node_versions v ON v.id=n.current_version_id WHERE n.canonical_id=$1', [pin.machine_id])).rows[0];
  await pool.query("INSERT INTO execution_node_versions(id,machine_registry_id,revision,identity_mode,worker_id,platform,endpoints,profile,config_hash,state) VALUES($1,$2,2,'legacy-v1','claim-worker','darwin',$3,$4,$5,'active')", [version, original.machine_registry_id, { phone_ssh: { host: 'xian-m1', port: 22, user: 'administrator', hub: { host: 'mmv', port: 22, user: 'administrator' } } }, original.profile, original.config_hash]);
  await pool.query('UPDATE execution_nodes SET current_version_id=$1 WHERE canonical_id=$2', [version, pin.machine_id]);
  await pool.query("INSERT INTO execution_grants(id,node_version_id,surface,provider,account_id,profile_id,provenance,state) VALUES($1,$2,'phone_ssh','adb','fixture','adb_get_state','claim_historical_fixture','active')", [grant, version]);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("INSERT INTO capacity_reservations(id,machine_id,owner_kind,owner_key,task_id,config_digest,allocation_mode,policy_version,snapshot_time,snapshot_digest,intent_id,worker_id,worker_boot_id,execution_version_id,execution_grant_id) VALUES($1,$2,'phone',$3,$4,$5,'exclusive_unclassified','fixture',now(),$5,$6,'claim-worker','claim-boot',$7,$8)", [reservation, pin.machine_id, `phone-${dispatch}`, old, 'f'.repeat(64), execution, version, grant]);
    await c.query("INSERT INTO phone_dispatches(id,task_id,reservation_id,serial,machine_id,host,profile,account_id,execution_version_id,execution_grant_id,lease_token,execution_id,worker_id,worker_boot_id,config_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'claim-worker','claim-boot',$13)", [dispatch, old, reservation, pin.serial, pin.machine_id, pin.host, pin.profile, pin.account_id, version, grant, randomUUID(), execution, 'f'.repeat(64)]);
    await c.query('COMMIT');
  } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
  if (busyLegacy) await pool.query("INSERT INTO dispatch_events(task_id,event_type,reason) VALUES($1,'dispatched','worker_pool:slot7')", [old]);
  await applyPhoneScheduleMigration(pool, '517_phone_scheduled_slots');
  await pool.query(`CREATE FUNCTION fixture_worker_payload() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload ? 'phone_schedule' THEN NEW.payload:=NEW.payload||'{"parallel_worker":true,"pipeline":"canvas","canonical":"exploratory"}'::jsonb;NEW.created_at:=now()-interval '1 hour';END IF;RETURN NEW;END $$;
    CREATE TRIGGER fixture_worker_payload BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION fixture_worker_payload()`);
  const now = new Date(); now.setSeconds(10, 0); const due = new Date(now); due.setSeconds(0, 0);
  const store = await import('../../phone-dispatch/schedule-store.js'), auth = { registryAuthority: PHONE_SCHEDULE_REGISTRY_AUTHORITY };
  const producer = randomUUID(), phone = { ...pin, serial: `claim-${producer}` };
  await pool.query("INSERT INTO phone_registry(serial,nickname,host,profile,douyin_accounts,enabled) VALUES($1,'producer',$2,$3,$4,true)", [phone.serial, phone.host, phone.profile, JSON.stringify([{ id: 'fixture', current: true }])]);
  await pool.query("INSERT INTO recurring_tasks(id,title,task_type,cron_expression,recurrence_type,is_active,next_run_at,template) VALUES($1,'phone producer','device_job','* * * * *','cron',true,$2,$3)", [producer, due, { timezone: 'UTC', catchup_minutes: 30 }]);
  const registration = await store.registerPhoneSchedule(pool, { templateId: producer, phone, expiresAt: new Date(Date.now() + 120000) }, auth);
  await store.setPhoneScheduleState(pool, { registrationId: registration.id, revision: Number(registration.revision), state: 'active' }, auth);
  const engine = await import('../../recurring.js'), defaultDb = (await import('../../db.js')).default;
  const produced = await engine.runRecurringTasksJob(defaultDb, { now, raiseFn: () => {} });
  if (produced.created.length !== 1 || produced.errors) throw Error('phone_claim_fixture_producer_failed');
  await pool.query('UPDATE recurring_tasks SET is_active=false');
  const owner = produced.created[0].task_id;
  const ownerEvidence = (await pool.query('SELECT o.task_id,s.routing_receipt_id,w.source FROM phone_task_owners o JOIN phone_scheduled_slots s ON s.task_id=o.task_id JOIN work_routing_receipts w ON w.id=s.routing_receipt_id WHERE o.task_id=$1', [owner])).rows[0];
  if (ownerEvidence?.source !== 'scheduler') throw Error('phone_claim_fixture_receipt_missing');
  return { pool, admin, schema, location, old, historical, owner,
    async ordinary(payload = {}, priority = 'P2', taskType = 'research') { const id = randomUUID(); await pool.query("INSERT INTO tasks(id,title,status,task_type,priority,payload,location) VALUES($1,$2,'queued',$5,$3,$4,'us')", [id, `ordinary ${id}`, priority, payload, taskType]); return id; },
    async snapshot() { return { tasks: (await pool.query('SELECT * FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY id', [[old, historical, owner]])).rows, owners: (await pool.query('SELECT * FROM phone_task_owners')).rows, slots: (await pool.query('SELECT * FROM phone_scheduled_slots')).rows, leases: (await pool.query('SELECT * FROM phone_dispatches')).rows, capacity: (await pool.query('SELECT * FROM capacity_reservations')).rows, grants: (await pool.query('SELECT * FROM execution_grants ORDER BY id')).rows }; },
    async close() { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); },
  };
  } catch (error) {
    if (pool) await pool.end();
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end(); throw error;
  }
}
