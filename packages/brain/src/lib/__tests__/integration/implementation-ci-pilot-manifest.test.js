import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {versionsDatabase} from '../../../__tests__/fixtures/definition-versions-db.js';
import {preparePilotManifestAdvance,advancePilotManifest} from '../../implementation-ci-pilot-manifest.js';
import {preparePilotSchema} from '../../../__tests__/fixtures/pilot-private-schema.js';
import {buildPilotManifest} from '../../../../../../scripts/map/register-capability-pilots.mjs';
it('implementation-ci-pilot-manifest只接力既有规范UUID与父级；旧scope无写',async()=>{
  const fixture=await versionsDatabase(),{db}=fixture;
  try{
    for(const table of ['map_scope_repositories','map_manifest_versions'])await db.query(`CREATE TABLE ${table}(LIKE public.${table} INCLUDING ALL)`);
    const manifest=buildPilotManifest('phones',{revision:'a'.repeat(40),decision:randomUUID()});
    for(const node of manifest.value_streams)await db.query('INSERT INTO value_streams(id,name) VALUES($1,$2)',[node.brain_binding.entity_id,node.name]);
    for(const node of manifest.capabilities)await db.query('INSERT INTO capabilities(id,name,parent_journey_id,capability_code) VALUES($1,$2,$3,$4)',[node.brain_binding.entity_id,node.name,manifest.value_streams.find(v=>v.key===node.value_stream_key).brain_binding.entity_id,node.key]);
    await db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('zenithjoy','zenithjoy-pilot-source','legacy-ledger-v1',$1)",[{source_repo:'perfectuser21/zenithjoy-workspace'}]);
    await db.query("INSERT INTO map_manifest_versions(scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES('zenithjoy',1,$1,$2,$3,'active',NOW())",[manifest.source_decision_id,manifest,'a'.repeat(64)]);
    const q={scope:'zenithjoy',repo:'perfectuser21/zenithjoy-workspace',revision:'b'.repeat(40)};
    const before=(await db.query('SELECT * FROM map_manifest_versions')).rows;
    expect((await preparePilotManifestAdvance(db,q)).manifest.capabilities[0].brain_binding.source_revision).toBe(q.revision);
    expect(await preparePilotManifestAdvance(db,{...q,scope:'zenithjoy-workspace'})).toBeNull();
    expect((await db.query('SELECT * FROM map_manifest_versions')).rows).toEqual(before);
    await db.query('UPDATE capabilities SET parent_journey_id=NULL WHERE id=$1',[manifest.capabilities[0].brain_binding.entity_id]);
    await expect(preparePilotManifestAdvance(db,q)).rejects.toMatchObject({code:'IMPLEMENTATION_CI_PILOT_MAPPING_CHANGED'});
    await db.query('UPDATE capabilities SET parent_journey_id=$1 WHERE id=$2',[manifest.value_streams[0].brain_binding.entity_id,manifest.capabilities[0].brain_binding.entity_id]);
    manifest.capabilities[0].brain_binding.entity_id=randomUUID();
    await db.query('UPDATE map_manifest_versions SET manifest=$1',[manifest]);
    await expect(preparePilotManifestAdvance(db,q)).rejects.toMatchObject({code:'IMPLEMENTATION_CI_PILOT_MAPPING_CHANGED'});
  }finally{await fixture.close();}
});

