/** 显式PG跑道：无DB直接失败；实际生产注册/投影/登记断言，不运行模型或真机。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,copyFileSync,mkdirSync,symlinkSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {DB_DEFAULTS} from '../../../packages/brain/src/db-config.js';
import {buildCiAdmissionDraft} from '../ci-admission-builder.mjs';
import {runCiAdmissionWorker} from '../ci-admission-worker-runner.mjs';
import {validateImplementationSnapshot} from '../../../packages/brain/src/lib/implementation-ci-snapshot.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('真实PG三scope重建、17登记绑定/4命令实际执行、原有UNKNOWN/current边界和资源清理', {timeout:900000},async()=>{
 assert.equal(DB_DEFAULTS.database,'cecelia_scratch');assert.ok(['127.0.0.1','localhost','/tmp'].includes(DB_DEFAULTS.host));
 const dir=mkdtempSync(join(tmpdir(),'ci-admission-builder-pg-'));
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','-c','maintenance.auto=false','-c','gc.auto=0',...args],{cwd:dir,encoding:'utf8',maxBuffer:32*1024*1024}).trim();
 let observed;
 try{
  git('clone','--quiet','--shared','--no-checkout',root,'.');git('checkout','--quiet','--detach',execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim());
  const seed='scripts/ci/config/ci-admission-registry.json';mkdirSync(dirname(join(dir,seed)),{recursive:true});copyFileSync(join(root,seed),join(dir,seed));
  git('add','--',seed);git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','--allow-empty','-m','test: private reviewed CI metadata');
  git('remote','set-url','origin','https://github.com/perfectuser21/cecelia.git');symlinkSync(join(root,'node_modules'),join(dir,'node_modules'),'dir');
  symlinkSync(join(root,'packages/brain/node_modules'),join(dir,'packages/brain/node_modules'),'dir');
  const revision=git('rev-parse','HEAD');
  const draft=await buildCiAdmissionDraft({sourceRoot:dir,controlRoot:dir,sourceRevision:revision,controlRevision:revision},{observe:value=>{observed=value;}});
  assert.equal(draft.ci_format,'cecelia.ci-admission-draft/v1');assert.throws(()=>validateImplementationSnapshot(draft));
  assert.deepEqual(draft.ci_scopes.map(s=>s.ci_scope_key),['cecelia-kr','cecelia-factory','cecelia-infra']);
  assert.equal(draft.ci_assertions.required.length,17);assert.equal(draft.ci_assertions.executions.length,4);
  assert.equal(new Set(draft.ci_assertions.executions.flatMap(e=>e.registered_ids)).size,17);
  assert.ok(draft.ci_assertions.executions.every(e=>e.exit_code===0&&!e.signal&&!e.error));
  assert.equal(observed.cells,121);assert.equal(observed.factory_current_pointers,0);assert.equal(observed.infra_current_pointers,0);
  assert.match(observed.schema,/^ci_admission_[a-f0-9]{32}$/);
  assert.ok(observed.projections>=3);assert.ok(observed.graphs>=3);assert.equal(observed.registry_preserved,true);
  const admin=new pg.Client(DB_DEFAULTS);try{await admin.connect();assert.equal((await admin.query('SELECT count(*)::int n FROM pg_namespace WHERE nspname=$1',[observed.schema])).rows[0].n,0);}finally{await admin.end();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('真实Node worker完整重建同一固定Git与17/4，最小env下真实PG读回和资源归零',{timeout:900000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ci-admission-worker-pg-'));
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','-c','maintenance.auto=false','-c','gc.auto=0',...args],{cwd:dir,encoding:'utf8',maxBuffer:32*1024*1024}).trim();
 let observed;
 try{
  git('clone','--quiet','--shared','--no-checkout',root,'.');git('checkout','--quiet','--detach',execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim());
  const paths=[...readdirSync(join(root,'scripts/ci')).filter(p=>p.startsWith('ci-admission-')&&p.endsWith('.mjs')).map(p=>'scripts/ci/'+p),
   'scripts/ci/implementation-snapshot.mjs','scripts/ci/implementation-scratch.mjs','scripts/ci/config/ci-admission-registry.json'];
  for(const path of paths){mkdirSync(dirname(join(dir,path)),{recursive:true});copyFileSync(join(root,path),join(dir,path));}
  git('add','--',...paths);git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','--allow-empty','-m','test: private reviewed CI worker tools');
  git('remote','set-url','origin','https://github.com/perfectuser21/cecelia.git');symlinkSync(join(root,'node_modules'),join(dir,'node_modules'),'dir');symlinkSync(join(root,'packages/brain/node_modules'),join(dir,'packages/brain/node_modules'),'dir');
  const revision=git('rev-parse','HEAD'),draft=await runCiAdmissionWorker({sourceRoot:dir,controlRoot:dir,sourceRevision:revision,controlRevision:revision},{observe:value=>{observed=value;}});
  assert.equal(draft.ci_format,'cecelia.ci-admission-draft/v1');assert.equal(draft.ci_assertions.required.length,17);assert.equal(draft.ci_assertions.executions.length,4);
  assert.ok(draft.ci_assertions.executions.every(e=>e.exit_code===0&&!e.signal&&!e.error));assert.equal(observed.cells,121);
  assert.equal(observed.factory_current_pointers,0);assert.equal(observed.infra_current_pointers,0);assert.ok(observed.projections>=3&&observed.graphs>=3);assert.equal(observed.registry_preserved,true);
  const admin=new pg.Client(DB_DEFAULTS);try{await admin.connect();assert.equal((await admin.query('SELECT count(*)::int n FROM pg_namespace WHERE nspname=$1',[observed.schema])).rows[0].n,0);}finally{await admin.end();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
