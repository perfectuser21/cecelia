import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {DB_DEFAULTS} from '../../../db-config.js';
import {LIVE_RUNTIME_GRANTS_SQL,UNREVOKED_RUNTIME_GRANTS_SQL} from '../../active-grants.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
const database=process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname.slice(1):DB_DEFAULTS.database;
if(database!=='cecelia_scratch'&&!(process.env.CI&&database==='cecelia_test'))throw Error('local scratch only');
const db=new pg.Client(options),schema='grant_test_'+randomUUID().replaceAll('-',''),version=randomUUID(),grant=randomUUID();
beforeAll(async()=>{await db.connect();await db.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};
 CREATE TABLE execution_node_versions(id uuid,state text);
 CREATE TABLE execution_grants(id uuid,node_version_id uuid,profile_id text,surface text,provider text,state text,expires_at timestamptz);`);
 await db.query("INSERT INTO execution_node_versions VALUES($1,'active')",[version]);
 await db.query("INSERT INTO execution_grants VALUES($1,$2,'safe','managed_script','script','active',now()+interval '1 hour')",[grant,version]);});
afterAll(async()=>{await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.end();});
const observe=async grants=>(await db.query(`SELECT (${LIVE_RUNTIME_GRANTS_SQL}) AS live,(${UNREVOKED_RUNTIME_GRANTS_SQL}) AS intact
 FROM (SELECT $1::uuid AS execution_version_id,$2::jsonb AS grant_ids) a`,[version,grants])).rows[0];
it('真实PG许可链要求完整同代同profile；过期只能续验，撤销不能复活',async()=>{
 expect(await observe({safe:grant})).toEqual({live:true,intact:true});
 expect(await observe({})).toEqual({live:false,intact:false});
 expect(await observe({other:grant})).toEqual({live:false,intact:false});
 await db.query("UPDATE execution_grants SET expires_at=now()-interval '1 second'");
 expect(await observe({safe:grant})).toEqual({live:false,intact:true});
 await db.query("UPDATE execution_grants SET state='revoked'");
 expect(await observe({safe:grant})).toEqual({live:false,intact:false});
});
