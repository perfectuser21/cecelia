import { randomUUID } from 'node:crypto';
import {privateFixtureDatabase} from '../fixtures/private-fixture-db.js';
import {minimumDefinitionSchema} from '../fixtures/minimum-definition-schema.js';
import {minimumMapSchema} from '../fixtures/minimum-map-schema.js';
import express from 'express';
import request from 'supertest';
import { createMapRouter } from '../../routes/map.js';
import { createMapManifestRouter } from '../../routes/map-manifests.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { submitMapManifest, activateMapManifest } from '../../lib/map-manifest-store.js';
import { submitManifestDraft, activateManifest } from '../../map/manifest-store.js';
import * as bindings from '../../lib/map-brain-bindings.js';
import { projectMapManifest } from '../../lib/map-projection-store.js';
import { runProjection } from '../../map/projector.js';

let fixture,db;
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
  fixture=await privateFixtureDatabase('mapbinding',async client=>{await minimumDefinitionSchema(client,{runs:false});await minimumMapSchema(client);});
  db=fixture.createPool(5);
  await db.query("INSERT INTO journeys(id,name,parent_journey_id) VALUES($1,'流',NULL),($2,'能力',$1),($3,'另一流',NULL),($4,'另一能力',$3)", [vs,cap,otherVs,otherCap]);
  await db.query("INSERT INTO decisions(id,category,topic,decision,status) VALUES($1,'feature','map','绑定测试','active')", [decision]);
});
afterAll(async () => {await fixture?.close();});
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

function httpApp() {
  const app=express(); app.use(express.json());
  app.use('/map/manifests',createMapManifestRouter({pool:db,projector}));
  app.use('/map',createMapRouter({pool:db})); return app;
}
it('HTTP提交与激活保留绑定领域错误422及原始code', async () => {
  const scope='http-errors'; await register(scope); const app=httpApp(),m=manifest(scope);
  m.capabilities[0].brain_binding.entity_id=randomUUID();
  const submitted=await request(app).post('/map/manifests').send(m);
  expect(submitted.status,submitted.body).toBe(422); expect(submitted.body.error.code).toBe('MAP_BRAIN_BINDING_NOT_FOUND');
  const draft=await stores.lib.submit(manifest(scope));
  await db.query('UPDATE journeys SET parent_journey_id=$1 WHERE id=$2',[otherVs,cap]);
  try {
    const activated=await request(app).post(`/map/manifests/${draft.id}/activate`);
    expect(activated.status,activated.body).toBe(422); expect(activated.body.error.code).toBe('MAP_BRAIN_BINDING_PARENT_MISMATCH');
  } finally { await db.query('UPDATE journeys SET parent_journey_id=$1 WHERE id=$2',[vs,cap]); }
});
it('默认projector按显式登记repo读取revision，不能把scope充当repo', async () => {
  const scope='projection-alias'; await register(scope);
  await db.query('UPDATE map_scope_repositories SET repo=$1 WHERE scope_key=$2',[`${scope}-source`,scope]);
  await db.query('UPDATE fact_snapshot_headers SET repo=$1 WHERE repo=$2',[`${scope}-source`,scope]);
  const draft=await stores.route.submit(manifest(scope));
  await activateManifest({manifestId:draft.id,scopeKey:scope},{db});
  const run=(await db.query("SELECT fact_revisions FROM map_projection_runs WHERE scope_key=$1 AND status='active'",[scope])).rows[0];
  expect(run.fact_revisions).toEqual({[`${scope}-source`]:revision});
});
it('正式地图和节点GET复核漂移并重建权威绑定属性，不改持久投影', async () => {
  const scope='public-read'; await register(scope); const draft=await stores.route.submit(manifest(scope)); await stores.route.activate(draft.id,scope);
  const app=httpApp();
  const read=async()=>{
    const map=await request(app).get('/map').query({scope}); expect(map.status,map.body).toBe(200);
    const node=await request(app).get('/map/nodes/F1').query({scope}); expect(node.status,node.body).toBe(200);
    expect(node.body.node.attributes).toEqual(map.body.nodes.find(n=>n.key==='F1').attributes);
    return node.body.node.attributes;
  };
  const before=await read(); expect(before.mapping_status).toBe('verified');
  await db.query("UPDATE fact_snapshot_headers SET source_revision=$1 WHERE repo=$2",['b'.repeat(40),scope]);
  expect(await read()).toMatchObject({source_status:'unknown',mapping_status:'unknown',source_evidence:null});
  await db.query('UPDATE fact_snapshot_headers SET source_revision=$1 WHERE repo=$2',[revision,scope]);
  await db.query('UPDATE journeys SET parent_journey_id=$1 WHERE id=$2',[otherVs,cap]);
  try { expect(await read()).toMatchObject({hierarchy_status:'unknown',mapping_status:'unknown',validation_errors:['MAP_BRAIN_BINDING_PARENT_MISMATCH']}); }
  finally { await db.query('UPDATE journeys SET parent_journey_id=$1 WHERE id=$2',[vs,cap]); }
  const persisted=(await db.query("SELECT n.attributes FROM map_projection_nodes n JOIN map_projection_runs r ON r.id=n.run_id WHERE r.scope_key=$1 AND n.node_key='F1'",[scope])).rows[0].attributes;
  expect(persisted).toEqual(before);
  await db.query("UPDATE map_projection_nodes SET attributes=attributes || $1::jsonb WHERE run_id=(SELECT id FROM map_projection_runs WHERE scope_key=$2 AND status='active') AND node_key='F1'",[JSON.stringify({canonical_entity_id:otherCap,canonical_entity_type:'value_stream',brain_binding:{entity_id:otherCap},mapping_status:'verified',validation_errors:['obsolete']}),scope]);
  const current=await read(); expect(current).toMatchObject({canonical_entity_id:cap,canonical_entity_type:'capability',brain_binding:manifest(scope).capabilities[0].brain_binding,mapping_status:'verified'}); expect(current.validation_errors).toBeUndefined();
  await db.query("UPDATE map_projection_nodes SET node_type='crosscut' WHERE run_id=(SELECT id FROM map_projection_runs WHERE scope_key=$1 AND status='active') AND node_key='F1'",[scope]);
  const wrongType=await read(); expect(wrongType.mapping_status).toBe('unknown'); expect(wrongType.canonical_entity_id).toBeUndefined();
});
it('无绑定manifest清除投影残留规范UUID，保留旧key/id及普通属性', async () => {
  const scope='public-legacy'; await register(scope); const draft=await stores.route.submit(manifest(scope,false)); await stores.route.activate(draft.id,scope);
  const app=httpApp(),read=()=>request(app).get('/map/nodes/F1').query({scope});
  const before=await read(); expect(before.status,before.body).toBe(200);
  await db.query("UPDATE map_projection_nodes SET attributes=attributes || $1::jsonb WHERE run_id=(SELECT id FROM map_projection_runs WHERE scope_key=$2 AND status='active') AND node_key='F1'",[JSON.stringify({canonical_entity_id:cap,brain_binding:manifest(scope).capabilities[0].brain_binding,mapping_status:'verified'}),scope]);
  const after=await read(); expect(after.status,after.body).toBe(200); expect(after.body.node.id).toBe(before.body.node.id); expect(after.body.node.key).toBe('F1');
  expect(after.body.node.attributes.canonical_entity_id).toBeUndefined(); expect(after.body.node.attributes.brain_binding).toBeUndefined(); expect(after.body.node.attributes.mapping_status).toBe('unknown');
});