// 真v52旧态（来源899）固定，不随新phones配置生成；防迁移fixture一起改变掩盖RED。
const deployedV52={"scope_key":"zenithjoy","boundaries":[],"capabilities":[{"key":"keyword_acquisition","name":"关键词获客","order":1,"brain_binding":{"entity_id":"a1000000-0000-4000-8000-000000000001","entity_type":"capability","source_repo":"perfectuser21/zenithjoy-workspace","source_revision":"8990941bc9cc5780e6a1a50fc0944753b4894e72"},"value_stream_key":"acquisition"},{"key":"benchmark_link_acquisition","name":"对标获客","order":2,"brain_binding":{"entity_id":"a1000000-0000-4000-8000-000000000002","entity_type":"capability","source_repo":"perfectuser21/zenithjoy-workspace","source_revision":"8990941bc9cc5780e6a1a50fc0944753b4894e72"},"value_stream_key":"acquisition"}],"crosscut_pool":[],"value_streams":[{"key":"acquisition","name":"获客","order":1,"perceiver":"业务负责人","brain_binding":{"entity_id":"afa6abca-53c0-4815-8594-b7fb81ca547f","entity_type":"value_stream","source_repo":"perfectuser21/zenithjoy-workspace","source_revision":"8990941bc9cc5780e6a1a50fc0944753b4894e72"}}],"schema_version":1,"source_decision_id":"54e27a23-6281-4985-bb29-e83c8d74f3da","shared_prerequisites":{"items":[],"reason":"试点未登记共享前置项","applicable":false}};
it('真实v52只补明确发布流/能力，同SHA幂等与下一SHA接力，保业务字段和旧版本',async()=>{
 const f=await versionsDatabase(),{db}=f;
 try{
  await preparePilotSchema(db);
  const old=structuredClone(deployedV52),revision=old.capabilities[0].brain_binding.source_revision;
  for(const node of old.value_streams)await db.query('INSERT INTO value_streams(id,name) VALUES($1,$2)',[node.brain_binding.entity_id,node.name]);
  for(const node of old.capabilities)await db.query('INSERT INTO capabilities(id,name,parent_journey_id) VALUES($1,$2,$3)',[node.brain_binding.entity_id,node.name,old.value_streams[0].brain_binding.entity_id]);
  await db.query("INSERT INTO value_streams(id,name) VALUES('1489c4e5-7806-4152-a091-b7d32e202ce7','内容生产')");
  await db.query("INSERT INTO capabilities(id,name,parent_journey_id,capability_code) VALUES('24987ee5-53a0-4c37-946f-1b749954cac7','内容生产 · 多平台发布','1489c4e5-7806-4152-a091-b7d32e202ce7','android_worker_publish')");
  await db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('zenithjoy','zenithjoy-pilot-source','legacy-ledger-v1',$1)",[{source_repo:'perfectuser21/zenithjoy-workspace'}]);
  await db.query('INSERT INTO decisions(id) VALUES($1)',[old.source_decision_id]);
  await db.query("INSERT INTO map_manifest_versions(scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES('zenithjoy',52,$1,$2,$3,'active',NOW())",[old.source_decision_id,old,'a'.repeat(64)]);
  const q={scope:'zenithjoy',repo:'perfectuser21/zenithjoy-workspace',revision},before=(await db.query('SELECT * FROM map_manifest_versions')).rows;
  const plan=await preparePilotManifestAdvance(db,q);
  expect(plan?.manifest.value_streams).toHaveLength(2);expect(plan.manifest.capabilities).toHaveLength(3);
  expect(plan.manifest.value_streams[0]).toEqual(old.value_streams[0]);expect(plan.manifest.capabilities.slice(0,2)).toEqual(old.capabilities);
  expect(plan.manifest.source_decision_id).toBe(old.source_decision_id);
  expect(plan.manifest.capabilities[2]).toMatchObject({key:'android_worker_publish',value_stream_key:'content_production',brain_binding:{entity_id:'24987ee5-53a0-4c37-946f-1b749954cac7',source_revision:revision}});
  expect((await db.query('SELECT * FROM map_manifest_versions')).rows).toEqual(before);
  await advancePilotManifest(db,plan,async()=>{});
  expect((await db.query('SELECT manifest,status FROM map_manifest_versions WHERE version=52')).rows[0]).toEqual({manifest:old,status:'superseded'});
  expect((await db.query("SELECT count(*)::int n FROM map_manifest_versions WHERE status='active'")).rows[0].n).toBe(1);
  expect(await preparePilotManifestAdvance(db,q)).toBeNull();
  expect((await db.query('SELECT count(*)::int n FROM map_manifest_versions')).rows[0].n).toBe(2);
  const next=await preparePilotManifestAdvance(db,{...q,revision:'b'.repeat(40)});
  await advancePilotManifest(db,next,async()=>{});
  expect(await preparePilotManifestAdvance(db,{...q,revision:'b'.repeat(40)})).toBeNull();
  expect([...next.manifest.value_streams,...next.manifest.capabilities].every(n=>n.brain_binding.source_revision==='b'.repeat(40))).toBe(true);
  await db.query('BEGIN');
  for(const mutate of [m=>m.capabilities.pop(),m=>m.capabilities.push(structuredClone(m.capabilities[0])),m=>m.value_streams.push({...m.value_streams[0],key:'unknown'}),m=>m.capabilities[0].brain_binding.entity_id=randomUUID(),m=>m.capabilities.shift(),m=>m.capabilities[2].brain_binding.entity_id=m.capabilities[0].brain_binding.entity_id,m=>m.capabilities[0].brain_binding.source_repo='wrong/repo',m=>m.capabilities[0].brain_binding.source_revision='not-fixed']){
   const bad=structuredClone(plan.manifest);mutate(bad);await db.query('SAVEPOINT bad_manifest');
   await db.query("UPDATE map_manifest_versions SET status='superseded' WHERE status='active'");
   await db.query("INSERT INTO map_manifest_versions(scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES('zenithjoy',55,$1,$2,$3,'active',NOW())",[old.source_decision_id,bad,'c'.repeat(64)]);
   const beforeBad=(await db.query('SELECT * FROM map_manifest_versions ORDER BY version')).rows;
   await expect(preparePilotManifestAdvance(db,q)).rejects.toMatchObject({code:'IMPLEMENTATION_CI_PILOT_MAPPING_CHANGED'});
   expect((await db.query('SELECT * FROM map_manifest_versions ORDER BY version')).rows).toEqual(beforeBad);
   await db.query('ROLLBACK TO SAVEPOINT bad_manifest');
  }
  await db.query('ROLLBACK');
  for(const sql of ["UPDATE capabilities SET capability_code='wrong' WHERE id='24987ee5-53a0-4c37-946f-1b749954cac7'","UPDATE capabilities SET parent_journey_id='afa6abca-53c0-4815-8594-b7fb81ca547f' WHERE id='24987ee5-53a0-4c37-946f-1b749954cac7'"]){
   await db.query('BEGIN');await db.query(sql);
   await expect(preparePilotManifestAdvance(db,q)).rejects.toMatchObject({code:'IMPLEMENTATION_CI_PILOT_MAPPING_CHANGED'});
   await db.query('ROLLBACK');
  }
  await expect(preparePilotManifestAdvance(db,{...q,revision:'branch-name'})).rejects.toMatchObject({code:'IMPLEMENTATION_CI_PILOT_MAPPING_CHANGED'});
  await db.query('BEGIN');
  const indexes=(await db.query("SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND tablename='map_manifest_versions' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%status%'")).rows;
  for(const i of indexes)await db.query(`DROP INDEX ${i.indexname}`);
  await db.query("UPDATE map_manifest_versions SET status='active' WHERE version=52");
  await expect(preparePilotManifestAdvance(db,q)).rejects.toMatchObject({code:'IMPLEMENTATION_CI_PILOT_MAPPING_CHANGED'});
  await db.query('ROLLBACK');
 }finally{await f.close();}
});
