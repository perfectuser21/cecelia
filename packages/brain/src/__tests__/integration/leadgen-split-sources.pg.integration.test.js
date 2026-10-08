import {beforeEach,afterEach,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {DB_DEFAULTS} from '../../db-config.js';
import {REGISTRATIONS_SQL} from '../../lib/activity-contract-store.js';
const repo='perfectuser21/zenithjoy-workspace',cap='a1000000-0000-4000-8000-000000000001';
const keys=['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'];
const id=n=>`b1000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const migration=()=>readFileSync(new URL('../../../migrations/536_leadgen_split_sources.sql',import.meta.url),'utf8');
const rollback=()=>readFileSync(new URL('../../../migrations/rollback/536_leadgen_split_sources.down.sql',import.meta.url),'utf8');
let db,schema;
beforeEach(async()=>{
 if(DB_DEFAULTS.database!=='cecelia_scratch'&&!(process.env.CI==='true'&&DB_DEFAULTS.database==='cecelia_test'))throw Error('仅允许scratch或CI隔离库');
 db=new pg.Client(DB_DEFAULTS);await db.connect();schema='leadgen_sources_'+randomUUID().replaceAll('-','');
 await db.query(`CREATE SCHEMA "${schema}";SET search_path TO "${schema}",public;CREATE TABLE workflows(LIKE public.workflows INCLUDING DEFAULTS INCLUDING CONSTRAINTS);ALTER TABLE workflows ADD PRIMARY KEY(id);CREATE TABLE schema_version(version varchar PRIMARY KEY,description text,applied_at timestamptz DEFAULT now());CREATE TABLE workflow_definition_versions(id uuid PRIMARY KEY,payload jsonb);CREATE TABLE workflow_activity_refs(workflow_id uuid,activity_id uuid,active bool,source_ref text);CREATE TABLE activity_cells(id uuid PRIMARY KEY,journey_id uuid,cell_key text);`);
 for(const [n,key,owner]of [[1,'douyin_keyword_leadgen','keyword_acquisition'],[2,'douyin_benchmark_leadgen','benchmark_link_acquisition']]){
  const version=randomUUID();await db.query(`INSERT INTO workflows(id,key,name,capability_id,channel,status,source_repo,source_path,source_workflow,source_capability,current_definition_version_id) VALUES($1,$2,$2,$3,'douyin','active',$4,$5,$6,$7,$8)`,[id(n),key,cap,repo,`product-map/contracts/${owner}.yaml`,n===1?'social-keyword-leadgen':'social-benchmark-leadgen',owner,version]);
  await db.query('INSERT INTO workflow_definition_versions VALUES($1,$2)',[version,{immutable:'old-history',n}]);await db.query('INSERT INTO workflow_activity_refs VALUES($1,$2,true,$3)',[id(n),randomUUID(),owner+'.preflight']);
 }
 for(const [i,key]of keys.entries())await db.query(`INSERT INTO workflows(id,key,name,capability_id,channel,status)VALUES($1,$2,$2,$3,'douyin','paused')`,[id(101+i),key,cap]);
 await db.query('INSERT INTO activity_cells VALUES($1,$2,$3)',[randomUUID(),cap,'regression:'+cap+':existing-step']);
});
afterEach(async()=>{if(db){await db.query('ROLLBACK');await db.query(`SET search_path TO public;DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await db.end();}});
const workflows=async()=> (await db.query('SELECT * FROM workflows ORDER BY key')).rows;
async function history(){const out={};for(const t of ['workflow_definition_versions','workflow_activity_refs','activity_cells'])out[t]=(await db.query(`SELECT * FROM ${t} ORDER BY 1`)).rows;return out;}
it('真实SQL登记四source保持paused；旧两retired保留owner、current版本及所有历史/断言',async()=>{
 const before=await workflows(),oldHistory=await history();await db.query(migration());const after=await workflows();
 for(const [i,key]of keys.entries())expect(after.find(w=>w.id===id(101+i))).toMatchObject({key,capability_id:cap,status:'paused',source_repo:repo,source_path:`product-map/contracts/${key}.yaml`,source_workflow:key.replaceAll('_','-'),source_capability:key,current_definition_version_id:null});
 for(const n of [1,2]){const old=before.find(w=>w.id===id(n)),now=after.find(w=>w.id===id(n));expect(now).toMatchObject({...old,status:'retired',updated_at:expect.any(Date)});}
 expect(await history()).toEqual(oldHistory);
 const registrations=(await db.query(REGISTRATIONS_SQL,[repo])).rows;expect(registrations).toHaveLength(6);expect(registrations.filter(w=>w.status!=='retired').map(w=>w.key).sort()).toEqual([...keys].sort());expect(registrations.find(w=>w.source_capability==='keyword_acquisition').status).toBe('retired');
});
it('迁移幂等且不能将已验收激活的新流程重降paused；回滚恢复迁移前metadata不删历史',async()=>{
 const before=await workflows(),oldHistory=await history();await db.query(migration());const applied=await workflows();await db.query(migration());expect(await workflows()).toEqual(applied);
 await db.query("UPDATE workflows SET status='active' WHERE id=$1",[id(101)]);await db.query(migration());expect((await workflows()).find(w=>w.id===id(101)).status).toBe('active');
 await db.query("UPDATE workflows SET status='paused' WHERE id=$1",[id(101)]);await db.query(rollback());expect(await workflows()).toEqual(before);expect(await history()).toEqual(oldHistory);
});
it('部分/错误骨架应原子拒绝，不能标版本成功或退役其余旧流程',async()=>{
 await db.query('DELETE FROM workflows WHERE id=$1',[id(104)]);const before=await workflows();await expect(db.query(migration())).rejects.toThrow(/LEADGEN_SPLIT_REGISTRATION_INCOMPLETE/);await db.query('ROLLBACK');expect(await workflows()).toEqual(before);expect((await db.query("SELECT * FROM schema_version WHERE version='536'")).rows).toHaveLength(0);
});

it('错误身份或后来激活必须原子拒绝，不能覆盖当前事实',async()=>{
 await db.query("UPDATE workflows SET key='another-workflow' WHERE id=$1",[id(104)]);let before=await workflows();
 await expect(db.query(migration())).rejects.toThrow(/LEADGEN_SPLIT_REGISTRATION_IDENTITY_CONFLICT/);await db.query('ROLLBACK');expect(await workflows()).toEqual(before);
 await db.query('UPDATE workflows SET key=$1,capability_id=$3 WHERE id=$2',[keys[3],id(104),randomUUID()]);before=await workflows();
 await expect(db.query(migration())).rejects.toThrow(/LEADGEN_SPLIT_REGISTRATION_IDENTITY_CONFLICT/);await db.query('ROLLBACK');expect(await workflows()).toEqual(before);
 await db.query('UPDATE workflows SET capability_id=$1 WHERE id=$2',[cap,id(104)]);await db.query(migration());
 await db.query("UPDATE workflows SET status='active' WHERE id=$1",[id(103)]);before=await workflows();
 await expect(db.query(rollback())).rejects.toThrow(/LEADGEN_SPLIT_ROLLBACK_CONFLICT/);await db.query('ROLLBACK');expect(await workflows()).toEqual(before);
 expect((await db.query("SELECT * FROM schema_version WHERE version='536'")).rows).toHaveLength(1);
});
it('空隔离库迁移不伪造workflow或版本身份',async()=>{
 await db.query('DELETE FROM workflows');await db.query(migration());expect(await workflows()).toHaveLength(0);
 expect((await db.query('SELECT * FROM migration_536_backup')).rows).toHaveLength(0);
});