it('map私有完整迁移外键只归己schema，links真实revision trigger与step FK仍生效',async()=>{
 expect((await db.query("SELECT target.nspname FROM pg_constraint c JOIN pg_class source ON source.oid=c.conrelid JOIN pg_namespace origin ON origin.oid=source.relnamespace JOIN pg_class referenced ON referenced.oid=c.confrelid JOIN pg_namespace target ON target.oid=referenced.relnamespace WHERE c.contype='f' AND origin.nspname=current_schema() AND target.nspname<>current_schema()")).rows).toEqual([]);
 const activity=(await db.query("INSERT INTO journey_steps(journey_id,name,step_number) VALUES($1,'revision fixture',1) RETURNING id",[cap])).rows[0].id;
 const link=(await db.query("INSERT INTO journey_step_links(journey_id,step_id,step_order,assertion_ref) VALUES($1,$2,1,'tests/old.test.js') RETURNING id,assertion_revision",[cap,activity])).rows[0];
 expect((await db.query("UPDATE journey_step_links SET assertion_ref='tests/new.test.js' WHERE id=$1 RETURNING assertion_revision",[link.id])).rows[0].assertion_revision).toBe(String(Number(link.assertion_revision)+1));
 await expect(db.query('UPDATE journey_step_links SET step_id_ref=$1 WHERE id=$2',[randomUUID(),link.id])).rejects.toMatchObject({code:'23503'});
 expect((await db.query("SELECT version FROM schema_version WHERE version IN ('400','402','405','407','410') ORDER BY version")).rows.map(r=>r.version)).toEqual(['400','402','405','407','410']);
});
