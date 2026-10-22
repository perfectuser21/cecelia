import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readNativeConsumerRuntime} from '../../../packages/brain/src/lib/native-consumer-runtime.js';
import {inspectRecoveryRuntime,verifyRecoveryAuthority,sealRecoveryBundle,assertRecoveryPurpose} from '../implementation-source-recovery.mjs';
const repo='perfectuser21/cecelia',hash=x=>createHash('sha256').update(x).digest('hex');
const dir=mkdtempSync(join(tmpdir(),'source-recovery-'));
const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','core.hooksPath','/dev/null');
git('remote','add','origin',`https://github.com/${repo}.git`);
const paths=readNativeConsumerRuntime().files.map(f=>f.path);
for(const p of [...paths,'scripts/lib/brain-staging.sh']){mkdirSync(dirname(join(dir,p)),{recursive:true});writeFileSync(join(dir,p),`// original ${p}\n`);}
git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
writeFileSync(join(dir,paths[0]),'// reviewed collector\n');git('commit','-qam','merged source-only');const head=git('rev-parse','HEAD');
test.after(()=>rmSync(dir,{recursive:true,force:true}));
const identity={schema_version:1,repo,git_sha:base,files:paths.map(path=>({path,sha256:hash(`// original ${path}\n`)}))};
const opts={repoRoot:dir,base,head};
function api(overrides={}){
 const routes={
  [`repos/${repo}/commits/main`]:{sha:head},
  [`repos/${repo}/commits/${head}/pulls`]:[{number:9}],
  [`repos/${repo}/pulls/9`]:{number:9,merged:true,merge_commit_sha:head,head:{sha:'a'.repeat(40),repo:{full_name:repo}},base:{sha:base,ref:'main',repo:{full_name:repo}}},
  [`repos/${repo}/commits/${'a'.repeat(40)}/check-runs?per_page=100`]:{total_count:5,check_runs:['ci-passed','Harness V5 Gate Passed','Smoke Glob Runner Passed','Skill source ownership','Implementation impact gate'].map(name=>({name,status:'completed',conclusion:'success',head_sha:'a'.repeat(40),app:{slug:'github-actions'},details_url:'https://github.com/perfectuser21/cecelia/actions/runs/7/job/8'}))},
  [`repos/${repo}/actions/runs/7`]:{id:7,event:'pull_request',path:'.github/workflows/implementation-impact.yml',head_sha:'a'.repeat(40),repository:{full_name:repo},head_repository:{full_name:repo},pull_requests:[{number:9,base:{sha:base},head:{sha:'a'.repeat(40)}}]},
 };
 return async p=>structuredClone(Object.hasOwn(overrides,p)?overrides[p]:routes[p]);
}
test('合并main由旧base的独立PR准入成功后才准许来源编译',async()=>{
 const proof=await verifyRecoveryAuthority(opts,{github:api()});assert.equal(proof.base_revision,base);assert.equal(proof.head_revision,head);assert.equal(proof.impact_run_id,7);
});
for(const [name,route,value] of [
 ['未合并',`pulls/9`,{merged:false}],['主干漂移','commits/main',{sha:base}],
 ['没有关联PR',`commits/${head}/pulls`,[]],
 ['缺独立检查',`commits/${'a'.repeat(40)}/check-runs?per_page=100`,{total_count:0,check_runs:[]}],
 ['错误base运行','actions/runs/7',{id:7,event:'pull_request',path:'.github/workflows/implementation-impact.yml',head_sha:'a'.repeat(40),repository:{full_name:repo},head_repository:{full_name:repo},pull_requests:[{number:9,base:{sha:'b'.repeat(40)},head:{sha:'a'.repeat(40)}}]}],
])test(`${name}不能产来源基线`,async()=>assert.rejects(verifyRecoveryAuthority(opts,{github:api({[`repos/${repo}/${route}`]:value})})));
test('实读旧collector身份只记not_deployed，绝不标ready',async()=>{
 const r=await inspectRecoveryRuntime({...opts,brainUrl:'http://fixture.invalid',token:'fixture'},{fetchFn:async()=>new Response(JSON.stringify(identity))});
 assert.equal(r.status,'source_only');assert.equal(r.runtime_status,'not_deployed');assert.equal(r.runtime.git_sha,base);
});
test('任一旧collector哈希漂移或HTTP错误拒绝恢复',async()=>{
 const bad=structuredClone(identity);bad.files[0].sha256='0'.repeat(64);
 for(const response of [new Response(JSON.stringify(bad)),new Response('{}',{status:503})])await assert.rejects(inspectRecoveryRuntime({...opts,brainUrl:'http://fixture.invalid',token:'fixture'},{fetchFn:async()=>response}));
});
test('恢复来源产物不得用于release，不能把业务unknown洗成通过',()=>{
 const s={revision:head,scope:'cecelia-factory',snapshot_scope:'consumer_evidence',execution_status:'unknown',status:'verified',gaps:[]};
 const sealed=sealRecoveryBundle(s,{head_revision:head,base_revision:base,runtime_status:'not_deployed'});
 assert.equal(sealed.execution_status,'unknown');assert.equal(sealed.source_baseline.purpose,'admission_source_only');
 assertRecoveryPurpose(sealed,'pr');assert.throws(()=>assertRecoveryPurpose(sealed,'main'),/SOURCE_RECOVERY_RELEASE_FORBIDDEN/);
});
