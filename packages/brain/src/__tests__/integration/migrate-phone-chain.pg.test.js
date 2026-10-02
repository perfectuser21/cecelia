import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {DB_DEFAULTS} from '../../db-config.js';
import {runMigrations} from '../../migrate.js';
import {createPhoneScheduleSchema} from '../fixtures/phone-schedule-schema.js';
import {phoneMigrationFile} from '../fixtures/phone-main-schema.js';
const schema=`phone_chain_${process.pid}_${randomUUID().replaceAll('-','')}`;
if(DB_DEFAULTS.database!=='cecelia_scratch'&&!(process.env.CI==='true'&&/_test$/.test(DB_DEFAULTS.database)))throw Error('phone_chain_fixture_scratch_required');
const admin=new pg.Client(DB_DEFAULTS);let pool;
const directory=new URL('../../../migrations/',import.meta.url);
const suffixes=['phone_http_bindings','phone_http_leases','phone_scheduled_slots'];
beforeAll(async()=>{
 await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 pool=new pg.Pool({...DB_DEFAULTS,options:`-c search_path=${schema}`});
 await createPhoneScheduleSchema(pool,{publicClaims:true,skipHttp:true});
},180000);
afterAll(async()=>{vi.restoreAllMocks();if(pool)await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});
it('actual checkout phone bodies apply after real main ledger instead of prefix SKIP',async()=>{
 const files=fs.readdirSync(directory);const selected=suffixes.map(s=>phoneMigrationFile(files,s));
 const original=fs.readdirSync.bind(fs);vi.spyOn(fs,'readdirSync').mockImplementation((...args)=>String(args[0]).endsWith('/migrations')?selected:original(...args));
 const applied=await runMigrations(pool);expect(applied).toHaveLength(3);
 expect((await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('phone_task_owners','phone_scheduled_slots') ORDER BY table_name")).rows).toHaveLength(2);
 const ledger=(await pool.query('SELECT version FROM schema_version WHERE version=ANY($1) ORDER BY version',[['511','512','513','514',...applied]])).rows;
 expect(ledger).toHaveLength(7);expect(new Set(ledger.map(r=>r.version)).size).toBe(7);
 expect((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='phone_dispatches' AND column_name='http_binding'")).rows).toHaveLength(1);
 expect(await runMigrations(pool)).toEqual([]);
});
it('real main spans retain generated duration and occurrence indexes in private schema',async()=>{
 const columns=(await pool.query("SELECT column_name,is_generated FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='spans'")).rows;
 expect(columns).toContainEqual({column_name:'duration_ms',is_generated:'ALWAYS'});
 expect(columns.map(r=>r.column_name)).toEqual(expect.arrayContaining(['run_id','started_at','activity_id','step_id','enabler_id','occurrence_key','payload_sha256']));
 const indexes=(await pool.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename='spans'")).rows;
 expect(indexes.find(r=>r.indexname==='uq_spans_idem').indexdef).toContain('WHERE (occurrence_key IS NULL)');
 expect(indexes.find(r=>r.indexname==='uq_spans_occurrence').indexdef).toContain('WHERE (occurrence_key IS NOT NULL)');
 await expect(pool.query("INSERT INTO spans(run_id,enabler_id,started_at,executor_kind,occurrence_key,payload_sha256) VALUES('fixture',NULL,now(),'code','bad','x')")).rejects.toThrow();
 expect((await pool.query('SELECT current_database() db,current_schema() schema')).rows[0]).toEqual({db:DB_DEFAULTS.database,schema});
});
