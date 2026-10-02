import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import pg from 'pg';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {DB_DEFAULTS} from '../db-config.js';
import {endpoint} from '../__tests__/fixtures/phone-http.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
if(!/_(scratch|test)$/.test(process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname:DB_DEFAULTS.database))throw Error('scratch/test required');
const schema=`phone_http_${process.pid}_${randomUUID().replaceAll('-','')}`;
const admin=new pg.Client(options),pool=new pg.Pool({...options,options:`-c search_path=${schema},public`});
const registryId=randomUUID();let revision=0;
async function version(e){const id=randomUUID();await pool.query("INSERT INTO execution_node_versions(id,machine_registry_id,revision,identity_mode,worker_id,platform,endpoints,profile,config_hash) VALUES($1,$2,$3,'legacy-v1','fixture-worker','darwin',$4,'{}',$5)",[id,registryId,++revision,{phone_hub:e},'a'.repeat(64)]);return id;}
beforeAll(async()=>{
 await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,status TEXT);CREATE TABLE tasks(id UUID PRIMARY KEY,status TEXT);CREATE TABLE capacity_reservations(id UUID PRIMARY KEY);CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ);`);
 await pool.query(readFileSync(new URL('../../migrations/503_execution_directory.sql',import.meta.url),'utf8'));
 // RED uses the real pre-migration DB: malformed bindings must be rejected even when the new migration is absent.
 const migration=new URL('../../migrations/509_phone_http_bindings.sql',import.meta.url);if(existsSync(migration))await pool.query(readFileSync(migration,'utf8'));
 await pool.query("INSERT INTO system_registry VALUES($1,'machine','active')",[registryId]);await pool.query("INSERT INTO execution_nodes(machine_registry_id,canonical_id) VALUES($1,'fixture-machine')",[registryId]);
});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});
it('真实PG拒完整binding缺字段、未知额外字段和错physical machine',async()=>{
 for(const patch of [{hub_boot_id:null},{hub_config_digest:'unknown'},{physical:{...endpoint().physical,machine_id:'foreign'}},{available:1},{http_endpoint:'http://host:3459/?x=1'}])await expect(version({...endpoint(),...patch})).rejects.toThrow('phone_http_endpoint_invalid');
 const missing=endpoint();delete missing.physical.action_digest;await expect(version(missing)).rejects.toThrow('phone_http_endpoint_invalid');
});
it('真实PG保留旧版本binding，版本不可变且默认零grant',async()=>{
 const id=await version(endpoint());await pool.query('UPDATE execution_nodes SET current_version_id=$1 WHERE machine_registry_id=$2',[id,registryId]);
 await expect(pool.query("UPDATE execution_node_versions SET endpoints='{}' WHERE id=$1",[id])).rejects.toThrow('execution_version_immutable');
 const {resolvePhoneHubBinding}=await import('./http-binding.js');
 const next=await version({...endpoint(),hub_boot_id:'next-observed-hub-boot'});await pool.query('UPDATE execution_nodes SET current_version_id=$1 WHERE machine_registry_id=$2',[next,registryId]);
 expect((await resolvePhoneHubBinding(pool,{executionVersionId:id,machineId:'fixture-machine'})).hub_boot_id).toBe(endpoint().hub_boot_id);
 expect((await pool.query('SELECT * FROM execution_grants')).rows).toEqual([]);
});
it('既有无HTTP节点仍合法，不派生URL或创建grant',async()=>{
 const id=randomUUID();await pool.query("INSERT INTO execution_node_versions(id,machine_registry_id,revision,identity_mode,worker_id,platform,endpoints,profile,config_hash) VALUES($1,$2,$3,'legacy-v1','old-worker','darwin',$4,'{}','old')",[id,registryId,++revision,{worker:'http://old:5231/'}]);
 const {resolvePhoneHubBinding}=await import('./http-binding.js');await expect(resolvePhoneHubBinding(pool,{executionVersionId:id,machineId:'fixture-machine'})).rejects.toThrow('phone_http_binding_unavailable');
 expect((await pool.query('SELECT endpoints FROM execution_node_versions WHERE id=$1',[id])).rows[0].endpoints).toEqual({worker:'http://old:5231/'});
});
