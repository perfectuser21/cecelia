import { randomUUID,createHash } from 'node:crypto';
import { versionsDatabase,seedWorkflows } from './definition-versions-db.js';
import { contractsFixture } from './shared-activity-contracts.js';
import { syncActivityContracts } from '../../activity-contract-sync.js';

export const IMPACT_REPO='perfectuser21/zenithjoy-workspace';
/** 真PG隔离schema；SHA与断言路径可与调用方真实git仓库对齐。 */
export async function implementationImpactDatabase({
  baseRevision='a'.repeat(40),headRevision='b'.repeat(40),assertionRef='tests/controller.test.js',
  scope='phones',registryRepo='phone-source',seedIds,
  readBinding=async b=>b.kind==='skill'?'---\nname: controller\nversion: 1.0.0\n---\n# controller\n':'export const controller=true;\n',
}={}) {
  const fixture=await versionsDatabase(),db=fixture.db;
  try {
    const ids=await seedWorkflows(db,seedIds);await fixture.migrate();
    for(const table of ['map_scope_repositories','map_manifest_versions','map_projection_runs','map_projection_nodes','graph_snapshot_versions','graph_edge_snapshots','journey_step_links'])await db.query(`CREATE TABLE ${table}(LIKE public.${table} INCLUDING ALL)`);
    const contracts=contractsFixture();
    const capabilities=(await db.query('SELECT capability_id FROM workflows ORDER BY key')).rows.map(r=>r.capability_id);
    async function graph(revision,edges=[['src/controller.js','src/shared-lock.js']],key=registryRepo){
      await db.query("INSERT INTO graph_snapshot_versions(repo,source_revision,scanner_version,row_count,scanned_at) VALUES($1,$2,'graph-v1',$3,NOW())",[key,revision,edges.length]);
      for(const [src,dst] of edges)await db.query("INSERT INTO graph_edge_snapshots(repo,source_revision,src_path,dst_path,edge_type) VALUES($1,$2,$3,$4,'import')",[key,revision,src,dst]);
    }
    async function map(revision,capIds=capabilities,mapScope=scope,key=registryRepo,sourceRepo=IMPACT_REPO){
      await db.query("UPDATE map_manifest_versions SET status='superseded' WHERE scope_key=$1",[mapScope]);
      await db.query("UPDATE map_projection_runs SET status='superseded' WHERE scope_key=$1",[mapScope]);
      const id=randomUUID(),run=randomUUID();
      const version=(await db.query('SELECT COALESCE(MAX(version),0)+1 AS next FROM map_manifest_versions WHERE scope_key=$1',[mapScope])).rows[0].next;
      const binding=(type,entity_id)=>({entity_type:type,entity_id,source_repo:sourceRepo,source_revision:revision});
      const manifest={scope_key:mapScope,schema_version:1,value_streams:[{key:'flow',brain_binding:binding('value_stream',ids.valueStream)}],capabilities:capIds.map((cap,i)=>({key:`F${i}`,value_stream_key:'flow',brain_binding:binding('capability',cap)}))};
      const digest=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
      await db.query("INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,$2,$3,$4,$5,$6,'active',NOW())",[id,mapScope,version,randomUUID(),manifest,digest]);
      await db.query("INSERT INTO map_projection_runs(id,scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at) VALUES($1,$2,$3,$4,$5,'binding-v2',$4,'active',NOW())",[run,mapScope,id,digest,{[key]:revision}]);
      for(const node of manifest.capabilities)await db.query("INSERT INTO map_projection_nodes(run_id,node_id,node_type,node_key,name,attributes) VALUES($1,$2,'capability',$3,'能力',$4)",[run,randomUUID().replaceAll('-','').padStart(64,'0'),node.key,{brain_binding:node.brain_binding,canonical_entity_id:node.brain_binding.entity_id,mapping_status:'verified'}]);
      return {id,run,digest};
    }
    async function sync(revision,{bindings=[{kind:'code',repo:IMPACT_REPO,path:'src/controller.js'}]}={}){
      contracts.docs.keyword_acquisition.activities[0].implementation_bindings=bindings.map(b=>({...b,revision}));contracts.refresh();
      const fetchFn=async(...args)=>String(args[0]).includes('/commits/main')?{ok:true,text:async()=>revision}:contracts.fetchFn(...args);
      await syncActivityContracts(db,{...contracts,fetchFn,readBinding});
    }
    async function advance({remove=false,capIds=capabilities,edges,bindings}={}){
      if(remove)contracts.docs.benchmark_link_acquisition.activities=contracts.docs.benchmark_link_acquisition.activities.filter(a=>a.ref!=='keyword_acquisition.preflight');
      await sync(headRevision,{bindings});await graph(headRevision,edges);await map(headRevision,capIds);
    }
    await sync(baseRevision);
    const activity=(await db.query("SELECT id FROM journey_steps WHERE activity_key='preflight'")).rows[0].id;
    for(const cap of capabilities)await db.query('INSERT INTO journey_step_links(journey_id,step_id,step_order,assertion_ref) VALUES($1,$2,1,$3)',[cap,activity,assertionRef]);
    await db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES($1,$2,'legacy-ledger-v1',$3)",[scope,registryRepo,{source_repo:IMPACT_REPO}]);
    await graph(baseRevision);await map(baseRevision);
    return {...fixture,ids,contracts,capabilities,graph,map,sync,advance};
  } catch(error){await fixture.close();throw error;}
}
