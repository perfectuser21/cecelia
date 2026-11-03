/** Migration 430 still protects immutable historical rows after runtime retirement. */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
const schema=`planner_binding_${randomUUID().replaceAll('-','')}`;
const migration=readFileSync(new URL('../../../migrations/430_planner_recovery_run_binding.sql',import.meta.url),'utf8');
const rollback=readFileSync(new URL('../../../migrations/rollback/430_planner_recovery_run_binding.down.sql',import.meta.url),'utf8');
let admin,pool;
beforeAll(async()=>{
  if(!['cecelia_scratch','cecelia_test'].includes(DB_DEFAULTS.database))throw Error('test database required');
  admin=new pg.Pool({...DB_DEFAULTS,max:1});await admin.query(`CREATE SCHEMA ${schema}`);
  pool=new pg.Pool({...DB_DEFAULTS,max:1,options:`-c search_path=${schema},pg_catalog`});
  // Restore the historical dependency columns read by the real 430 SQL guard.
  await pool.query(`CREATE TABLE tasks(id uuid PRIMARY KEY,status text);
    CREATE TABLE initiative_runs(id uuid PRIMARY KEY,initiative_id uuid,current_task_id uuid,phase text,created_source text,
      predecessor_run_id uuid,contract_id uuid,pr_url text,orchestrator_version text,record_trust_status text);
    CREATE TABLE planner_recovery_receipts(id uuid PRIMARY KEY,predecessor_run_id uuid,source_task_id uuid);
    CREATE TABLE planner_recovery_consumptions(receipt_id uuid PRIMARY KEY,successor_task_id uuid);
    CREATE TABLE schema_version(version text PRIMARY KEY,description text,applied_at timestamptz)`);
  await pool.query(migration);await pool.query(rollback);await pool.query(rollback);
  await pool.query(migration);await pool.query(migration);
});
afterAll(async()=>{await pool?.end();try{await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}finally{await admin?.end();}});
async function history(){
  const source=randomUUID(),successor=randomUUID(),predecessor=randomUUID(),run=randomUUID(),receipt=randomUUID(),initiative=randomUUID();
  await pool.query("INSERT INTO tasks(id,status) VALUES($1,'failed'),($2,'in_progress')",[source,successor]);
  await pool.query(`INSERT INTO initiative_runs(id,initiative_id,current_task_id,phase,orchestrator_version,record_trust_status)
    VALUES($1,$2,$3,'failed','v2','trusted')`,[predecessor,initiative,source]);
  await pool.query('INSERT INTO planner_recovery_receipts VALUES($1,$2,$3)',[receipt,predecessor,source]);
  await pool.query('INSERT INTO planner_recovery_consumptions VALUES($1,$2)',[receipt,successor]);
  const insert=`INSERT INTO initiative_runs(id,initiative_id,current_task_id,phase,created_source,predecessor_run_id,
    orchestrator_version,record_trust_status,planner_recovery_receipt_id)
    VALUES($1,$2,$3,'gan','planner_recovery',$4,'v2','trusted',$5)`;
  await pool.query(insert,[run,initiative,successor,predecessor,receipt]);
  return {source,successor,predecessor,run,receipt,initiative,insert};
}
describe('Planner recovery历史绑定真实SQL保障',()=>{
  it('往返迁移保留FK、唯一约束和两条不可变权威trigger',async()=>{
    expect((await pool.query(`SELECT conname,contype FROM pg_constraint WHERE conrelid='initiative_runs'::regclass
      AND conname IN ('initiative_runs_planner_recovery_receipt_fk','initiative_runs_planner_recovery_receipt_unique') ORDER BY conname`)).rows).toEqual([
      {conname:'initiative_runs_planner_recovery_receipt_fk',contype:'f'},
      {conname:'initiative_runs_planner_recovery_receipt_unique',contype:'u'}]);
    expect((await pool.query(`SELECT tgname FROM pg_trigger WHERE tgrelid='initiative_runs'::regclass
      AND NOT tgisinternal ORDER BY tgname`)).rows).toEqual([
      {tgname:'planner_recovery_run_authority'},{tgname:'planner_recovery_run_binding_immutable'}]);
  });
  it('历史receipt只能绑定一次；前任重开或伪造后继拒绝且不增行',async()=>{
    const h=await history();
    await expect(pool.query(h.insert,[randomUUID(),h.initiative,h.successor,h.predecessor,h.receipt])).rejects.toMatchObject({code:'23505'});
    await expect(pool.query(h.insert,[randomUUID(),h.initiative,randomUUID(),h.predecessor,h.receipt])).rejects.toMatchObject({code:'23514'});
    await pool.query("UPDATE tasks SET status='in_progress' WHERE id=$1",[h.source]);
    await expect(pool.query(h.insert,[randomUUID(),h.initiative,h.successor,h.predecessor,h.receipt])).rejects.toMatchObject({code:'23514'});
    expect((await pool.query('SELECT count(*)::int AS count FROM initiative_runs WHERE planner_recovery_receipt_id=$1',[h.receipt])).rows[0].count).toBe(1);
  });
  it('历史绑定与身份不可修改，普通run不能改写成无receipt恢复run',async()=>{
    const h=await history();
    for(const assignment of ['planner_recovery_receipt_id=NULL',"created_source='historical_reconstruction'",'initiative_id=gen_random_uuid()',
      'predecessor_run_id=gen_random_uuid()','current_task_id=gen_random_uuid()',"orchestrator_version='v1'","record_trust_status='untrusted'"]) {
      await expect(pool.query(`UPDATE initiative_runs SET ${assignment} WHERE id=$1`,[h.run])).rejects.toMatchObject({code:'23514'});
    }
    await expect(pool.query("UPDATE initiative_runs SET created_source='planner_recovery' WHERE id=$1",[h.predecessor])).rejects.toMatchObject({code:'23514'});
    expect((await pool.query('SELECT planner_recovery_receipt_id FROM initiative_runs WHERE id=$1',[h.run])).rows[0].planner_recovery_receipt_id).toBe(h.receipt);
  });
});
