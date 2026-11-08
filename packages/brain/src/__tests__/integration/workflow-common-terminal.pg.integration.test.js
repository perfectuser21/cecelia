import {it,expect,afterEach} from 'vitest';
// 与现役 PR 集成入口共用独立 PG 回归，确保交付门禁进入必需检查。
import './project-progress-no-pr.pg.integration.test.js';
import './metrics-pr-merged-no-pr.pg.integration.test.js';
import './postdeploy-snapshot.pg.integration.test.js';
import './retired-auto-qiumi-lock.pg.integration.test.js';
import './retired-auto-sweeper-race.pg.integration.test.js';
import pg from 'pg';
import {DB_DEFAULTS} from '../../db-config.js';
import {buildTerminalUpdate} from '../../lib/task-terminal.js';
const id='44444444-4444-4444-8444-444444444444',run='55555555-5555-4555-8555-555555555555';
let db;
afterEach(async()=>{if(db){await db.query('ROLLBACK');await db.end();db=null;}});
async function fixture(){
 if(DB_DEFAULTS.database!=='cecelia_scratch'&&!(process.env.CI==='true'&&DB_DEFAULTS.database==='cecelia_test'))throw Error('isolated scratch only');
 db=new pg.Client({...DB_DEFAULTS,connectionTimeoutMillis:2000});await db.connect();
 expect((await db.query('SELECT current_database() db')).rows[0].db).toBe(DB_DEFAULTS.database);
 await db.query('BEGIN');
 await db.query('CREATE TEMP TABLE tasks(id uuid PRIMARY KEY,status text,claimed_by text,claimed_at timestamptz,updated_at timestamptz,completed_at timestamptz,payload jsonb,result jsonb) ON COMMIT DROP');
 await db.query('CREATE TEMP TABLE task_runs(task_id uuid,run_id uuid,status text,ended_at timestamptz,context jsonb) ON COMMIT DROP');
 const result={workflow_common_runner:{task_id:id,run_id:run},common_runner:{run_id:run},common_runner_observation:{evidence:{central_readback:{recording_status:'confirmed',status:'success'},authenticated_receipt:{run_id:run}}}};
 await db.query("INSERT INTO tasks VALUES($1,'in_progress','common-runner',NOW(),NOW(),NULL,$2,$3)",[id,{commander_protocol:'commander-v2'},result]);
 await db.query("INSERT INTO task_runs VALUES($1,$2,'success',NOW(),$3)",[id,run,{source:'workflow-common-runner'}]);
}
it('真实PG迁移v2不伪造Commander final，同run中央确认才可完成',async()=>{
 await fixture();const {sql,params}=buildTerminalUpdate(id,'completed');
 expect((await db.query(sql,params)).rows[0]).toEqual({id,status:'completed'});
 expect((await db.query('SELECT result FROM tasks')).rows[0].result.workflow_control).toBeUndefined();
});
it.each(['pending','wrong_receipt','wrong_binding','wrong_source','unfinished','failed_run','wrong_owner','no_run','execution_unknown','legacy_pass','ordinary_missing_proof'])('真实PG缺独立证明%s保持in_progress',async kind=>{
 await fixture();
 if(kind==='pending')await db.query("UPDATE tasks SET result=jsonb_set(result,'{common_runner_observation,evidence,central_readback,recording_status}','\"pending\"')");
 if(kind==='wrong_receipt')await db.query("UPDATE tasks SET result=jsonb_set(result,'{common_runner_observation,evidence,authenticated_receipt,run_id}','\"other\"')");
 if(kind==='wrong_binding')await db.query("UPDATE tasks SET result=jsonb_set(result,'{workflow_common_runner,run_id}','\"other\"')");
 if(kind==='wrong_source')await db.query("UPDATE task_runs SET context='{\"source\":\"agent\"}'");
 if(kind==='unfinished')await db.query('UPDATE task_runs SET ended_at=NULL');
 if(kind==='failed_run')await db.query("UPDATE task_runs SET status='failed'");
 if(kind==='wrong_owner')await db.query("UPDATE tasks SET claimed_by='commander'");
 if(kind==='no_run')await db.query('DELETE FROM task_runs');
 if(kind==='execution_unknown')await db.query("UPDATE tasks SET result=jsonb_set(result,'{common_runner_observation,evidence,authenticated_receipt,execution_unknown}','true')");
 if(kind==='legacy_pass'){
  await db.query("UPDATE tasks SET result=result||'{\"workflow_control\":{\"phase\":\"final\",\"verdict\":\"PASS\"}}'::jsonb");
  await db.query('DELETE FROM task_runs');
 }
 if(kind==='ordinary_missing_proof'){
  await db.query("UPDATE tasks SET payload='{}'::jsonb");
  await db.query('DELETE FROM task_runs');
 }
 const {sql,params}=buildTerminalUpdate(id,'completed');expect((await db.query(sql,params)).rowCount).toBe(0);
 expect((await db.query('SELECT status FROM tasks')).rows[0].status).toBe('in_progress');
});
it.each(['failed','cancelled'])('真实PG中央%s完成迁移失败记账，未确认状态仍不能收割',async status=>{
 await fixture();
 await db.query('UPDATE task_runs SET status=$1',[status]);
 await db.query("UPDATE tasks SET result=jsonb_set(result,'{common_runner_observation,evidence,central_readback,status}',$1::jsonb)",[JSON.stringify(status)]);
 const {sql,params}=buildTerminalUpdate(id,'failed');expect((await db.query(sql,params)).rows[0]).toEqual({id,status:'failed'});
});
