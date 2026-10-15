import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { applyTreeLegacyLayout } from '../../lib/tree-legacy-layout.js';

const TASK = 'a2b3101f-f76b-4d13-816e-7c42926c2875';
const DECISION = '5155c28c-ce2a-4452-87d4-cefb0362bf34';
let admin, pool, schema;
beforeAll(async () => {
  if (DB_DEFAULTS.database !== 'cecelia_scratch' && !(process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test')) throw Error('仅允许隔离库');
  admin = new pg.Client(DB_DEFAULTS); await admin.connect();
  expect((await admin.query('SELECT current_database() name')).rows[0].name).toBe(DB_DEFAULTS.database);
  schema = `layout_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const table of ['tasks','decisions','value_streams','capabilities','workflows','activities','workflow_activity_refs','activity_definition_versions'])
    await admin.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
  pool = new pg.Pool({...DB_DEFAULTS,options:`-c search_path=${schema}`});
});
afterAll(async () => { await pool?.end(); if (schema) await admin?.query(`DROP SCHEMA ${schema} CASCADE`); await admin?.end(); });
it('真实 PG 原子改挂、回执和重放，失效决策拒绝重放', async () => {
  const ids = Array.from({length:5},randomUUID);
  const [vs,oldCap,newCap,wf,ref] = ids, activity=randomUUID();
  await pool.query('INSERT INTO tasks(id,title,result) VALUES($1,$2,$3)',[TASK,'主任务',{keep:'yes'}]);
  await pool.query("INSERT INTO decisions(id,made_by,status) VALUES($1,'user','active')",[DECISION]);
  await pool.query("INSERT INTO value_streams(id,name,status) VALUES($1,'流','active')",[vs]);
  await pool.query("INSERT INTO capabilities(id,name,parent_journey_id,status) VALUES($1,'旧',$3,'active'),($2,'新',$3,'active')",[oldCap,newCap,vs]);
  await pool.query("INSERT INTO workflows(id,capability_id,key,name,channel) VALUES($1,$2,$3,'旧流程','test')",[wf,oldCap,`test-${wf}`]);
  await pool.query("INSERT INTO activities(id,name,status) VALUES($1,'活动','active')",[activity]);
  await pool.query("INSERT INTO workflow_activity_refs(id,workflow_id,slot_key,activity_id,sequence_no) VALUES($1,$2,'one',$3,1)",[ref,wf,activity]);
  const payload={actor:'主会话',task_id:TASK,decision_id:DECISION,client_request_id:randomUUID(),changes:[{workflow_id:wf,expected_capability_id:oldCap,target_capability_id:newCap,expected_active_reference_ids:[ref],deactivate_reference_ids:[ref],deprecate_detached:true}]};
  const first=await applyTreeLegacyLayout(pool,payload);
  expect(first.replayed).toBe(false); expect(first.receipt.readback_verified).toBe(true);
  expect((await pool.query('SELECT capability_id FROM workflows WHERE id=$1',[wf])).rows[0].capability_id).toBe(newCap);
  expect((await pool.query('SELECT active FROM workflow_activity_refs WHERE id=$1',[ref])).rows[0].active).toBe(false);
  expect((await pool.query('SELECT status FROM activities WHERE id=$1',[activity])).rows[0].status).toBe('deprecated');
  expect((await applyTreeLegacyLayout(pool,payload)).replayed).toBe(true);
  const result=(await pool.query('SELECT result FROM tasks WHERE id=$1',[TASK])).rows[0].result;
  expect(result.keep).toBe('yes'); expect(result.tree_legacy_layout_receipts).toHaveLength(1);
  await pool.query("UPDATE decisions SET status='expired' WHERE id=$1",[DECISION]);
  await expect(applyTreeLegacyLayout(pool,payload)).rejects.toMatchObject({status:409});
});
