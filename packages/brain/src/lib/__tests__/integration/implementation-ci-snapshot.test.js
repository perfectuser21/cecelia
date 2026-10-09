import {randomUUID,createHash} from 'node:crypto';
import { afterEach,beforeEach,expect,it } from 'vitest';
import { implementationImpactDatabase,IMPACT_REPO } from '../../../__tests__/fixtures/implementation-impact-db.js';
const { exportImplementationSnapshot,refreshImplementationSnapshot,validateImplementationSnapshot,implementationGitHubUrl } = await import('../../implementation-ci-snapshot.js').catch(()=>({}));
beforeEach(()=>expect(exportImplementationSnapshot,'固定CI快照服务必须实现').toBeTypeOf('function'));
import { readFileSync } from 'node:fs';
import { SLIM_RULES } from '../../../db-slim-rules.js';
import {stepSha256} from '../../../../scripts/sync-steps-from-workspace.mjs';
let fixture;
it('新契约固定导出保留退役owner取源元数据，不将旧流程加入执行定义闭包',async()=>{
  fixture=await implementationImpactDatabase();const {db,contracts}=fixture;
  const old=(await db.query('SELECT * FROM workflows WHERE id=$1',[fixture.ids.keyword])).rows[0];
  await db.query("UPDATE workflows SET status='retired' WHERE id=$1",[old.id]);
  const fresh=randomUUID();
  await db.query(`INSERT INTO workflows(id,capability_id,key,name,channel,status,source_repo,source_path,source_capability,source_workflow)
    VALUES($1,$2,'douyin_video_discovery','新发现','douyin','paused',$3,'product-map/contracts/douyin_video_discovery.yaml','douyin_video_discovery','video-discovery')`,[fresh,old.capability_id,IMPACT_REPO]);
  contracts.docs.douyin_video_discovery={contract_key:'douyin_video_discovery',capability:'keyword_acquisition',workflow:'video-discovery',
    activities:contracts.docs.keyword_acquisition.activities.map(a=>({ref:`keyword_acquisition.${a.key}`}))};
  await fixture.sync('b'.repeat(40));await fixture.graph('b'.repeat(40));await fixture.map('b'.repeat(40));
  const before=(await db.query('SELECT id,status,current_definition_version_id FROM workflows ORDER BY id')).rows;
  const snapshot=await exportImplementationSnapshot(db,{...query,revision:'b'.repeat(40)});
  expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');
  expect(snapshot.canonical.workflows.map(w=>w.id)).not.toContain(old.id);
  expect(snapshot.definitions.workflows.map(w=>w.workflow_id)).not.toContain(old.id);
  expect(snapshot.source_registry).toMatchObject({schema_version:1,purpose:'definition_source_only',repo:IMPACT_REPO,
    workflows:[{id:old.id,status:'retired',source_capability:'keyword_acquisition'}]});
  expect(snapshot.source_registry.workflows[0]).not.toHaveProperty('current_definition_version_id');
  expect(validateImplementationSnapshot(snapshot)).toBe(snapshot);
  const forged=structuredClone(snapshot);forged.source_registry.workflows[0].status='active';
  const {snapshot_sha256:_sha,...body}=forged;forged.snapshot_sha256=stepSha256(body);
  expect(()=>validateImplementationSnapshot(forged)).toThrow();
  expect((await db.query('SELECT id,status,current_definition_version_id FROM workflows ORDER BY id')).rows).toEqual(before);
});
afterEach(async()=>{await fixture?.close();fixture=null;});
const query={scope:'phones',repo:IMPACT_REPO,revision:'a'.repeat(40)};
it('导出精确版本与规范身份，不把后来current版本冒作base，断言明确current_registration',async()=>{
  fixture=await implementationImpactDatabase();const {db}=fixture;
  const ids=(await db.query('SELECT id FROM workflow_definition_versions ORDER BY id')).rows.map(r=>r.id);
  await fixture.advance({remove:true});
  const before=(await db.query('SELECT id,current_definition_version_id FROM workflows ORDER BY id')).rows;
  const snapshot=await exportImplementationSnapshot(db,query);
  expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');
  expect(snapshot.definitions.workflows.map(w=>w.id).sort()).toEqual(ids);
  expect(snapshot.canonical.references.some(r=>!r.active)).toBe(true);
  expect(snapshot.assertion_source).toBe('current_registration');
  expect(snapshot.assertions).toHaveLength(2);
  expect(validateImplementationSnapshot(snapshot)).toBe(snapshot);
  expect((await db.query('SELECT id,current_definition_version_id FROM workflows ORDER BY id')).rows).toEqual(before);
  const forged=structuredClone(snapshot);forged.definitions.workflows[0].payload.key='forged';
  expect(()=>validateImplementationSnapshot(forged)).toThrow();
});
it('真实缺scope、规范绑定、固定版本分别给准确缺口，不猜repo或latest',async()=>{
  fixture=await implementationImpactDatabase();const {db}=fixture;
  const missing=await exportImplementationSnapshot(db,{...query,scope:'zenithjoy'});
  expect(missing.status).toBe('unknown');expect(missing.gaps).toContainEqual(expect.objectContaining({code:'scope_repository_missing'}));
  const previous=(await db.query("SELECT * FROM map_manifest_versions WHERE scope_key='phones' AND status='active'")).rows[0];
  const manifest=structuredClone(previous.manifest),id=randomUUID(),decision=randomUUID();
  manifest.source_decision_id=decision;manifest.capabilities[0].brain_binding=null;
  const digest=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  await db.query("INSERT INTO decisions(id,category,topic,decision,status) VALUES($1,'feature','map','缺绑定测试','active')",[decision]);
  await db.query("UPDATE map_manifest_versions SET status='superseded' WHERE scope_key='phones'");
  await db.query("INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,'phones',$2,$3,$4,$5,'active',NOW())",[id,previous.version+1,decision,manifest,digest]);
  await db.query("UPDATE map_projection_runs SET status='superseded',fact_revisions=$1 WHERE scope_key='phones'",[{'phone-source':'b'.repeat(40)}]);
  await db.query("INSERT INTO map_projection_runs(id,scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at) VALUES($1,'phones',$2,$3,$4,'binding-v2',$3,'active',NOW())",[randomUUID(),id,digest,{'phone-source':query.revision}]);
  const unbound=await exportImplementationSnapshot(db,query);
  expect(unbound.gaps).toContainEqual(expect.objectContaining({code:'capability_mapping_missing',node_key:'F0'}));
  const revision=await exportImplementationSnapshot(db,{...query,revision:'c'.repeat(40)});
  expect(revision.gaps).toContainEqual(expect.objectContaining({code:'definition_snapshot_missing'}));
});
it('同SHA历史歧义不任意选一个；current明确指向该SHA时只导出该版本闭包',async()=>{
  fixture=await implementationImpactDatabase();const {db}=fixture;
  const row=(await db.query('SELECT * FROM workflow_definition_versions ORDER BY id LIMIT 1')).rows[0];
  await db.query(`INSERT INTO workflow_definition_versions(workflow_id,source_repo,source_path,source_commit,contract_sha256,payload_sha256,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[row.workflow_id,row.source_repo,row.source_path,row.source_commit,row.contract_sha256,'e'.repeat(64),row.payload]);
  expect((await exportImplementationSnapshot(db,query)).definitions.workflows.find(w=>w.workflow_id===row.workflow_id).id).toBe(row.id);
  await fixture.advance();
  expect((await exportImplementationSnapshot(db,query)).gaps).toContainEqual(expect.objectContaining({code:'definition_snapshot_ambiguous',workflow_id:row.workflow_id}));
});
it('main刷新独立核HEAD，PR/旧SHA不能推进中央current',async()=>{
  fixture=await implementationImpactDatabase();const {db}=fixture;
  const before=(await db.query('SELECT id,current_definition_version_id FROM workflows ORDER BY id')).rows;
  await expect(refreshImplementationSnapshot(db,{...query,revision:'b'.repeat(40)},{fetchFn:fixture.contracts.fetchFn,resolveToken:async()=>'',allowRepos:[IMPACT_REPO]})).rejects.toMatchObject({code:'IMPLEMENTATION_CI_MAIN_MOVED'});
  expect((await db.query('SELECT id,current_definition_version_id FROM workflows ORDER BY id')).rows).toEqual(before);
});
it('release报告引用的base图不会被slim清走，未引用旧图仍可清理',async()=>{
  fixture=await implementationImpactDatabase();const {db}=fixture;await fixture.advance();
  await db.query(readFileSync(new URL('../../../../migrations/515_release_definition_evidence.sql',import.meta.url),'utf8'));
  await db.query(`INSERT INTO release_versions(release_key,environment,target,manifest_sha256,request_sha256,payload,actor)
    VALUES('retention','test','test',$1,$1,$2,'test')`,['d'.repeat(64),{ci_evidence:[{report:{base:{graph_snapshot:{repo:'phone-source',source_revision:query.revision}}}}]}]);
  const rule=SLIM_RULES.find(r=>r.table==='graph_snapshot_versions');
  const deleted=(await db.query(`DELETE FROM graph_snapshot_versions WHERE ${rule.deleteWhere} RETURNING source_revision`)).rows;
  expect(deleted).toEqual([]);
  await db.query(`INSERT INTO graph_snapshot_versions(repo,source_revision,scanner_version,row_count) VALUES('unclaimed',$1,'test',0)`,['c'.repeat(40)]);
  expect((await db.query(`DELETE FROM graph_snapshot_versions WHERE ${rule.deleteWhere} RETURNING repo`)).rows).toEqual([{repo:'unclaimed'}]);
});

it('受信main刷新先登记Steps再冻结定义，固定源码读取与摘要不能漂移',async()=>{
  fixture=await implementationImpactDatabase();const {db}=fixture;
  const snapshot=await refreshImplementationSnapshot(db,query,{fetchFn:fixture.contracts.fetchFn,resolveToken:async()=>'',readBinding:async()=> 'export const controller=true;\n'});
  expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');
  expect(snapshot.definitions.activities.every(a=>a.payload.steps.every(s=>typeof s.step_id==='string'))).toBe(true);
});

it('刷新先核scope唯一登记，未登记和歧义均不读远端也不推进任何定义',async()=>{
  fixture=await implementationImpactDatabase();const {db}=fixture;let reads=0;
  const options={resolveToken:async()=>'',fetchFn:async()=>{reads++;throw Error('不应读取远端');}};
  const before=(await db.query('SELECT id,current_definition_version_id FROM workflows ORDER BY id')).rows;
  await expect(refreshImplementationSnapshot(db,{...query,scope:'unregistered'},options)).rejects.toMatchObject({code:'IMPLEMENTATION_CI_SCOPE_REPOSITORY_MISSING'});
  await db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('phones','second-source','legacy-ledger-v1',$1)",[{source_repo:IMPACT_REPO}]);
  await expect(refreshImplementationSnapshot(db,query,options)).rejects.toMatchObject({code:'IMPLEMENTATION_CI_SCOPE_REPOSITORY_AMBIGUOUS'});
  expect(reads).toBe(0);
  expect((await db.query('SELECT id,current_definition_version_id FROM workflows ORDER BY id')).rows).toEqual(before);
});

it('GitHub目标只选固定adapter地址，path编码且不接受路径穿越，刷新禁止跟随redirect',async()=>{
 expect(implementationGitHubUrl).toBeTypeOf('function');
 expect(implementationGitHubUrl('perfectuser21/cecelia',{path:'src/a?token=#b.js',revision:'a'.repeat(40)})).toBe(`https://api.github.com/repos/perfectuser21/cecelia/contents/src/a%3Ftoken%3D%23b.js?ref=${'a'.repeat(40)}`);
 for(const repo of ['evil.example/repo','perfectuser21/cecelia@evil.example'])expect(()=>implementationGitHubUrl(repo)).toThrow();
 for(const path of ['../private','/outside','src/../private'])expect(()=>implementationGitHubUrl('perfectuser21/cecelia',{path,revision:'a'.repeat(40)})).toThrow();
 fixture=await implementationImpactDatabase();let count=0;
 await refreshImplementationSnapshot(fixture.db,query,{resolveToken:async()=>'',readBinding:async()=> 'export const controller=true;\n',fetchFn:async(url,options)=>{
  if(count++===0){expect(url).toBe(`https://api.github.com/repos/${IMPACT_REPO}/commits/main`);expect(options.redirect).toBe('error');}
  return fixture.contracts.fetchFn(url,options);
 }});
});
