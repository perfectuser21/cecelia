import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {DB_DEFAULTS} from '../../../db-config.js';
import {stopAutomaticOnboarding,internallyRetiredPool} from '../../onboarding-revocation.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
const database=process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname.slice(1):DB_DEFAULTS.database;
if(database!=='cecelia_scratch'&&!(process.env.CI&&database==='cecelia_test'))throw Error('local scratch only');
const db=new pg.Client(options),schema='revoke_test_'+randomUUID().replaceAll('-','');
beforeAll(async()=>{await db.connect();await db.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}; CREATE TABLE tasks(id uuid,claimed_by text,payload jsonb,updated_at timestamptz);`);});
afterAll(async()=>{await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.end();});
it('撤销同时封住原请求与续验子链，仅同machine内部退役可恢复',async()=>{
 const machine=randomUUID(),other=randomUUID(),retired=randomUUID();
 await db.query('INSERT INTO tasks VALUES($1,$2,$3,now()),($4,$2,$5,now()),($6,$2,$7,now())',[
  randomUUID(),'linux-pool-onboarding',{linux_pool_retired:retired,linux_onboarding:{machine_registry_id:machine}},
  randomUUID(),{node_onboarding:{id:machine,mode:'enroll'}},randomUUID(),{linux_onboarding:{machine_registry_id:other}}]);
 expect(await internallyRetiredPool(db,retired,machine)).toBe(true);expect(await internallyRetiredPool(db,retired,other)).toBe(false);
 await stopAutomaticOnboarding(db,machine);
 const payloads=(await db.query('SELECT payload FROM tasks')).rows.map(x=>x.payload);
 expect(payloads.find(x=>x.linux_onboarding?.machine_registry_id===machine).linux_onboarding.revoked).toBe(true);
 expect(payloads.find(x=>x.node_onboarding?.id===machine).node_onboarding.execution_revoked).toBe(true);
 expect(payloads.find(x=>x.linux_onboarding?.machine_registry_id===other).linux_onboarding.revoked).toBeUndefined();
 expect(await internallyRetiredPool(db,retired,machine)).toBe(false);
});
