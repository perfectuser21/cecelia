import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {versionsDatabase} from '../../../__tests__/fixtures/definition-versions-db.js';
import {preparePilotManifestAdvance} from '../../implementation-ci-pilot-manifest.js';
import {buildPilotManifest} from '../../../../../../scripts/map/register-capability-pilots.mjs';
it('implementation-ci-pilot-manifest只接力既有规范UUID与父级；旧scope无写',async()=>{
  const fixture=await versionsDatabase(),{db}=fixture;
  try{
    for(const table of ['map_scope_repositories','map_manifest_versions'])await db.query(`CREATE TABLE ${table}(LIKE public.${table} INCLUDING ALL)`);
    const manifest=buildPilotManifest('phones',{revision:'a'.repeat(40),decision:randomUUID()});
    for(const node of manifest.value_streams)await db.query('INSERT INTO value_streams(id,name) VALUES($1,$2)',[node.brain_binding.entity_id,node.name]);
    for(const node of manifest.capabilities)await db.query('INSERT INTO capabilities(id,name,parent_journey_id) VALUES($1,$2,$3)',[node.brain_binding.entity_id,node.name,manifest.value_streams[0].brain_binding.entity_id]);
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
