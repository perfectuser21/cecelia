import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {privateFixtureDatabase} from '../fixtures/private-fixture-db.js';
import {DB_DEFAULTS} from '../../db-config.js';
import {createPhoneScheduleSchema} from '../fixtures/phone-schedule-schema.js';
import {endpoint} from '../fixtures/phone-http.js';
import {runMigrations} from '../../migrate.js';
import {resolvePhoneHttpLeaseBinding,isPhoneHttpLeaseBinding,isPhoneHubBinding} from '../../phone-dispatch/http-binding.js';

if(process.env.TEST_DATABASE_URL)throw Error('phone_fixture_explicit_database_required');
const migrationDir=new URL('../../../migrations/',import.meta.url).pathname.replace(/\/$/,'');
const names=['517_phone_http_bindings.sql','518_phone_http_leases.sql'];
const machine='fixture-machine',host='fixture-host',serial='fixture-serial',profile='fixture-profile',account='fixture-account';
const hash='f'.repeat(64),registry=randomUUID();
let fixture,pool,sshVersion,sshRow,before,applied,repeated,httpVersion,httpRow;
async function row(table,id){return (await pool.query(`SELECT * FROM ${table} WHERE id=$1`,[id])).rows[0];}
async function snapshot(r){return {dispatch:await row('phone_dispatches',r.id),task:await row('tasks',r.task_id),reservation:await row('capacity_reservations',r.reservation_id)};}
async function version(revision,binding){
 const id=randomUUID(),e={phone_ssh:{host,port:22,user:'fixture',hub:{host:'fixture-hub',port:22,user:'fixture'}},...(binding?{phone_hub:binding}:{})};
 await pool.query(`INSERT INTO execution_node_versions(id,machine_registry_id,revision,identity_mode,worker_id,worker_boot_id,platform,endpoints,profile,config_hash,state)
 VALUES($1,$2,$3,'legacy-v1','fixture-worker','fixture-physical-boot','darwin',$4,'{}',$5,'active')`,[id,registry,revision,e,hash]);
 await pool.query('UPDATE execution_nodes SET current_version_id=$1 WHERE canonical_id=$2',[id,machine]);return id;
}
async function seedLease(versionId){
 const id=randomUUID(),task=randomUUID(),reservation=randomUUID(),execution=randomUUID(),lease=randomUUID();
 const grant=(await pool.query(`INSERT INTO execution_grants(node_version_id,surface,provider,account_id,profile_id,provenance,state)
 VALUES($1,'phone_ssh','adb',$2,'adb_get_state','isolated_partial_migration','active') RETURNING id`,[versionId,account])).rows[0].id;
 await pool.query("INSERT INTO tasks(id,title,status,task_type,executor_kind) VALUES($1,$2,'queued','device_job','phone-ssh-controller')",[task,`partial-${task}`]);
 await pool.query(`INSERT INTO capacity_reservations(id,machine_id,owner_kind,owner_key,task_id,config_digest,allocation_mode,policy_version,snapshot_time,snapshot_digest,intent_id,worker_id,worker_boot_id,execution_version_id,execution_grant_id)
 VALUES($1,$2,'phone',$3,$4,$5,'exclusive_unclassified','fixture',now(),$5,$6,'fixture-worker','fixture-physical-boot',$7,$8)`,[reservation,machine,`phone-${id}`,task,hash,execution,versionId,grant]);
 return {id,task_id:task,reservation_id:reservation,serial,machine_id:machine,host,profile,account_id:account,execution_version_id:versionId,execution_grant_id:grant,lease_token:lease,execution_id:execution,worker_id:'fixture-worker',worker_boot_id:'fixture-physical-boot',config_digest:hash,action:'adb_get_state'};
}
async function insertLease(r,binding){
 return (await pool.query(`INSERT INTO phone_dispatches(id,task_id,reservation_id,serial,machine_id,host,profile,account_id,execution_version_id,execution_grant_id,lease_token,execution_id,worker_id,worker_boot_id,config_digest${binding===undefined?'':',transport_mode,http_binding'})
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15${binding===undefined?'':",'http',$16"}) RETURNING *`,[r.id,r.task_id,r.reservation_id,r.serial,r.machine_id,r.host,r.profile,r.account_id,r.execution_version_id,r.execution_grant_id,r.lease_token,r.execution_id,r.worker_id,r.worker_boot_id,r.config_digest,...(binding===undefined?[]:[binding])])).rows[0];
}
beforeAll(async()=>{
 const actual=fs.readdirSync(migrationDir);
 for(const name of names)if(!actual.includes(name))throw Error(`required_phone_migration_absent:${name}`);
 fixture=await privateFixtureDatabase('partialphone',db=>createPhoneScheduleSchema(db,{skipHttp:true}));pool=fixture.createPool(6);
 expect((await pool.query('SELECT current_database() db,current_schema() schema')).rows[0]).toEqual({db:DB_DEFAULTS.database,schema:fixture.schema});
 await pool.query("INSERT INTO system_registry(id,type,status) VALUES($1,'machine','active')",[registry]);
 await pool.query('INSERT INTO execution_nodes(machine_registry_id,canonical_id) VALUES($1,$2)',[registry,machine]);
 await pool.query("INSERT INTO phone_registry(serial,nickname,host,profile,douyin_accounts) VALUES($1,'test',$2,$3,$4)",[serial,host,profile,JSON.stringify([{id:account,current:true}])]);
 sshVersion=await version(1);sshRow=await insertLease(await seedLease(sshVersion));
 before={row:sshRow,grants:(await pool.query('SELECT * FROM execution_grants ORDER BY id')).rows,nodes:(await pool.query('SELECT * FROM execution_nodes ORDER BY canonical_id')).rows};
 const original=fs.readdirSync.bind(fs),spy=vi.spyOn(fs,'readdirSync').mockImplementation((dir,...args)=>String(dir)===migrationDir?names:original(dir,...args));
 try{applied=await runMigrations(pool);repeated=await runMigrations(pool);}finally{spy.mockRestore();}
});
afterAll(async()=>{vi.restoreAllMocks();await fixture?.close();});
it('partial actual runner只APPLY517/518、repeat0，真实511..518八账无519对象/新grant',async()=>{
 expect(applied).toEqual(['517','518']);expect(repeated).toEqual([]);
 expect((await pool.query("SELECT version FROM schema_version WHERE version BETWEEN '511' AND '518' ORDER BY version")).rows.map(r=>r.version)).toEqual(['511','512','513','514','515','516','517','518']);
 expect((await pool.query("SELECT to_regclass('phone_task_owners') owners,to_regclass('phone_scheduled_slots') slots")).rows[0]).toEqual({owners:null,slots:null});
 expect((await pool.query("SELECT tgname FROM pg_trigger WHERE tgrelid IN ('execution_node_versions'::regclass,'phone_dispatches'::regclass) AND tgname IN ('phone_http_endpoint_guard','phone_http_lease_identity_guard') ORDER BY tgname")).rows.map(r=>r.tgname)).toEqual(['phone_http_endpoint_guard','phone_http_lease_identity_guard']);
 expect((await pool.query('SELECT * FROM execution_grants ORDER BY id')).rows).toEqual(before.grants);
 expect((await pool.query('SELECT * FROM execution_nodes ORDER BY canonical_id')).rows).toEqual(before.nodes);
});
it('旧真实508 SSH租约身份逐字保、默认SSH/null且不品牌化HTTP',async()=>{
 const {transport_mode,http_binding,...old}=await row('phone_dispatches',sshRow.id);expect(old).toEqual(before.row);expect(transport_mode).toBe('ssh');expect(http_binding).toBe(null);
 await expect(resolvePhoneHttpLeaseBinding(pool,{dispatchId:sshRow.id})).rejects.toThrow('phone_http_lease_binding_unavailable');
});
it('实际HTTP租约完整存储与品牌；unknown占位，current换代/grant撤销后读原历史',async()=>{
 const e=endpoint();httpVersion=await version(2,e);httpRow=await insertLease(await seedLease(httpVersion),{execution_version_id:httpVersion,...e});
 const b=await resolvePhoneHttpLeaseBinding(pool,{dispatchId:httpRow.id});expect(isPhoneHttpLeaseBinding(b)).toBe(true);expect(isPhoneHubBinding(b)).toBe(true);expect(isPhoneHttpLeaseBinding({...b})).toBe(false);expect(isPhoneHubBinding({...b})).toBe(false);expect(Object.isFrozen(b.physical)).toBe(true);
 await pool.query("UPDATE phone_dispatches SET state='unknown' WHERE id=$1",[httpRow.id]);
 await version(3,{...e,hub_boot_id:'next-hub'});await pool.query("UPDATE execution_grants SET state='revoked',expires_at=now()-interval '1 second' WHERE id=$1",[httpRow.execution_grant_id]);
 const historical=await resolvePhoneHttpLeaseBinding(pool,{dispatchId:httpRow.id});expect(historical.execution_version_id).toBe(httpVersion);expect(historical.http_endpoint).toBe(e.http_endpoint);expect(historical.hub_boot_id).toBe(e.hub_boot_id);
 expect((await row('phone_dispatches',httpRow.id)).state).toBe('unknown');expect((await row('capacity_reservations',httpRow.reservation_id)).status).not.toBe('released');
});
it('HTTP snapshot/mode更新由508 immutable拒；每字段错INSERT通过508后由518拒',async()=>{
 const saved=await snapshot(httpRow);
 for(const change of ["http_binding='{}'","transport_mode='ssh'","http_binding=NULL"])await expect(pool.query(`UPDATE phone_dispatches SET ${change} WHERE id=$1`,[httpRow.id])).rejects.toThrow('phone_identity_immutable');
 const e=endpoint(),v=await version(4,e),r=await seedLease(v),binding={execution_version_id:v,...e};
 const bad=[null,{}, {...binding,execution_version_id:randomUUID()},{...binding,http_endpoint:'http://foreign:3459/'},{...binding,extra:1}];
 for(const key of Object.keys(binding)){const x=structuredClone(binding);delete x[key];bad.push(x);}
 for(const key of Object.keys(binding.physical)){const x=structuredClone(binding);delete x.physical[key];bad.push(x);}
 for(const b of bad)await expect(insertLease(r,b)).rejects.toThrow('phone_http_lease_identity_mismatch');
 expect(await row('phone_dispatches',r.id)).toBeUndefined();
 const legitimate=await insertLease(r,binding);expect(legitimate.http_binding).toEqual(binding);expect(await snapshot(httpRow)).toEqual(saved);
});
it('HTTP launching/running/终态完整十五字段receipt仍由518执行关闭拒且不释放',async()=>{
 const e=endpoint(),v=await version(5,e),r=await insertLease(await seedLease(v),{execution_version_id:v,...e});
 await expect(pool.query("UPDATE phone_dispatches SET state='launching' WHERE id=$1",[r.id])).rejects.toThrow('phone_http_execution_not_connected');
 await pool.query("UPDATE phone_dispatches SET state='unknown' WHERE id=$1",[r.id]);const saved=await snapshot(r);
 await expect(pool.query("UPDATE phone_dispatches SET state='running' WHERE id=$1",[r.id])).rejects.toThrow('phone_http_execution_not_connected');
 const keys=['reservation_id','task_id','machine_id','host','serial','profile','account_id','execution_version_id','execution_grant_id','lease_token','execution_id','worker_id','worker_boot_id','action','config_digest'];
 const receipt={...Object.fromEntries(keys.map(k=>[k,r[k]])),dispatch_id:r.id,status:'failed',execution_exited:true,lock_released:true,lock_owner:r.lease_token};
 await expect(pool.query("UPDATE phone_dispatches SET state='terminal',terminal_status='failed',terminal_digest=$2,terminal_receipt=$3 WHERE id=$1",[r.id,hash,receipt])).rejects.toThrow('phone_http_execution_not_connected');
 expect(await snapshot(r)).toEqual(saved);expect(saved.task.status).toBe('queued');expect(saved.reservation.status).not.toBe('released');
});
