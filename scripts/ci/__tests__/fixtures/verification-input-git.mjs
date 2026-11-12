/** 每例私有可写Git仅共享不可变当前main对象；不改变调用仓的refs/index。 */
import {mkdtempSync,realpathSync,writeFileSync,rmSync,mkdirSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {readFixedLocalGitBlob} from '../../fixed-local-git.mjs';
export const VERIFICATION_GIT_OPTIONS=Object.freeze([
 '-c','maintenance.auto=false','-c','gc.auto=0','-c','gc.autoDetach=false',
]);
let legacySeed;
export function cleanupVerificationFixture(root,{remove=rmSync}={}){
 for(let attempt=0;;attempt++){
  try{return remove(root,{recursive:true,force:true});}
  catch(error){
   if(error?.code!=='ENOTEMPTY'||attempt===3)throw error;
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20*(attempt+1));
  }
 }
}
export function disposeVerificationSeed(){if(legacySeed)cleanupVerificationFixture(legacySeed);legacySeed=undefined;}
export function immutableVerificationSeed(root){
 if(legacySeed)return legacySeed;legacySeed=realpathSync(mkdtempSync(join(tmpdir(),'derived-immutable-git-')));
 const git=(...args)=>execFileSync('git',[...VERIFICATION_GIT_OPTIONS,...args],{cwd:legacySeed,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','--bare','-q');const objects=execFileSync('git',[...VERIFICATION_GIT_OPTIONS,'rev-parse','--path-format=absolute','--git-common-dir'],{cwd:root,encoding:'utf8'}).trim()+'/objects';
 writeFileSync(join(legacySeed,'objects/info/alternates'),objects+'\n');git('update-ref','refs/heads/immutable-current','dce0866298f5db9a17b472de3a50cfb24efff52e');git('symbolic-ref','HEAD','refs/heads/immutable-current');return legacySeed;
}
export function fixedInputFixture(t,{kind='regular'}={}){
 const root=mkdtempSync(join(tmpdir(),'derived-input-git-'));
 t.after(()=>cleanupVerificationFixture(root));
 const git=(...args)=>execFileSync('git',[...VERIFICATION_GIT_OPTIONS,'--no-replace-objects','-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('remote','add','origin','https://github.com/perfectuser21/cecelia.git');
 const path='packages/brain/src/__tests__/actual.test.js';mkdirSync(join(root,'packages/brain/src/__tests__'),{recursive:true});
 writeFileSync(join(root,'packages/brain/src/business.js'),'export const business=true;\n');
 writeFileSync(join(root,path),'export const before=true;\n');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','test: base');const base=git('rev-parse','HEAD');
 if(kind==='deleted')rmSync(join(root,path));else if(kind==='symlink'){rmSync(join(root,path));symlinkSync('../business.js',join(root,path));}else writeFileSync(join(root,path),'export const after=true;\n');
 git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','test: head');const head=git('rev-parse','HEAD');
 return{root,path,git,source:{repo:'perfectuser21/cecelia',base_revision:base,head_revision:head,changed_files:[{path}]}};
}

/** Resolver先写元数据，三scope随后共用同一输出目录；这里只验证文件边界，不授予准入资格。 */
export function assertTypedResolverOutputLayout(root, assertOutput) {
 const base = 'a'.repeat(40), head = 'b'.repeat(40), digest = 'c'.repeat(64);
 const scopes = ['cecelia-kr', 'cecelia-factory', 'cecelia-infra'];
 const metadata = {
  schema_version: 1,
  purpose: 'admission_only',
  baseline_kind: 'ci_admission_only',
  status: 'selected',
  repo: 'perfectuser21/cecelia',
  pr_number: 1,
  original_pr_base_revision: base,
  effective_base_revision: base,
  tooling_revision: base,
  head_revision: head,
  chain: [{ revision: base, status: 'selected', artifact_kind: 'ci_admission_only',
   artifact_id: 1, artifact_digest: 'sha256:' + digest, run_id: 1 }],
  base_ci_admission_sha256: digest,
  scope_hashes: Object.fromEntries(scopes.map(scope => [scope, digest])),
  changed_files: ['scripts/ci/implementation-multi-pr-gate.mjs'],
  business_runtime_status: 'not_evaluated',
 };
 for (const scope of scopes) {
  mkdirSync(join(root, scope), { recursive: true });
  writeFileSync(join(root, scope, 'report.json'), '{}');
 }
 const path = join(root, 'baseline-resolution.json');
 writeFileSync(path, JSON.stringify(metadata));
 assert.doesNotThrow(() => assertOutput(root));
 const nestedMetadata = join(root, 'cecelia-factory', 'baseline-resolution.json');
 writeFileSync(nestedMetadata, JSON.stringify(metadata));
 assert.throws(() => assertOutput(root), /ADMISSION_OUTPUT/);
 rmSync(nestedMetadata);
 writeFileSync(path, JSON.stringify({ ...metadata, debug: {
  snapshot: { schema_version: 1, scope: 'cecelia-factory', snapshot_sha256: digest },
 } }));
 assert.throws(() => assertOutput(root), /ADMISSION_OUTPUT/);
 writeFileSync(path, JSON.stringify(metadata));
 const extra = join(root, 'unexpected.json');
 writeFileSync(extra, '{}');
 assert.throws(() => assertOutput(root), /ADMISSION_OUTPUT/);
 rmSync(extra);
 const directory = join(root, 'unknown-scope');
 mkdirSync(directory);
 assert.throws(() => assertOutput(root), /ADMISSION_OUTPUT/);
 rmSync(directory, { recursive: true });
 assert.doesNotThrow(() => assertOutput(root));
}

/** 当前功能跑道的真实私有Git：API features归Dashboard，旧src及未选外围reader不能借config取得资格。 */
export function assertFunctionalConsumerInputs(t,{basicEntryFixture,derived,root:liveRoot}) {
 const support=['.github/workflows/ci.yml','scripts/ci/run-basic-check.mjs','scripts/ci/basic-scope.mjs',
  'scripts/ci/check-basic-results.mjs','scripts/ci/ops-checks.mjs','packages/brain/vitest.config.js',
  'scripts/ci/skill-source-tests.mjs','scripts/ci/run-skill-source-check.mjs','scripts/ci/__tests__/basic-skill-source-coverage.test.mjs',
  '.github/actions/skills-source/action.yml','scripts/ci/check-skill-source-identity.py','apps/api/vitest.config.ts','apps/dashboard/vitest.config.ts','scripts/ci/__tests__/basic-w19-freeze.test.mjs'];
 const fixture=path=>{
  const f=basicEntryFixture(t,path);
  for(const p of support){mkdirSync(join(f.root,p.slice(0,p.lastIndexOf('/'))),{recursive:true});writeFileSync(join(f.root,p),readFixedLocalGitBlob(liveRoot,{revision:'dce0866298f5db9a17b472de3a50cfb24efff52e',path:p}));}
  f.source.base_revision=f.commit();writeFileSync(join(f.root,path),'export const changedFunctionalInput=true;\n');
  f.source.head_revision=f.commit();f.source.changed_files=[{path}];return f;
 };
 for(const path of ['apps/api/features/__tests__/functional.test.ts','apps/api/src/__tests__/retired.test.ts','apps/api/tests/retired.test.ts','packages/engine/tests/functional.skill-source.test.ts','packages/quality/functional.skill-source.test.ts']){
  const f=fixture(path),proof=derived(f),rows=proof.rows.filter(r=>r.input_facts.path===path);
  if(path.startsWith('apps/api/features/')){
   assert.equal(rows.length,2,JSON.stringify(proof.unproven));
   assert.ok(rows.every(r=>r.witness.component==='dashboard'&&r.witness.config.path==='apps/api/vitest.config.ts'));
  }else assert.equal(rows.length,0,'旧API不能继承已收窄的Dashboard验证入口');
 }
 for(const [reader,selected] of [['scripts/preview-cache-functional.test.mjs',false],['scripts/bluegreen-sidecar-functional.test.mjs',true]]){
  const path='packages/brain/src/__tests__/helpers/functional.fixture.js',f=fixture(path);
  writeFileSync(join(f.root,reader),`import '../${path}';\n`);f.source.base_revision=f.commit();
  writeFileSync(join(f.root,path),'export const changedFunctionalHelper=true;\n');f.source.head_revision=f.commit();f.source.changed_files=[{path}];
  const proof=derived(f,{readerPaths:{base:[reader],head:[reader]}}),rows=proof.rows.filter(r=>r.input_facts.path===path);
  assert.equal(rows.length,selected?2:0,JSON.stringify(proof.unproven));
 }
}
