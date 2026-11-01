/** 每例私有可写Git仅共享不可变68对象；不改变调用仓的refs/index。 */
import {mkdtempSync,realpathSync,writeFileSync,rmSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
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
