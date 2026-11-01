/** 离线CI草稿：只写本人scratch schema，真实固定Git/三个生产注册器/完整登记断言。 */
import {createHash} from 'node:crypto';
import {DB_DEFAULTS} from '../../packages/brain/src/db-config.js';
import {readNativeConsumerRuntime} from '../../packages/brain/src/lib/native-consumer-runtime.js';
import {assertInfraConsumerRuntime,registerInfraConsumerSources,readInfraConsumerRegistry} from '../../packages/brain/src/lib/infra-consumer-source.js';
import {registerCompanyKrWorkflow} from '../../packages/brain/src/lib/company-kr-registration.js';
import {registerExistingOpsSources,readExistingOpsRegistry} from '../../packages/brain/src/lib/existing-ops-registration.js';
import {exportImplementationSnapshot} from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
import {digestMapManifest,validateMapManifest} from '../../packages/brain/src/lib/map-manifest-schema.js';
import {runProjection} from '../../packages/brain/src/map/projector.js';
import {stepSha256 as hash} from '../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import {projectImplementationSnapshot,verifySnapshotSource} from './implementation-snapshot.mjs';
import {createCiAdmissionScratch} from './ci-admission-scratch.mjs';
import {fixedLocalGit,readFixedLocalGitBlob} from './fixed-local-git.mjs';
import {runRegisteredAssertions} from './implementation-gate.mjs';
import {loadCiAdmissionSeed,CI_ADMISSION_SCOPES as SCOPES} from './ci-admission-seed.mjs';
import {createCiAdmissionDraft} from './ci-admission-envelope.mjs';
const REPO='perfectuser21/cecelia',SHA=/^[a-f0-9]{40}$/;
const TABLES=['areas','value_streams','capabilities','workflows','activities','steps','workflow_activity_refs','skill_registry','map_scope_repositories','activity_cells'];
const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
function sourceReader(root,revision){
 const entries=fixedLocalGit(root,['ls-tree','-rz','--full-tree',revision],{encoding:'utf8'}).split('\0').filter(Boolean).map(line=>{
  const [meta,path]=line.split('\t'),[mode,type,sha]=meta.split(' ');return {path,mode,type,sha};
 });
 const byPath=new Map(entries.map(e=>[e.path,e])),cache=new Map();
 const read=path=>{
  if(!cache.has(path)){
   const entry=byPath.get(path);need(entry?.type==='blob'&&['100644','100755'].includes(entry.mode),'CI_ADMISSION_SOURCE_BLOB');
   const bytes=readFixedLocalGitBlob(root,{revision,path});
   need(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')===entry.sha,'CI_ADMISSION_SOURCE_BLOB');cache.set(path,bytes.toString('utf8'));
  }return cache.get(path);
 };return {paths:entries.filter(e=>e.type==='blob').map(e=>e.path),read};
}
async function seedDatabase(db,seed,revision){
 const identity=(await db.query('SELECT current_database() AS database,current_schema() AS schema')).rows[0];
 need(identity?.database==='cecelia_scratch'&&/^ci_admission_[a-f0-9]{32}$/.test(identity.schema||''),'CI_ADMISSION_SCRATCH_REQUIRED');
 need(hash(Object.keys(seed.tables).sort())===hash([...TABLES].sort()),'CI_ADMISSION_SEED_TABLES');
 await db.query('BEGIN');
 try{
  for(const table of TABLES)for(const input of seed.tables[table]){
   const row=structuredClone(input);
   if(table==='workflow_activity_refs'&&row.source_commit)row.source_commit=revision;
   const keys=Object.keys(row);need(keys.length>0&&keys.every(k=>/^[a-z_]+$/.test(k)),'CI_ADMISSION_SEED_COLUMN');
   await db.query(`INSERT INTO ${table}(${keys.map(k=>`"${k}"`).join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,keys.map(k=>row[k]));
  }
  for(const original of seed.manifests){
   const manifest=structuredClone(original);
   for(const node of [...manifest.value_streams,...manifest.capabilities]){
    need(node.brain_binding?.source_repo===REPO,'CI_ADMISSION_MANIFEST_SOURCE');node.brain_binding.source_revision=revision;
   }
   need(validateMapManifest(manifest).valid,'CI_ADMISSION_MANIFEST_INVALID');
   const digest=digestMapManifest(manifest),m=(await db.query(`INSERT INTO map_manifest_versions(scope_key,version,source_decision_id,manifest,digest,status,activated_at)
    VALUES($1,1,$2,$3,$4,'active',NOW()) RETURNING id`,[manifest.scope_key,manifest.source_decision_id,manifest,digest])).rows[0];
   const registration=seed.tables.map_scope_repositories.find(r=>r.scope_key===manifest.scope_key);need(registration,'CI_ADMISSION_SCOPE_REGISTRATION');
   // 真实投影器计算并写回；不把fixture行伪装成执行过的projection。
   await runProjection({client:db,manifestId:m.id,manifestDigest:digest,scopeKey:manifest.scope_key,manifest,factRevisions:{[registration.repo]:revision}});
  }
  await db.query('COMMIT');return identity.schema;
 }catch(error){await db.query('ROLLBACK');throw error;}
}
function requiredGroups(seed){
 const groups=new Map();
 for(const a of seed.required_assertions){
  const group=groups.get(a.assertion_ref)||{source_repo:REPO,assertion_ref:a.assertion_ref,source_bindings:[],registered_ids:[]};
  const cell=seed.tables.activity_cells.find(c=>c.id===a.id);need(cell?.assertion_ref===a.assertion_ref,'CI_ADMISSION_ASSERTION_SEED_IDENTITY');
  group.source_bindings.push({scope:a.scope,cell_id:a.id,capability_id:cell.journey_id,activity_id:cell.step_id});group.registered_ids.push(a.id);groups.set(a.assertion_ref,group);
 }return [...groups.values()];
}
export async function buildCiAdmissionDraft({sourceRoot,controlRoot,sourceRevision,controlRevision},{observe=()=>{},openScratch=createCiAdmissionScratch}={}){
 need(SHA.test(sourceRevision||'')&&SHA.test(controlRevision||''),'CI_ADMISSION_BUILDER_INPUT');
 for(const [root,revision] of [[sourceRoot,sourceRevision],[controlRoot,controlRevision]]){
  need(fixedLocalGit(root,['rev-parse','HEAD'],{encoding:'utf8'}).trim()===revision&&!fixedLocalGit(root,['status','--porcelain=v1','--untracked-files=no'],{encoding:'utf8'}).trim(),'CI_ADMISSION_CHECKOUT_MISMATCH');
 }
 need(DB_DEFAULTS.database==='cecelia_scratch'&&DB_DEFAULTS.user==='ci'&&['localhost','127.0.0.1','::1','/tmp'].includes(DB_DEFAULTS.host),'CI_ADMISSION_DB_TARGET');
 const {seed}=loadCiAdmissionSeed(controlRoot,controlRevision),source=sourceReader(sourceRoot,sourceRevision);
 for(const file of readNativeConsumerRuntime().files)need(createHash('sha256').update(source.read(file.path)).digest('hex')===file.sha256,'CI_ADMISSION_NATIVE_RUNTIME_MISMATCH');
 await assertInfraConsumerRuntime(async path=>source.read(path));
 const scratch=await openScratch();
 try{
  const db=scratch.db,schema=await seedDatabase(db,seed,sourceRevision);
  const factoryBefore=await readExistingOpsRegistry(db),infraBefore=await readInfraConsumerRegistry(db);
  const spec=JSON.parse(source.read('packages/brain/config/company-kr-workflow.json'));
  await registerCompanyKrWorkflow(db,{spec,revision:sourceRevision,readSource:async revision=>{need(revision===sourceRevision,'CI_ADMISSION_KR_REVISION');return JSON.stringify(spec);},
   readBinding:async binding=>{need(binding.repo===REPO&&binding.revision===sourceRevision&&binding.kind==='code','CI_ADMISSION_PRIVATE_OR_FOREIGN_BINDING');return source.read(binding.path);},definitionsOnly:true});
  await registerExistingOpsSources(db,{scope:'cecelia-factory',repo:REPO,revision:sourceRevision,paths:source.paths,readSource:async path=>source.read(path),mode:'scratch_candidate',expectedRegistrySha256:factoryBefore.registry_sha256,actor:'ci-admission-synthetic-builder'});
  await registerInfraConsumerSources(db,{scope:'cecelia-infra',repo:REPO,revision:sourceRevision,paths:source.paths,readSource:async path=>source.read(path),mode:'scratch_candidate',expectedRegistrySha256:infraBefore.registry_sha256,actor:'ci-admission-synthetic-builder'});
  need(hash(await readExistingOpsRegistry(db))===hash(factoryBefore)&&hash(await readInfraConsumerRegistry(db))===hash(infraBefore),'CI_ADMISSION_REGISTRY_CHANGED');
  for(const scope of SCOPES){const s=await exportImplementationSnapshot(db,{scope,repo:REPO,revision:sourceRevision});need(s.status==='verified'&&!s.gaps.length,'CI_ADMISSION_BUILD_UNKNOWN');await verifySnapshotSource(s,sourceRoot,{db});await projectImplementationSnapshot(db,s,sourceRoot);}
  const snapshots=await Promise.all(SCOPES.map(scope=>exportImplementationSnapshot(db,{scope,repo:REPO,revision:sourceRevision})));
  const required=requiredGroups(seed),executed=await runRegisteredAssertions({repoRoot:sourceRoot,source:{repo:REPO,head_revision:sourceRevision},required_assertions:required});
  const executions=executed.map(e=>({...e,registered_ids:required.find(a=>a.assertion_ref===e.assertion_ref).registered_ids}));
  const readback={schema,cells:(await db.query('SELECT count(*)::int n FROM activity_cells')).rows[0].n,
   factory_current_pointers:(await db.query('SELECT count(*)::int n FROM workflows WHERE id=ANY($1::uuid[]) AND current_definition_version_id IS NOT NULL',[factoryBefore.workflows.map(w=>w.id)])).rows[0].n,
   infra_current_pointers:(await db.query('SELECT count(*)::int n FROM workflows WHERE id=ANY($1::uuid[]) AND current_definition_version_id IS NOT NULL',[infraBefore.workflows.map(w=>w.id)])).rows[0].n,
   projections:(await db.query('SELECT count(*)::int n FROM map_projection_runs')).rows[0].n,graphs:(await db.query('SELECT count(*)::int n FROM graph_snapshot_versions')).rows[0].n,registry_preserved:hash(await readExistingOpsRegistry(db))===hash(factoryBefore)&&hash(await readInfraConsumerRegistry(db))===hash(infraBefore)};
  need(readback.cells===seed.tables.activity_cells.length&&readback.factory_current_pointers===0&&readback.infra_current_pointers===0&&readback.registry_preserved,'CI_ADMISSION_READBACK_MISMATCH');observe(readback);
  return await createCiAdmissionDraft({controlRoot,controlRevision,sourceRevision,sourceTree:fixedLocalGit(sourceRoot,['rev-parse',`${sourceRevision}^{tree}`],{encoding:'utf8'}).trim(),snapshots,executions});
 }finally{await scratch.close();}
}
