import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { reconcileOwnerlessKernelRuns } from '../../orchestrator/kernel-controller-lifecycle.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../',import.meta.url));
const DOWN = [422,421,420,419,418,417,416];
let adminPool;
let pool;
let databaseName;

function quote(value) {
  if (!/^routing_roundtrip_[a-z0-9_]+$/.test(value)) throw new Error('unsafe database name');
  return `"${value}"`;
}

function migrate() {
  execFileSync(process.execPath,['src/migrate.js'],{
    cwd:BRAIN_ROOT,
    env:{...process.env,NODE_ENV:'test',DB_HOST:DB_DEFAULTS.host,
      DB_PORT:String(DB_DEFAULTS.port),DB_USER:DB_DEFAULTS.user,
      DB_PASSWORD:DB_DEFAULTS.password,DB_NAME:databaseName},
    stdio:'pipe',
  });
}

async function assertAuthority() {
  const { rows:[shape] } = await pool.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='golden_paths' AND column_name='change_kind') AS golden_kind,
    to_regclass('map_recovery_consumptions') IS NOT NULL AS consumptions,
    to_regclass('kernel_controller_sessions') IS NOT NULL AS controller_sessions,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='capture_atoms' AND column_name='metadata') AS capture_metadata,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='map_recovery_contracts'::regclass AND conname='map_recovery_contracts_attempt_id_fkey') AS attempt_fk,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='map_recovery_contracts'::regclass AND tgname='map_recovery_contracts_immutable' AND NOT tgisinternal) AS recovery_immutable,
    NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='work_routing_receipts'::regclass AND conname='work_routing_receipts_task_id_key') AS supersession_enabled
  `);
  expect(shape).toEqual({golden_kind:true,consumptions:true,controller_sessions:true,
    capture_metadata:true,attempt_fk:true,recovery_immutable:true,supersession_enabled:true});
  const versions = await pool.query(
    `SELECT version FROM schema_version WHERE version::int BETWEEN 413 AND 422 ORDER BY version::int`,
  );
  expect(versions.rows.map(({version})=>Number(version))).toEqual([413,414,415,416,417,418,419,420,421,422]);
}

beforeAll(async()=>{
  databaseName=`routing_roundtrip_${process.pid}_${randomUUID().replaceAll('-','')}`;
  adminPool=new Pool({...DB_DEFAULTS,database:'postgres',max:1,statement_timeout:10000});
  await adminPool.query(`CREATE DATABASE ${quote(databaseName)}`);
  migrate();
  pool=new Pool({...DB_DEFAULTS,database:databaseName,max:3});
},60000);

afterAll(async()=>{
  if (pool) await pool.end().catch(()=>{});
  if (adminPool && databaseName) {
    await adminPool.query('UPDATE pg_database SET datallowconn=false WHERE datname=$1',[databaseName]).catch(()=>{});
    await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[databaseName]).catch(()=>{});
    await adminPool.query(`DROP DATABASE IF EXISTS ${quote(databaseName)}`).catch(()=>{});
  }
  if (adminPool) await adminPool.end().catch(()=>{});
},30000);

describe('production 413–415 anchors → PR migrations 往返（真 PG）',()=>{
  it('416–422 逆序 down 后 migrate 能精确重建全部合同',async()=>{
    await assertAuthority();
    for (const version of DOWN) {
      const [name] = (await import('node:fs')).readdirSync(`${BRAIN_ROOT}/migrations/rollback`)
        .filter((entry)=>entry.startsWith(`${version}_`));
      await pool.query(await readFile(`${BRAIN_ROOT}/migrations/rollback/${name}`,'utf8'));
    }
    const anchors = await pool.query(
      `SELECT version FROM schema_version WHERE version::int BETWEEN 413 AND 422 ORDER BY version::int`,
    );
    expect(anchors.rows.map(({version})=>Number(version))).toEqual([413,414,415]);
    const legacyTaskId=randomUUID();
    const legacyRunId=randomUUID();
    await pool.query(
      `INSERT INTO tasks(id,title,status,priority,task_type,trigger_source,payload)
       VALUES($1,'pre-422-ownerless','in_progress','P2','harness_initiative','integration',$2::jsonb)`,
      [legacyTaskId,JSON.stringify({initiative_id:legacyTaskId})],
    );
    await pool.query(
      `INSERT INTO initiative_runs(id,initiative_id,current_task_id,phase,orchestrator_version,
         created_source,deadline_at,controller_session_id,controller_lease_expires_at)
       VALUES($1,$2,$2,'generate','v2','historical_reconstruction',NOW()+INTERVAL '1 hour',NULL,NULL)`,
      [legacyRunId,legacyTaskId],
    );
    migrate();
    await assertAuthority();
    const migrated = await pool.query(
      `SELECT controller_session_id,controller_generation,controller_lease_expires_at
         FROM initiative_runs WHERE id=$1`,
      [legacyRunId],
    );
    expect(migrated.rows[0]).toEqual({controller_session_id:null,
      controller_generation:null,controller_lease_expires_at:null});
    const recovered=await reconcileOwnerlessKernelRuns(pool,{now:new Date()});
    expect(recovered.map(({runId})=>runId)).toContain(legacyRunId);
  });
});
