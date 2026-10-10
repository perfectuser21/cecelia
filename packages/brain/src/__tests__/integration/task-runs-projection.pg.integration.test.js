import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const liveDb=vi.hoisted(()=>({client:null}));
vi.mock('../../db.js',()=>({default:{
 query:(...args)=>liveDb.client.query(...args),
 connect:async()=>({query:(...args)=>liveDb.client.query(...args),release(){}}),
}}));
const {default:router}=await import('../../routes/projections.js');
const app=express();app.use(express.json());app.use('/api/brain',router);
import {DB_DEFAULTS} from '../../db-config.js';
import {configureTaskRunsProjection,TASK_RUNS_VESSEL} from '../../projection/task-runs-config.js';
import {OPS_DB_PROPS} from '../../ops-notion-schema.js';
let client,schema;
const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const config={database_id:id,enabled:true,actor:'smoke'};
const db={id,properties:Object.fromEntries(Object.entries(OPS_DB_PROPS.task_runs).map(([k,v])=>[k,{type:Object.keys(v)[0]}]))};
const pool={connect:async()=>({query:(...args)=>client.query(...args),release(){}})};
beforeEach(async()=>{
 if(!(DB_DEFAULTS.database==='cecelia_scratch'||process.env.CI==='true'&&DB_DEFAULTS.database==='cecelia_test'))throw Error('仅允许scratch或CI测试库');
 client=new pg.Client(DB_DEFAULTS);await client.connect();liveDb.client=client;
 expect((await client.query('SELECT current_database() AS name')).rows[0].name).toBe(DB_DEFAULTS.database);
 schema='runs_'+randomUUID().replaceAll('-','');await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema}`);
 // 正式迁移DDL；不带生产种子，schema只属于本次测试。
 await client.query(readFileSync(new URL('../../../migrations/450_notion_projection_map.sql',import.meta.url),'utf8').split('-- 种子：')[0]);
 await client.query(readFileSync(new URL('../../../migrations/453_projection_map_multi_table.sql',import.meta.url),'utf8').split('INSERT INTO')[0]);
 await client.query("INSERT INTO notion_projection_map(notion_db_id,title,face,brain_table,direction,vessel,status) VALUES('unmapped:task_runs','占位','mirror','task_runs','none','pending','pending_vessel'),('old-ops','旧运行','mirror','ops_runs','push','notion-push-sync.pushOpsRuns','active')");
});
afterEach(async()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();liveDb.client=null;if(client){await client.query('ROLLBACK');if(schema)await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end();client=null;}});
it('真实唯一索引登记后重复调用幂等，旧Ops和pending占位保持',async()=>{
 const before=(await client.query('SELECT * FROM notion_projection_map ORDER BY notion_db_id')).rows;
 for(let n=0;n<2;n++)expect(await configureTaskRunsProjection(pool,config,{token:'fixture',notionReq:async()=>db})).toMatchObject({enabled:true,vessel:TASK_RUNS_VESSEL});
 expect((await client.query("SELECT * FROM notion_projection_map WHERE notion_db_id IN ('old-ops','unmapped:task_runs') ORDER BY notion_db_id")).rows).toEqual(before);
 expect((await client.query("SELECT count(*)::int AS n FROM notion_projection_map WHERE brain_table='task_runs' AND status='active'")).rows[0].n).toBe(1);
});
it('远程补列读回缺失时真实注册表零新增',async()=>{
 const broken={id,properties:{Name:{type:'title'}}};
 await expect(configureTaskRunsProjection(pool,config,{token:'fixture',notionReq:async()=>broken})).rejects.toThrow('读回不完整');
 expect((await client.query('SELECT count(*)::int AS n FROM notion_projection_map')).rows[0].n).toBe(2);
});
it('真实旧Ops库归属拒绝，远程服务不被调用',async()=>{
 await client.query("UPDATE notion_projection_map SET notion_db_id=$1 WHERE brain_table='ops_runs'",[id]);
 let calls=0;await expect(configureTaskRunsProjection(pool,config,{token:'fixture',notionReq:async()=>{calls++;return db;}})).rejects.toThrow('拒绝抢占');expect(calls).toBe(0);
});

it('正式HTTP入口通过真实PG登记，鉴权和显式启用失败不写入',async()=>{
 vi.stubEnv('CECELIA_INTERNAL_TOKEN','fixture-token');vi.stubEnv('NOTION_API_KEY','fixture-notion-token');
 const fetchMock=vi.fn(async()=>({ok:true,json:async()=>db}));vi.stubGlobal('fetch',fetchMock);
 const endpoint='/api/brain/projections/notion/task-runs/configure';
 expect((await request(app).post(endpoint).send(config)).status).toBe(401);
 expect((await request(app).post(endpoint).set('X-Internal-Token','fixture-token').send({...config,enabled:false})).status).toBe(400);
 expect(fetchMock).not.toHaveBeenCalled();
 expect((await client.query('SELECT count(*)::int AS n FROM notion_projection_map')).rows[0].n).toBe(2);
 const response=await request(app).post(endpoint).set('X-Internal-Token','fixture-token').send(config);
 expect(response.status).toBe(200);expect(response.body).toMatchObject({database_id:id,enabled:true,vessel:TASK_RUNS_VESSEL});
 expect((await client.query("SELECT status,vessel,direction FROM notion_projection_map WHERE notion_db_id=$1",[id])).rows).toEqual([{status:'active',vessel:TASK_RUNS_VESSEL,direction:'push'}]);
 expect(fetchMock.mock.calls.every(([url])=>url===`https://api.notion.com/v1/databases/${id}`)).toBe(true);
});
