import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { submitMapManifest, activateMapManifest } from '../../lib/map-manifest-store.js';
import { submitManifestDraft, activateManifest } from '../../map/manifest-store.js';
import * as bindings from '../../lib/map-brain-bindings.js';
import { projectMapManifest } from '../../lib/map-projection-store.js';
import { runProjection } from '../../map/projector.js';

if (!(DB_DEFAULTS.database === 'cecelia_scratch' || process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test')) throw Error('仅允许scratch/CI测试库');
const schema = `mapbinding_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client(DB_DEFAULTS);
let db;
const vs = randomUUID(), cap = randomUUID(), otherVs = randomUUID(), otherCap = randomUUID(), decision = randomUUID();
const revision = 'a'.repeat(40);
function manifest(scope, binding = true) {
  const bind = (entity_type, entity_id) => ({ entity_type, entity_id, source_repo: 'owner/repo', source_revision: revision });
  return { scope_key: scope, schema_version: 1, source_decision_id: decision,
    value_streams: [{ key: 'flow', name: '价值流', perceiver: '人', order: 1, ...(binding && { brain_binding: bind('value_stream', vs) }) }],
    capabilities: [{ key: 'F1', name: '能力', value_stream_key: 'flow', order: 1, ...(binding && { brain_binding: bind('capability', cap) }) }],
    boundaries: [], crosscut_pool: [], shared_prerequisites: { applicable: false, items: [], reason: '无' } };
}
const projector = ({ client, manifestVersion }) => runProjection({ client, manifestId: manifestVersion.id, manifestDigest: manifestVersion.digest, scopeKey: manifestVersion.scope_key, manifest: manifestVersion.manifest, factRevisions: {} });
const stores = {
  lib: { submit: async m => (await submitMapManifest(db, m)).manifest_version, activate: (id, scope, project = projector) => activateMapManifest(db, id, { projector: project }) },
  route: { submit: m => submitManifestDraft({ scopeKey: m.scope_key, manifest: m, sourceDecisionId: decision }, { db }), activate: (id, scope, project = projector) => activateManifest({ manifestId: id, scopeKey: scope }, { db, projector: project }) },
};
async function register(scope, alias = false) {
  await db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES($1,$2,'test-v1',$3)", [scope, scope, JSON.stringify({ source_repo: 'owner/repo' })]);
  await db.query("INSERT INTO fact_snapshot_headers(kind,repo,source_revision,scanner_version,scanned_at,row_count) VALUES('graph',$1,$2,'test',NOW(),0)",[scope,revision]);
}
async function state(scope) {
  const manifests = await db.query('SELECT id,status FROM map_manifest_versions WHERE scope_key=$1 ORDER BY version', [scope]);
  const runs = await db.query('SELECT id,status,projection_digest FROM map_projection_runs WHERE scope_key=$1 ORDER BY created_at', [scope]);
  return { manifests: manifests.rows, runs: runs.rows };
}
beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const table of ['journeys', 'workflows', 'areas', 'decisions', 'map_scope_repositories', 'fact_snapshot_headers', 'map_manifest_versions', 'map_projection_runs', 'map_projection_nodes', 'map_projection_edges']) {
    await admin.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  db = new pg.Pool({ ...DB_DEFAULTS, max: 5, options: `-c search_path=${schema}` });
  await db.query("INSERT INTO journeys(id,name,parent_journey_id) VALUES($1,'流',NULL),($2,'能力',$1),($3,'另一流',NULL),($4,'另一能力',$3)", [vs,cap,otherVs,otherCap]);
  await db.query("INSERT INTO decisions(id,category,topic,decision,status) VALUES($1,'feature','map','绑定测试','active')", [decision]);
});
afterAll(async () => {
  await db?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});
describe.each(Object.keys(stores))('%s 绑定事务', name => {
  const store = stores[name];
  it('拒绝不存在UUID、错类型、错父级和越界repo；旧active与projection不变', async () => {
    const scope = `${name}-invalid`; await register(scope);
    const old = await store.submit(manifest(scope, false)); await store.activate(old.id,scope);
    for (const mutate of [m => { m.capabilities[0].brain_binding.entity_id = randomUUID(); }, m => { m.capabilities[0].brain_binding.entity_id = vs; }, m => { m.capabilities[0].brain_binding.entity_id = otherCap; }, m => { m.capabilities[0].brain_binding.source_repo = 'other/repo'; }]) {
      const before = await state(scope), m = manifest(scope); mutate(m);
      await expect(store.submit(m)).rejects.toMatchObject({ code: expect.stringMatching(/^MAP_BRAIN_BINDING_/) });
      expect(await state(scope)).toEqual(before);
    }
  });
  it('激活时重验父级，失败保持原active和投影', async () => {
    const scope = `${name}-drift`; await register(scope);
    const old = await store.submit(manifest(scope,false)); await store.activate(old.id,scope);
    const next = await store.submit(manifest(scope)); const before = await state(scope);
    await db.query('UPDATE journeys SET parent_journey_id=$1 WHERE id=$2',[otherVs,cap]);
    try { await expect(store.activate(next.id,scope)).rejects.toMatchObject({ code: 'MAP_BRAIN_BINDING_PARENT_MISMATCH' }); expect(await state(scope)).toEqual(before); }
    finally { await db.query('UPDATE journeys SET parent_journey_id=$1 WHERE id=$2',[vs,cap]); }
  });
  it('同scope幂等激活仍重验业务事实', async () => {
    const scope = `${name}-active-drift`; await register(scope);
    const draft = await store.submit(manifest(scope)); await store.activate(draft.id,scope);
    await db.query('UPDATE journeys SET parent_journey_id=$1 WHERE id=$2',[otherVs,cap]);
    try { await expect(store.activate(draft.id,scope)).rejects.toMatchObject({ code: 'MAP_BRAIN_BINDING_PARENT_MISMATCH' }); }
    finally { await db.query('UPDATE journeys SET parent_journey_id=$1 WHERE id=$2',[vs,cap]); }
  });
});
it('相同key跨scope独立，相同业务UUID跨scope保留；显式repo别名可核来源', async () => {
  for (const [scope, entity, parent, alias] of [['same-a',cap,vs,false],['same-b',otherCap,otherVs,false],['same-c',cap,vs,true]]) {
    await register(scope,alias); const m = manifest(scope); m.capabilities[0].brain_binding.entity_id=entity; m.value_streams[0].brain_binding.entity_id=parent;
    const draft = await stores.route.submit(m); await stores.route.activate(draft.id,scope);
    const { rows } = await db.query("SELECT n.attributes FROM map_projection_nodes n JOIN map_projection_runs r ON r.id=n.run_id WHERE r.scope_key=$1 AND r.status='active' AND n.node_key='F1'",[scope]);
    expect(rows[0].attributes).toMatchObject({ canonical_entity_id: entity, registration_status:'verified', hierarchy_status:'verified', source_status:'verified', mapping_status:'verified' });
  }
});
it('来源revision无证据时只能unknown，重新激活刷新证据与digest', async () => {
  const scope='source-unknown'; await register(scope); const m=manifest(scope);
  m.capabilities[0].brain_binding.source_revision='b'.repeat(40);
  const draft=await stores.route.submit(m); await stores.route.activate(draft.id,scope);
  const read=async()=> (await db.query("SELECT n.attributes,r.projection_digest FROM map_projection_nodes n JOIN map_projection_runs r ON r.id=n.run_id WHERE r.scope_key=$1 AND r.status='active' AND n.node_key='F1'",[scope])).rows[0];
  const before=await read(); expect(before.attributes).toMatchObject({ source_status:'unknown',mapping_status:'unknown',registration_status:'verified' });
  await db.query("UPDATE fact_snapshot_headers SET source_revision=$1 WHERE repo='source-unknown'",['b'.repeat(40)]);
  try { await stores.route.activate(draft.id,scope); const after=await read(); expect(after.attributes.source_status).toBe('verified'); expect(after.projection_digest).not.toBe(before.projection_digest); }
  finally { await db.query("UPDATE fact_snapshot_headers SET source_revision=$1 WHERE repo='source-unknown'",[revision]); }
});
it('激活持锁阻止并发改父，双入口并发激活串行化', async () => {
  const scope='concurrent'; await register(scope);
  const first=await stores.route.submit(manifest(scope)); const m=manifest(scope); m.capabilities[0].name='版本二'; const second=await stores.lib.submit(m);
  let entered; const ready=new Promise(resolve=>{entered=resolve;}); let resume; const gate=new Promise(resolve=>{resume=resolve;});
  const activation=stores.route.activate(first.id,scope,async args=>{entered(); await gate; return projector(args);});
  await ready;
  const writer=await db.connect(); await writer.query('BEGIN'); await writer.query("SET LOCAL lock_timeout='100ms'");
  try { await expect(writer.query('UPDATE journeys SET parent_journey_id=$1 WHERE id=$2',[otherVs,cap])).rejects.toMatchObject({ code:'55P03' }); }
  finally { await writer.query('ROLLBACK'); writer.release(); resume(); }
  await activation;
  await Promise.all([stores.route.activate(first.id,scope),stores.lib.activate(second.id,scope)]);
  const result=await state(scope); expect(result.manifests.filter(x=>x.status==='active')).toHaveLength(1); expect(result.runs.filter(x=>x.status==='active')).toHaveLength(1);
});

it('只读核验复查父级漂移与来源，严格入口拒绝歧义repo', async () => {
  expect(typeof bindings.readMapBrainBindings).toBe('function');
  const scope='read-drift'; await register(scope); const m=manifest(scope);
  expect((await bindings.readMapBrainBindings(db,m)).F1.mapping_status).toBe('verified');
  await db.query('UPDATE journeys SET parent_journey_id=$1 WHERE id=$2',[otherVs,cap]);
  try { expect((await bindings.readMapBrainBindings(db,m)).F1).toMatchObject({ hierarchy_status:'unknown',mapping_status:'unknown',validation_errors:['MAP_BRAIN_BINDING_PARENT_MISMATCH'] }); }
  finally { await db.query('UPDATE journeys SET parent_journey_id=$1 WHERE id=$2',[vs,cap]); }
  await db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES($1,'ambiguous-alias','test-v1',$2)",[scope,JSON.stringify({source_repo:'owner/repo'})]);
  await expect(stores.route.submit(m)).rejects.toMatchObject({code:'MAP_BRAIN_BINDING_AMBIGUOUS_REPO'});
});
it('lib真实projector持久化规范绑定，重新激活能降低已过期source证据', async () => {
  const scope='lib-projection'; await register(scope); const m=manifest(scope); const draft=await stores.lib.submit(m);
  const project=args=>projectMapManifest({...args,loadAnchorProjection:async()=>({nodes:[],edges:[],fact_revisions:{}})});
  await stores.lib.activate(draft.id,scope,project);
  const read=async()=> (await db.query("SELECT n.attributes FROM map_projection_nodes n JOIN map_projection_runs r ON r.id=n.run_id WHERE r.scope_key=$1 AND r.status='active' AND n.node_key='F1'",[scope])).rows[0].attributes;
  expect(await read()).toMatchObject({canonical_entity_id:cap,mapping_status:'verified',source_evidence:{scanned_at:expect.any(String)}});
  await db.query("UPDATE fact_snapshot_headers SET source_revision=$1 WHERE repo=$2",['c'.repeat(40),scope]);
  await stores.lib.activate(draft.id,scope,project);
  expect(await read()).toMatchObject({canonical_entity_id:cap,mapping_status:'unknown',source_status:'unknown'});
});
