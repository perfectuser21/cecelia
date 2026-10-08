import { afterEach, beforeEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { versionsDatabase } from '../../../__tests__/fixtures/definition-versions-db.js';
import { EXISTING_OPS_IDENTITIES } from '../../existing-ops-source.js';
import * as registration from '../../existing-ops-registration.js';
import { minimumMapSchema } from '../../../__tests__/fixtures/minimum-map-schema.js';
import { exportImplementationSnapshot } from '../../implementation-ci-snapshot.js';
import { importImplementationSnapshot } from '../../../../../../scripts/ci/implementation-snapshot.mjs';
import { randomUUID } from 'node:crypto';
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const revision = '8916df494e3f6d02c3c9e9f8979e86e4d86fbd80';
const paths = execFileSync('git', ['ls-tree', '-rz', '--name-only', revision], { cwd: root, encoding: 'utf8' }).replace(/\0$/, '').split('\0');
const cache = new Map();
const readSource = async path => {
  if (!cache.has(path)) cache.set(path, execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 16000000 }));
  return cache.get(path);
};
let fixture;
beforeEach(async () => {
  fixture = await versionsDatabase(); await fixture.migrate(); await minimumMapSchema(fixture.db);
  await fixture.db.query("INSERT INTO value_streams(id,name) VALUES('aaaaaaaa-f0f0-4000-8000-000000000001','Factory')");
  for (const identity of EXISTING_OPS_IDENTITIES) {
    await fixture.db.query("INSERT INTO capabilities(id,name,parent_journey_id) VALUES($1,$2,'aaaaaaaa-f0f0-4000-8000-000000000001')", [identity.capability_id, identity.workflow_key]);
    await fixture.db.query("INSERT INTO workflows(id,capability_id,key,name,channel,status) VALUES($1,$2,$3,$3,'ops','paused')", [identity.workflow_id, identity.capability_id, identity.workflow_key]);
    for (const [i, reference] of [identity.reference_id, ...identity.unverified_reference_ids].entries()) {
      const activity = i === 0 ? identity.activity_id : reference;
      await fixture.db.query("INSERT INTO activities(id,name,status,workflow_id) VALUES($1,$2,'planned',$3)", [activity, `旧活动${i}`, identity.workflow_id]);
      await fixture.db.query("INSERT INTO workflow_activity_refs(id,workflow_id,activity_id,slot_key,sequence_no) VALUES($1,$2,$3,$4,$5)", [reference, identity.workflow_id, activity, `step_${i + 1}`, i + 1]);
    }
  }
});
async function factoryMap() {
  const decision=randomUUID(), manifestId=randomUUID(), binding=(entity_type,entity_id)=>({entity_type,entity_id,source_repo:'perfectuser21/cecelia',source_revision:revision});
  const manifest={scope_key:'cecelia-factory',schema_version:1,source_decision_id:decision,value_streams:[{key:'factory',brain_binding:binding('value_stream','aaaaaaaa-f0f0-4000-8000-000000000001')}],capabilities:EXISTING_OPS_IDENTITIES.map((i,n)=>({key:`F${n+2}`,value_stream_key:'factory',brain_binding:binding('capability',i.capability_id)}))};
  await fixture.db.query("INSERT INTO decisions(id,category,topic,decision,status) VALUES($1,'feature','test','真实工厂来源隔离测试','active')",[decision]);
  await fixture.db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('cecelia-factory','cecelia-factory-source','legacy-ledger-v1',$1)",[{source_repo:'perfectuser21/cecelia'}]);
  await fixture.db.query("INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,'cecelia-factory',1,$2,$3,$4,'active',NOW())",[manifestId,decision,manifest,'a'.repeat(64)]);
  await fixture.db.query("INSERT INTO map_projection_runs(scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at) VALUES('cecelia-factory',$1,$2,$3,'fixture',$2,'active',NOW())",[manifestId,'a'.repeat(64),{'cecelia-factory-source':revision}]);
}
afterEach(async () => { await fixture?.close(); });
const options = extra => ({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision, paths, readSource, checkMain: async () => {}, actor: 'test-real-main', ...extra });
it('真实main消费者只append不可执行历史，保留全部旧登记和六个UNKNOWN', async () => {
  expect(registration.registerExistingOpsSources).toBeTypeOf('function');
  const before = await registration.readExistingOpsRegistry(fixture.db);
  const receipt = await registration.registerExistingOpsSources(fixture.db, options({ expectedRegistrySha256: before.registry_sha256 }));
  expect(receipt.definitions.workflows).toHaveLength(2);
  expect(receipt.definitions.activities).toHaveLength(2);
  expect(receipt.definitions.workflows.every(w => w.payload.definition_scope === 'consumer_evidence' && w.payload.coverage.status === 'unknown' && w.payload.coverage.unverified_reference_ids.length === 3)).toBe(true);
  expect(await registration.readExistingOpsRegistry(fixture.db)).toEqual(before);
  expect((await fixture.db.query('SELECT count(*)::int n FROM workflow_activity_refs')).rows[0].n).toBe(8);
  expect((await registration.registerExistingOpsSources(fixture.db, options({ expectedRegistrySha256: before.registry_sha256 }))).definitions).toEqual(receipt.definitions);
  await expect(fixture.db.query('DELETE FROM workflow_definition_versions WHERE id=$1', [receipt.definitions.workflows[0].id])).rejects.toMatchObject({ code: 'P0001' });
});
it('人改slot或层级不被接力覆盖，失败事务没有历史残留', async () => {
  const before = await registration.readExistingOpsRegistry(fixture.db);
  await fixture.db.query("UPDATE workflow_activity_refs SET slot_key='human_slot' WHERE id=$1", [EXISTING_OPS_IDENTITIES[0].reference_id]);
  await expect(registration.registerExistingOpsSources(fixture.db, options({ expectedRegistrySha256: before.registry_sha256 }))).rejects.toMatchObject({ code: 'OPS_REGISTRY_CONFLICT' });
  expect((await fixture.db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n).toBe(0);
});
it('main已移动、缺源或缺CAS不能登记，绝不执行candidate源码', async () => {
  const before = await registration.readExistingOpsRegistry(fixture.db);
  for (const extra of [{ checkMain: async () => { throw Error('MAIN_MOVED'); } }, { expectedRegistrySha256: undefined }, { readSource: async path => { if (path === 'packages/brain/src/migrate.js') throw Error('missing'); return readSource(path); } }]) {
    await expect(registration.registerExistingOpsSources(fixture.db, options({ expectedRegistrySha256: before.registry_sha256, ...extra }))).rejects.toThrow();
  }
  expect((await fixture.db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n).toBe(0);
});
it('工厂source导出保留全旧身份而仅含消费者历史，scratch导入不伪current', async()=>{
  const before=await registration.readExistingOpsRegistry(fixture.db);
  await registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry_sha256})); await factoryMap();
  const snapshot=await exportImplementationSnapshot(fixture.db,{scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision});
  expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');
  expect(snapshot.canonical.workflows).toHaveLength(2);
  expect(snapshot.canonical.references).toHaveLength(8);
  expect(snapshot.canonical.activities).toHaveLength(8);
  expect(snapshot.definitions.workflows).toHaveLength(2);
  expect(snapshot.execution_status).toBe('unknown');
  await importImplementationSnapshot(fixture.db,snapshot);
  expect(await registration.readExistingOpsRegistry(fixture.db)).toEqual(before);
});
