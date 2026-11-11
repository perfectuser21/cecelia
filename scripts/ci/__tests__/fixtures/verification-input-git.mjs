/** 每例私有可写Git仅共享不可变68对象；不改变调用仓的refs/index。 */
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
export function disposeVerificationSeed(){if(legacySeed)cleanupVerificationFixture(legacySeed);}
export function immutableVerificationSeed(root){
 if(legacySeed)return legacySeed;legacySeed=realpathSync(mkdtempSync(join(tmpdir(),'derived-immutable-git-')));
 const git=(...args)=>execFileSync('git',[...VERIFICATION_GIT_OPTIONS,...args],{cwd:legacySeed,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','--bare','-q');const objects=execFileSync('git',[...VERIFICATION_GIT_OPTIONS,'rev-parse','--path-format=absolute','--git-common-dir'],{cwd:root,encoding:'utf8'}).trim()+'/objects';
 writeFileSync(join(legacySeed,'objects/info/alternates'),objects+'\n');git('update-ref','refs/heads/immutable-68','68b996a5641b69e6f21705a114a4524e407fe097');git('symbolic-ref','HEAD','refs/heads/immutable-68');return legacySeed;
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

/** 同一冻结历史来源的schema reader和workflow样本；不代表当前仍有执行入口。 */
export function assertWorkflowSchemaReaderInputs(t, {basicEntryFixture, derived, root}) {
 const workflowFixtureRevision = '69de823cda6d789130898399c3ad770c15b6fb71';
 const paths = [
  'android-agent-ci', 'ci-l5-e2e-frontend', 'harness-v5-checks',
  'integration-nightly', 'nightly-real-machine', 'pr-review',
  'preview-deploy', 'skill-distillation-eval', 'smoke-e2e-nightly',
 ].map(name => `.github/workflows/${name}.yml`);
 const retired = ['.github/workflows/ci-l5-e2e-frontend.yml','.github/workflows/android-agent-ci.yml'];
 const active = paths.filter(path => !retired.includes(path));
 const reader = 'scripts/ci/__tests__/basic-workflow.test.mjs';
 const f = basicEntryFixture(t, 'scripts/ci/__tests__/basic-schema-input-fixture.test.mjs');
 assert.equal(f.git('config', '--get', 'core.sparseCheckoutCone'), 'false');
 f.git('sparse-checkout', 'add', ...[reader, ...paths].map(path => '/' + path));
 writeFileSync(join(f.root, reader),
  readFixedLocalGitBlob(root,{revision:workflowFixtureRevision,path:reader}));
 for (const path of paths) writeFileSync(join(f.root, path),
  readFixedLocalGitBlob(root,{revision:workflowFixtureRevision,path}));
 f.source.base_revision = f.commit();
 for (const path of active) writeFileSync(join(f.root, path), readFileSync(join(f.root, path), 'utf8') + '\n# schema input regression\n');
 for (const path of retired) rmSync(join(f.root, path));
 f.source.head_revision = f.commit();
 f.source.changed_files = f.git('diff', '--no-renames', '--name-only', f.source.base_revision, f.source.head_revision).split('\n').map(path => ({path}));
 assert.deepEqual(f.source.changed_files.map(row => row.path).sort(), [...paths].sort());
 const proof = derived(f);
 const rows = proof.rows.filter(row => row.input_facts.source.side === 'head' && active.includes(row.input_facts.path));
 for (const path of retired) {
  assert.ok(proof.rows.some(row => row.input_facts.source.side === 'base' && row.input_facts.path === path && row.witness.kind === 'workflow_yaml_schema_input'));
  assert.ok(proof.selection_states.some(row => row.path === path && row.side === 'head' && row.selection_state === 'absent'));
  assert.ok(!proof.rows.some(row => row.input_facts.path === path && row.input_facts.source.side === 'head'));
 }
 assert.equal(rows.length, active.length, '实际schema reader必须接收七项历史样本变更，删除样本仅保留base输入');
 for (const path of active) {
  const row = rows.find(row => row.input_facts.path === path);
  assert.equal(row.witness.kind, 'workflow_yaml_schema_input');
  assert.equal(row.witness.workflow_jobs_execution, 'not_evaluated');
  assert.equal(row.input_facts.source.revision, f.source.head_revision);
  assert.equal(row.input_facts.entry_verified, false);
  assert.equal(row.input_facts.owner_verified, false);
  assert.equal(row.execution_status, 'not_evaluated');
  assert.equal(row.coverage, 'unknown');
 }
}

/** 当前统一CI来源验证：在owned稀疏Git内迁移真实入口，篡改仍不能认领。 */
export function assertUnifiedSkillVerificationInputs(t,{basicEntryFixture,derived,root:liveRoot}) {
  const selectedPath='packages/brain/src/__tests__/ci-defense.skill-source.test.ts';
  const f=basicEntryFixture(t,selectedPath);
  for(const path of ['.github/workflows/ci.yml','scripts/ci/run-basic-check.mjs','scripts/ci/basic-scope.mjs',
    'scripts/ci/check-basic-results.mjs','scripts/ci/ops-checks.mjs','packages/brain/vitest.config.js',
    'scripts/ci/skill-source-tests.mjs','scripts/ci/run-skill-source-check.mjs','scripts/ci/__tests__/basic-skill-source-coverage.test.mjs',
    '.github/actions/skills-source/action.yml','scripts/ci/check-skill-source-identity.py','apps/api/vitest.config.ts','apps/dashboard/vitest.config.ts','scripts/ci/__tests__/basic-w19-freeze.test.mjs','packages/brain/vitest.skill-source.config.mjs',selectedPath]) {
    mkdirSync(join(f.root,path.slice(0,path.lastIndexOf('/'))),{recursive:true});writeFileSync(join(f.root,path),readFileSync(join(liveRoot,path)));
  }
  f.git('rm','--sparse','-f','.github/workflows/skills-source-check.yml');
  f.source.base_revision=f.commit();writeFileSync(join(f.root,selectedPath),readFileSync(join(f.root,selectedPath),'utf8')+'\n// changed fixed test input\n');
  f.source.head_revision=f.commit();f.source.changed_files=[{path:selectedPath}];
  const proof=derived(f),rows=proof.rows.filter(r=>r.input_facts.path===selectedPath);
  assert.equal(rows.length,2,JSON.stringify(proof.unproven));
  assert.ok(rows.every(row=>row.witness.workflow.path==='.github/workflows/ci.yml' && row.execution_status==='not_evaluated'));
  assert.ok(rows.every(row=>row.eligible_owner_paths.includes('.github/workflows/ci.yml') && !row.eligible_owner_paths.includes('.github/workflows/skills-source-check.yml')));
  const ciPath='.github/workflows/ci.yml',current=readFileSync(join(f.root,ciPath),'utf8');
  writeFileSync(join(f.root,ciPath),current.replace('node scripts/ci/run-skill-source-check.mjs','echo node scripts/ci/run-skill-source-check.mjs'));
  f.source.head_revision=f.commit();f.source.changed_files=[{path:selectedPath},{path:ciPath}];
  const rejected=derived(f);
  assert.equal(rejected.rows.some(row=>row.input_facts.path===selectedPath&&row.input_facts.source.side==='head'),false);
  assert.ok(rejected.unproven.some(row=>row.path===selectedPath));
}

/** 当前功能跑道的真实私有Git：API features归Dashboard，旧src及未选外围reader不能借config取得资格。 */
export function assertFunctionalConsumerInputs(t,{basicEntryFixture,derived,root:liveRoot}) {
 const support=['.github/workflows/ci.yml','scripts/ci/run-basic-check.mjs','scripts/ci/basic-scope.mjs',
  'scripts/ci/check-basic-results.mjs','scripts/ci/ops-checks.mjs','packages/brain/vitest.config.js',
  'scripts/ci/skill-source-tests.mjs','scripts/ci/run-skill-source-check.mjs','scripts/ci/__tests__/basic-skill-source-coverage.test.mjs',
  '.github/actions/skills-source/action.yml','scripts/ci/check-skill-source-identity.py','apps/api/vitest.config.ts','apps/dashboard/vitest.config.ts','scripts/ci/__tests__/basic-w19-freeze.test.mjs'];
 const fixture=path=>{
  const f=basicEntryFixture(t,path);
  for(const p of support){mkdirSync(join(f.root,p.slice(0,p.lastIndexOf('/'))),{recursive:true});writeFileSync(join(f.root,p),readFileSync(join(liveRoot,p)));}
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
