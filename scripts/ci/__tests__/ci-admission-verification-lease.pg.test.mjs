/** 真实内部lease/文件边界回归；不把内存旧snapshot当作官方typed artifact资格。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {DB_DEFAULTS} from '../../../packages/brain/src/db-config.js';
import {stepSha256} from '../../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import {registerExistingOpsSources,readExistingOpsRegistry} from '../../../packages/brain/src/lib/existing-ops-registration.js';
import {exportImplementationSnapshot} from '../../../packages/brain/src/lib/implementation-ci-snapshot.js';
import {digestMapManifest} from '../../../packages/brain/src/lib/map-manifest-schema.js';
import {runProjection} from '../../../packages/brain/src/map/projector.js';
import {createCiAdmissionScratch} from '../ci-admission-scratch.mjs';
import {loadCiAdmissionSeed} from '../ci-admission-seed.mjs';
import {fixedLocalGit,readFixedLocalGitBlob} from '../fixed-local-git.mjs';
import {collectImplementationPrEvidenceInScratch} from '../implementation-pr-gate.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
async function realFactorySnapshot(db,repoRoot,revision,seed){
 await db.query('BEGIN');try{
 const tables=['areas','value_streams','capabilities','workflows','activities','steps','workflow_activity_refs','skill_registry','map_scope_repositories','activity_cells'];
 for(const table of tables)for(const input of seed.tables[table]){
  const row=structuredClone(input);if(table==='workflow_activity_refs'&&row.source_commit)row.source_commit=revision;
  const keys=Object.keys(row);assert.ok(keys.every(k=>/^[a-z_]+$/.test(k)));
  await db.query(`INSERT INTO ${table}(${keys.map(k=>`"${k}"`).join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,keys.map(k=>row[k]));
 }
 for(const original of seed.manifests){
  const manifest=structuredClone(original);for(const n of [...manifest.value_streams,...manifest.capabilities])n.brain_binding.source_revision=revision;
  const digest=digestMapManifest(manifest),id=(await db.query(`INSERT INTO map_manifest_versions(scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,1,$2,$3,$4,'active',NOW()) RETURNING id`,[manifest.scope_key,manifest.source_decision_id,manifest,digest])).rows[0].id;
  const registration=seed.tables.map_scope_repositories.find(r=>r.scope_key===manifest.scope_key);
  await runProjection({client:db,manifestId:id,manifestDigest:digest,scopeKey:manifest.scope_key,manifest,factRevisions:{[registration.repo]:revision}});
 }
 await db.query('COMMIT');}catch(error){await db.query('ROLLBACK');throw error;}
 const before=await readExistingOpsRegistry(db),paths=fixedLocalGit(repoRoot,['ls-tree','-rz','--name-only',revision],{encoding:'utf8'}).split('\0').filter(Boolean);
 await registerExistingOpsSources(db,{scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision,paths,readSource:async path=>readFixedLocalGitBlob(repoRoot,{revision,path}).toString('utf8'),mode:'scratch_candidate',expectedRegistrySha256:before.registry_sha256,actor:'ci-admission-lease-pg-fixture'});
 assert.equal(stepSha256(await readExistingOpsRegistry(db)),stepSha256(before));
 const snapshot=await exportImplementationSnapshot(db,{scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision});
 assert.equal(snapshot.status,'verified');assert.deepEqual(snapshot.gaps,[]);return snapshot;
}
test('真实F3注册/投影和PR重建共用ci_admission lease，报告落盘但裸snapshot不落盘',{timeout:300000},async()=>{
 assert.equal(DB_DEFAULTS.database,'cecelia_scratch');assert.equal(DB_DEFAULTS.user,'ci');assert.ok(['localhost','127.0.0.1','::1','/tmp'].includes(DB_DEFAULTS.host));
 const parent=mkdtempSync(join(tmpdir(),'ci-admission-verification-pg-')),candidate=join(parent,'candidate'),schemas=[];let seedLease,lease;
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','-c','maintenance.auto=false','-c','gc.auto=0',...args],{cwd:candidate,encoding:'utf8',maxBuffer:32*1024*1024}).trim();
 try{
  execFileSync('git',['-c','maintenance.auto=false','-c','gc.auto=0','clone','--shared','--no-checkout','--quiet',root,candidate]);
  const toolingRevision=fixedLocalGit(root,['rev-parse','HEAD'],{encoding:'utf8'}).trim();git('checkout','--quiet','--detach',toolingRevision);git('remote','set-url','origin','https://github.com/perfectuser21/cecelia.git');
  for(const relative of ['','packages/brain','packages/engine','packages/quality','apps/api','apps/dashboard']){
   const target=join(candidate,relative,'node_modules'),source=join(root,relative,'node_modules');if(existsSync(source)&&!existsSync(target)){mkdirSync(dirname(target),{recursive:true});symlinkSync(source,target,'dir');}
  }
  const {seed}=loadCiAdmissionSeed(root,toolingRevision),base=git('rev-parse','HEAD');seedLease=await createCiAdmissionScratch();schemas.push(seedLease.schema);
  const snapshot=await realFactorySnapshot(seedLease.db,candidate,base,seed);await seedLease.close();seedLease=null;
  writeFileSync(join(candidate,'ci-admission-lease-test-input'),'real private PR delta');git('add','--','ci-admission-lease-test-input');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','test: isolated lease delta');const head=git('rev-parse','HEAD');
  lease=await createCiAdmissionScratch();schemas.push(lease.schema);const outputDir=join(parent,'evidence'),options={repoRoot:candidate,toolingRoot:root,toolingRevision,scope:'cecelia-factory',base,head,mode:'pr',snapshotBase:snapshot,snapshotHead:snapshot,outputDir,db:lease.db};
  await assert.rejects(collectImplementationPrEvidenceInScratch({...options,mode:'main'}),/ADMISSION_ONLY/);
  const {report}=await collectImplementationPrEvidenceInScratch(options);assert.equal(report.scope_key,'cecelia-factory');assert.equal(report.source.head_revision,head);
  assert.equal(existsSync(join(outputDir,'report.json')),true);assert.equal(existsSync(join(outputDir,'candidate.json')),false);
  assert.deepEqual(readdirSync(outputDir).sort(),['report.json']);
  const identity=(await lease.db.query('SELECT current_database() AS database,current_schema() AS schema')).rows[0];assert.equal(identity.database,'cecelia_scratch');assert.equal(identity.schema,lease.schema);
 }finally{
  try{if(seedLease)await seedLease.close();}finally{try{if(lease)await lease.close();}finally{rmSync(parent,{recursive:true,force:true});}}
  const admin=new pg.Client(DB_DEFAULTS);try{await admin.connect();assert.equal((await admin.query('SELECT count(*)::int n FROM pg_namespace WHERE nspname=ANY($1::text[])',[schemas])).rows[0].n,0);}finally{await admin.end();}
 }
});
