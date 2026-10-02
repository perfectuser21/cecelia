import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {DB_DEFAULTS} from '../../db-config.js';
const state=vi.hoisted(()=>({pool:null}));
vi.mock('../../db.js',()=>({default:{query:(...args)=>state.pool.query(...args)}}));
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
const database=process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname.slice(1):DB_DEFAULTS.database;
if(database!=='cecelia_scratch'&&!(process.env.CI&&database==='cecelia_test'))throw Error('local scratch only');
const schema='linux_controller_'+randomUUID().replaceAll('-',''),admin=new pg.Client(options);
const pool=new pg.Pool({...options,options:`-c search_path=${schema}`});state.pool=pool;
let executor;
beforeAll(async()=>{
 await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE tasks(id UUID PRIMARY KEY,title TEXT,task_type TEXT,executor_kind TEXT CONSTRAINT tasks_executor_kind_check CHECK(executor_kind IN ('brain-local','image-janitor')),status TEXT,payload JSONB DEFAULT '{}',error_message TEXT,claimed_by TEXT,claimed_at TIMESTAMPTZ,started_at TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT now(),created_at TIMESTAMPTZ DEFAULT now());`);
 await pool.query('CREATE TABLE task_runs(task_id UUID,started_at TIMESTAMPTZ,ended_at TIMESTAMPTZ)');
 await pool.query(readFileSync(new URL('../../../migrations/512_linux_pool_controller.sql',import.meta.url),'utf8'));
 executor=await import('../../executor.js');
});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
it('增量迁移保留既有约束，拒绝未知kind',async()=>{
 await expect(pool.query("INSERT INTO tasks(id,executor_kind) VALUES($1,'invented')",[randomUUID()])).rejects.toThrow('tasks_executor_kind_check');
 await pool.query("INSERT INTO tasks(id,executor_kind) VALUES($1,'image-janitor')",[randomUUID()]);
});
it.each(['linux-pool-onboarding','linux-script-canary:fixture'])('真实SQL双探针及启动同步不回收%s',async actor=>{
 const id=randomUUID();await pool.query("INSERT INTO tasks(id,title,task_type,executor_kind,status,claimed_by,started_at) VALUES($1,'fixture','audit','linux-pool-controller','in_progress',$2,now()-interval '10 minutes')",[id,actor]);
 await executor.probeTaskLiveness();await executor.probeTaskLiveness();await executor.syncOrphanTasksOnStartup();
 expect((await pool.query('SELECT status,claimed_by FROM tasks WHERE id=$1',[id])).rows[0]).toEqual({status:'in_progress',claimed_by:actor});
 expect(executor.suspectProcesses.has(id)).toBe(false);
});
