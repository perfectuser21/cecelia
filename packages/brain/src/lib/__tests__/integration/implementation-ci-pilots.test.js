import { expect,it } from 'vitest';
import { versionsDatabase } from '../../../__tests__/fixtures/definition-versions-db.js';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync,writeFileSync,mkdirSync,realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile,execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import { createImplementationCiRouter } from '../../../routes/implementation-ci.js';
import { createMapManifestRouter } from '../../../routes/map-manifests.js';
import { createMapRouter } from '../../../routes/map.js';
import { submitMapManifest,activateMapManifest } from '../../map-manifest-store.js';
import { buildPilotManifest } from '../../../../../../scripts/map/register-capability-pilots.mjs';
import { scanRepo } from '../../../../../../scripts/scan/scan-graph.mjs';
const {pilotGraphTargets}=await import('../../../../../../scripts/scan/pilot-graph-targets.mjs').catch(()=>({}));
import { contractsFixture } from '../../../__tests__/fixtures/shared-activity-contracts.js';
import { syncActivityContracts } from '../../../activity-contract-sync.js';
import { exportImplementationSnapshot } from '../../implementation-ci-snapshot.js';
import { readImplementationImpact } from '../../implementation-impact.js';
import { createImplementationScratch,importImplementationSnapshot,projectImplementationSnapshot } from '../../../../../../scripts/ci/implementation-snapshot.mjs';
import { runProjection } from '../../../map/projector.js';
it('旧登记/完整地图不变：正式CLI独立alias无事实为unknown，真实Git扫描后固定投影',async()=>{
  const fixture=await versionsDatabase(),dir=realpathSync(mkdtempSync(join(tmpdir(),'pilot-registration-')));let server;
  try{
    const {db}=fixture;
    for(const table of ['decisions','map_scope_repositories','map_manifest_versions','map_projection_runs','map_projection_nodes','map_projection_edges','fact_snapshot_headers','graph_edges','graph_snapshot_versions','graph_edge_snapshots','journey_step_links','journey_features','test_registry','api_registry','db_schema_registry','journey_assertion_receipts'])await db.query(`CREATE TABLE ${table}(LIKE public.${table} INCLUDING ALL)`);
    await db.query(`INSERT INTO journeys(id,name,parent_journey_id) VALUES('afa6abca-53c0-4815-8594-b7fb81ca547f','获客',NULL),
      ('a1000000-0000-4000-8000-000000000001','关键词','afa6abca-53c0-4815-8594-b7fb81ca547f'),('a1000000-0000-4000-8000-000000000002','对标','afa6abca-53c0-4815-8594-b7fb81ca547f')`);
    mkdirSync(join(dir,'src'));writeFileSync(join(dir,'src/controller.js'),"import './shared.js';\n");writeFileSync(join(dir,'src/shared.js'),'export const shared=true;\n');
    const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
    git('init','-b','main');git('config','user.name','fixture');git('config','user.email','fixture@example.test');git('add','.');git('-c','core.hooksPath=/dev/null','commit','-m','fixture');git('remote','add','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');
    const revision=git('rev-parse','HEAD');
    const decision=randomUUID();await db.query('INSERT INTO decisions(id) VALUES($1)',[decision]);
    await db.query("INSERT INTO fact_snapshot_headers(kind,repo,source_revision,scanner_version,row_count,scanned_at) VALUES('graph','zenithjoy-workspace',$1,'test',0,NOW())",[revision]);
    await db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('zenithjoy-workspace','zenithjoy-workspace','legacy-ledger-v1','{}')");
    const old=buildPilotManifest('phones',{revision,decision});old.scope_key='zenithjoy-workspace';
    for(const node of [...old.value_streams,...old.capabilities])delete node.brain_binding;
    const oldDraft=await submitMapManifest(db,old);
    const projector=({client,manifestVersion:m})=>runProjection({client,scopeKey:m.scope_key,manifestId:m.id,manifestDigest:m.digest,manifest:m.manifest});
    await activateMapManifest(db,oldDraft.manifest_version.id,{projector});
    const preserved=async()=>({registrations:(await db.query("SELECT * FROM map_scope_repositories WHERE scope_key='zenithjoy-workspace'")).rows,manifests:(await db.query("SELECT * FROM map_manifest_versions WHERE scope_key='zenithjoy-workspace'")).rows,runs:(await db.query("SELECT * FROM map_projection_runs WHERE scope_key='zenithjoy-workspace'")).rows});
    const before=await preserved();
    expect(await pilotGraphTargets(db,{repo:'zenithjoy-workspace',root:dir})).toEqual([]);
    const app=express();app.use(express.json());app.use('/api/brain/implementation-ci',createImplementationCiRouter({pool:db}));
    app.use('/api/brain/map',createMapRouter({pool:db}));
    app.use('/api/brain/map/manifests',createMapManifestRouter({pool:db,projector:({client,manifestVersion:m})=>runProjection({client,scopeKey:m.scope_key,manifestId:m.id,manifestDigest:m.digest,manifest:m.manifest})}));
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const script=fileURLToPath(new URL('../../../../../../scripts/map/register-capability-pilots.mjs',import.meta.url));
    let result;try{result=await promisify(execFile)(process.execPath,[script,'--pilot','phones','--revision',revision,'--decision',decision,'--output',join(dir,'manifest.json'),'--api-url',`http://127.0.0.1:${server.address().port}`,'--apply'],{env:{...process.env,CECELIA_INTERNAL_TOKEN:'fixture-internal-token'}});}catch(error){result=error;}
    expect(result.code,result.stderr).toBeUndefined();
    expect((await db.query("SELECT count(*)::int n FROM map_manifest_versions WHERE status='active'")).rows[0].n).toBe(2);
    expect((await db.query("SELECT count(*)::int n FROM map_projection_nodes WHERE attributes->>'mapping_status'='verified'")).rows[0].n).toBe(0);
    expect((await db.query("SELECT fact_revisions FROM map_projection_runs WHERE scope_key='zenithjoy' AND status='active'")).rows[0].fact_revisions).toEqual({});
    expect((await db.query("SELECT count(*)::int n FROM map_projection_nodes n JOIN map_projection_runs r ON r.id=n.run_id WHERE r.scope_key='zenithjoy' AND n.attributes->>'mapping_status'='unknown'")).rows[0].n).toBe(3);
    expect(await preserved()).toEqual(before);
    const targets=await pilotGraphTargets(db,{repo:'zenithjoy-workspace',root:dir});
    expect(targets).toEqual([{repo:'zenithjoy-pilot-source',root:dir,scope:'zenithjoy'}]);
    const scanned=await scanRepo({name:targets[0].repo,root:dir},db);expect(scanned.error).toBeUndefined();expect(scanned.sourceRevision).toBe(revision);
    const rebuilt=await fetch(`http://127.0.0.1:${server.address().port}/api/brain/map/rebuild`,{method:'POST',headers:{'Content-Type':'application/json','X-Internal-Token':'fixture-internal-token'},body:JSON.stringify({scope_key:'zenithjoy'})});
    expect(rebuilt.status,JSON.stringify(await rebuilt.json())).toBe(200);
    expect((await db.query("SELECT fact_revisions FROM map_projection_runs WHERE scope_key='zenithjoy' AND status='active'")).rows[0].fact_revisions).toEqual({'zenithjoy-pilot-source':revision});
    expect((await db.query("SELECT count(*)::int n FROM map_projection_nodes n JOIN map_projection_runs r ON r.id=n.run_id WHERE r.scope_key='zenithjoy' AND r.status='active' AND n.attributes->>'mapping_status'='verified'")).rows[0].n).toBe(3);
    expect(await preserved()).toEqual(before);
    await db.query(`INSERT INTO workflows(id,capability_id,key,name,channel) VALUES
      ('b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','douyin_keyword_leadgen','关键词','douyin'),
      ('b1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','douyin_benchmark_leadgen','对标','douyin')`);
    await fixture.migrate();const contracts=contractsFixture();
    contracts.docs.keyword_acquisition.activities[0].implementation_bindings=[{kind:'code',repo:'perfectuser21/zenithjoy-workspace',path:'src/controller.js',revision}];contracts.refresh();
    await syncActivityContracts(db,{...contracts,fetchFn:async(...args)=>String(args[0]).includes('/commits/main')?{ok:true,text:async()=>revision}:contracts.fetchFn(...args),readBinding:async b=>git('show',`${b.revision}:${b.path}`)+'\n'});
    const snapshot=await exportImplementationSnapshot(db,{scope:'zenithjoy',repo:'perfectuser21/zenithjoy-workspace',revision});
    expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');expect(snapshot.map.repositories[0].repo).toBe('zenithjoy-pilot-source');
    const impactInput={scope:'zenithjoy',repo:'perfectuser21/zenithjoy-workspace',base_revision:revision,head_revision:revision,changed_files:['src/shared.js']};
    expect((await db.query("SELECT src_path,dst_path FROM graph_edges WHERE repo='zenithjoy-pilot-source'")).rows).toEqual([{src_path:'src/controller.js',dst_path:'src/shared.js'}]);
    const impact=await readImplementationImpact(db,impactInput);
    expect(impact.affected_usages,JSON.stringify(impact.gaps)).toHaveLength(2);expect(impact.head.graph_snapshot.repo).toBe('zenithjoy-pilot-source');
    // CI在另一隔离schema保留同一alias与规范UUID；不将scratch图冒充中央事实。
    const scratch=await createImplementationScratch();try{
      await importImplementationSnapshot(scratch.db,snapshot);await projectImplementationSnapshot(scratch.db,snapshot,dir);
      const ciImpact=await readImplementationImpact(scratch.db,impactInput);
      expect(ciImpact.affected_usages).toHaveLength(2);expect(ciImpact.head.graph_snapshot.source_revision).toBe(revision);
    }finally{await scratch.close();}
    expect(await preserved()).toEqual(before);
    await db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('cecelia-kr','cecelia-kr-source','legacy-ledger-v1',$1)",[{source_repo:'perfectuser21/cecelia'}]);
    git('remote','set-url','origin','git@github.com:perfectuser21/cecelia.git');
    expect(await pilotGraphTargets(db,{repo:'cecelia',root:dir})).toEqual([{repo:'cecelia-kr-source',root:dir,scope:'cecelia-kr'}]);
    await db.query(`INSERT INTO journeys(id,name,parent_journey_id) VALUES('bbbbbbbb-f0f0-4000-8000-000000000002','管家',NULL),('dddddddd-f0f0-4000-8000-000000000004','战略','bbbbbbbb-f0f0-4000-8000-000000000002')`);
    const kr=await submitMapManifest(db,buildPilotManifest('company-kr',{revision,decision}));await activateMapManifest(db,kr.manifest_version.id,{projector});
    expect((await db.query("SELECT fact_revisions FROM map_projection_runs WHERE scope_key='cecelia-kr' AND status='active'")).rows[0].fact_revisions).toEqual({});
    expect((await scanRepo({name:'cecelia-kr-source',root:dir},db)).sourceRevision).toBe(revision);
    const krRebuild=await fetch(`http://127.0.0.1:${server.address().port}/api/brain/map/rebuild`,{method:'POST',headers:{'Content-Type':'application/json','X-Internal-Token':'fixture-internal-token'},body:JSON.stringify({scope_key:'cecelia-kr'})});
    expect(krRebuild.status,JSON.stringify(await krRebuild.json())).toBe(200);
    expect((await db.query("SELECT fact_revisions FROM map_projection_runs WHERE scope_key='cecelia-kr' AND status='active'")).rows[0].fact_revisions).toEqual({'cecelia-kr-source':revision});
    expect(await preserved()).toEqual(before);
    git('remote','set-url','origin','https://github.com/other/cecelia.git');
    await expect(pilotGraphTargets(db,{repo:'cecelia',root:dir})).rejects.toThrow('source repo');
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await fixture.close();rmSync(dir,{recursive:true,force:true});}
});
