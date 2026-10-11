import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { registerWorkflowSource } from '../../lib/workflow-source-registration.js';
const database=process.env.DB_NAME||'cecelia_scratch';
if(database!=='cecelia_scratch'&&!(database==='cecelia_test'&&process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'))throw Error('只允许scratch或正式CI测试库');
const schema=`source_cas_${randomUUID().replaceAll('-','')}`,id=randomUUID(),cap=randomUUID();
const pool=new pg.Pool({database,host:process.env.DB_HOST||'/tmp',user:process.env.DB_USER||'administrator',max:3});
const scoped={connect:async()=>{const c=await pool.connect();await c.query(`SET search_path TO ${schema}`);return c;}};
const request={workflow_id:id,capability_id:cap,revision:'a'.repeat(40),actor:'Codex-test',source_repo:'perfectuser21/zenithjoy-workspace',source_path:'product-map/contracts/douyin_video_publish.yaml',source_capability:'douyin_video_publish',source_workflow:'douyin-video-publish',expected:{source_repo:null,source_path:null,source_capability:null,source_workflow:null,contract_sync_revision:0}};
const options={readContract:async()=>({sha256:'f'.repeat(64),document:{capability:'android_worker_publish',contract_key:'douyin_video_publish',workflow:'douyin-video-publish',brain_workflow_key:'douyin_video_publish.android',source_repo:request.source_repo,activities:[]}})};
beforeAll(async()=>{
 await pool.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE ${schema}.capabilities(id uuid PRIMARY KEY,capability_code text NOT NULL)`);
 await pool.query(`CREATE TABLE ${schema}.workflows(id uuid PRIMARY KEY,key text,capability_id uuid REFERENCES ${schema}.capabilities(id),status text,version text,source_repo text,source_path text,source_workflow text,source_capability text,contract_sync_revision integer DEFAULT 0,updated_at timestamptz)`);
 await pool.query(`INSERT INTO ${schema}.capabilities VALUES($1,'android_worker_publish')`,[cap]);
 await pool.query(`INSERT INTO ${schema}.workflows(id,key,capability_id,status,version) VALUES($1,'douyin_video_publish.android',$2,'paused','1.0')`,[id,cap]);
});
afterAll(async()=>{await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();});
it('双连接同旧版本只能成功一次；真实来源回读，不激活、不改版本',async()=>{
 const outcomes=await Promise.allSettled([registerWorkflowSource(scoped,request,options),registerWorkflowSource(scoped,request,options)]);
 expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(outcomes.find(r=>r.status==='rejected').reason.code).toBe('WORKFLOW_SOURCE_CAS_CONFLICT');
 const row=(await pool.query(`SELECT * FROM ${schema}.workflows WHERE id=$1`,[id])).rows[0];
 expect(row).toMatchObject({source_repo:request.source_repo,source_path:request.source_path,source_workflow:request.source_workflow,source_capability:request.source_capability,contract_sync_revision:1,status:'paused',version:'1.0'});
});
