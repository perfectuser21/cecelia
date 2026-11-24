import {it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {collectBasicCiSources,collectDeepCiSources} from '../existing-ops-stage-source.js';
import {reviewedPilotControls,REVIEWED_FOUNDATION_RELEASE,REVIEWED_FIXED_CHECKS,REVIEWED_NIGHTLY_STATUS} from '../existing-ops-stage-modes.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const old=readFixedExistingOpsGitFixture('0431a8d3242783f1d94221cb5471ac40dda7fbd6');
const stable=readFixedExistingOpsGitFixture('99041a42de8ad78a8891678c570b14bc2e3c7c95');
const main272=readFixedExistingOpsGitFixture('2a921e107cc042e6bfafd367ae4735281957d35e');
const parentBase=readFixedExistingOpsGitFixture('e7f68785cfd16a5f29943d0f92e62956dd950542');
const nativePreviousInputs=['scripts/ci/__tests__/basic-fixed-core.test.mjs','scripts/ci/run-basic-check.mjs','scripts/ci/ops-checks.mjs','packages/brain/src/scheduler-jobs.js','packages/brain/Dockerfile','scripts/ci/__tests__/basic-ops-coverage.test.mjs','scripts/ci/__tests__/helpers/brain-deploy-predecessor.fixture.mjs','tests/brain-ci-pg-layering.test.ts'];
const deploy='scripts/brain-deploy.sh',drain='scripts/lib/brain-drain-client.sh';
const cli='scripts/ci/pilot-release-verification.mjs',helper='scripts/ci/pilot-foundation-bindings.mjs';
const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(root+p));
const read=p=>readFileSync(root+p,'utf8');
// 原已审复合父组以e7f基底固定，不是历史Git快照。
const cacheInputs=['scripts/brain-build.sh','scripts/staging-deploy.sh','scripts/lib/brain-candidate-docker.sh','scripts/lib/brain-staging.sh','scripts/ci/__tests__/basic-brain-candidate-host.test.mjs'];
const recoveryNew=['scripts/ci/__tests__/basic-brain-predecessor.test.mjs','scripts/ci/__tests__/helpers/brain-deploy-predecessor.fixture.mjs','scripts/lib/brain-post-deploy.sh'];
const parent={revision:'f'.repeat(40),paths:parentBase.paths.filter(p=>p!==drain&&!recoveryNew.includes(p)&&p!=='packages/brain/config/native-agent.json'&&p!=='scripts/ci/__tests__/basic-native-agent-deploy.test.mjs'),read:p=>[deploy,'scripts/__tests__/brain-deploy-sha-readonly.test.sh','scripts/ci/__tests__/basic-retired-cd-entrypoints.test.mjs','scripts/ci/prepare-ubuntu-archive.mjs','scripts/ci/__tests__/basic-ubuntu-archive.test.mjs',...cacheInputs].includes(p)?stable.read(p):nativePreviousInputs.includes(p)?main272.read(p):parentBase.read(p)};
async function collect({deep=false,fixture,missing,overrides={},extraPaths=[]}={}){
 const tree=[...new Set([...(fixture?.paths??paths),...extraPaths])].filter(p=>p!==missing),source=async p=>{
  if(!tree.includes(p))throw Error('missing fixed input');return overrides[p]??(fixture?fixture.read(p):read(p));
 };
 const relations=[],request={read:source,paths:tree,revision:fixture?.revision??'f'.repeat(40),relations,parse:s=>parse(s,{ecmaVersion:'latest',sourceType:'module'})};
 if(deep)await collectDeepCiSources(request);else await collectBasicCiSources({...request,ci:await source('.github/workflows/ci.yml')});
 return relations;
}
it('新Pilot固定宿主完整组与原0431组分别保持Basic/Deep来源证明',async()=>{
 for(const deep of [false,true]){
  expect(await collect({deep,fixture:old})).not.toHaveLength(0);
  const current=await collect({deep});expect(current).not.toHaveLength(0);
  expect(current).toContainEqual(expect.objectContaining({consumer_path:cli,input_path:helper,kind:'reviewed_pilot_foundation_host_source'}));
 }
});
for(const deep of [false,true])for(const target of [cli,helper])it(`拒绝${deep?'Deep':'Basic'}完整组缺失或任意变更：${target}`,async()=>{
 await expect(collect({deep,missing:target})).rejects.toThrow();
 await expect(collect({deep,overrides:{[target]:read(target)+'\n// unreviewed'}})).rejects.toThrow();
});
it('新helper与旧CLI不能混配，新CLI无helper不能借旧0431组通过',async()=>{
 for(const deep of [false,true]){
  await expect(collect({deep,overrides:{[cli]:old.read(cli)}})).rejects.toThrow();
  await expect(collect({deep,fixture:old,overrides:{[cli]:read(cli)}})).rejects.toThrow();
 }
});

it('固定Pilot双源不得混入其他历史profile或伪造当前profile',()=>{
 for(const profile of [REVIEWED_FOUNDATION_RELEASE,REVIEWED_FIXED_CHECKS,{...REVIEWED_NIGHTLY_STATUS}])
  expect(()=>reviewedPilotControls(profile,[cli,helper])).toThrow('basic_ci_source_unproven');
});

it('当前十七项真实PG只接受固定runner，旧十项组与任何未知混配继续拒绝', async () => {
 const runner='scripts/ci/run-basic-check.mjs';
 for(const deep of [false,true]){
  const current=await collect({deep});
  if(!deep)expect(current).toContainEqual(expect.objectContaining({consumer_path:runner,input_path:'packages/brain/src/__tests__/integration/drain-process-scope.pg.integration.test.js',kind:'reviewed_pr_postgres_test_selector'}));
  await expect(collect({deep,overrides:{[runner]:read(runner)+'\n// unreviewed runner'}})).rejects.toThrow('basic_ci_source_unproven');
  await expect(collect({deep,overrides:{[runner]:old.read(runner)}})).rejects.toThrow('basic_ci_source_unproven');
  await expect(collect({deep,fixture:old,overrides:{[runner]:read(runner)}})).rejects.toThrow('basic_ci_source_unproven');
 }
});

it('PG分层回归只接受新旧两个精确版本，当前Pilot完整组继续有效',async()=>{
 const target='tests/brain-ci-pg-layering.test.ts';
 for(const deep of [false,true]){
  expect(await collect({deep,fixture:main272,overrides:{[target]:stable.read(target)}})).not.toHaveLength(0);
  expect(await collect({deep})).not.toHaveLength(0);
  await expect(collect({deep,missing:target})).rejects.toThrow();
  await expect(collect({deep,overrides:{[target]:read(target)+'\n// unknown PG controls'}})).rejects.toThrow('basic_ci_source_unproven');
 }
});
it('持久排空客户端与旧部署评审组合分别接受，Basic和Deep消费真实部署依赖边',async()=>{
 for(const deep of [false,true]){
  const current=await collect({deep});
  expect(current).toContainEqual(expect.objectContaining({consumer_path:deploy,input_path:drain,kind:'reviewed_persistent_process_drain_client'}));
  expect(await collect({deep,fixture:parent})).not.toHaveLength(0);
  expect(await collect({deep,fixture:parent,overrides:{'tests/brain-ci-pg-layering.test.ts':stable.read('tests/brain-ci-pg-layering.test.ts')}})).not.toHaveLength(0);
 }
});
for(const deep of [false,true])it(`拒绝${deep?'Deep':'Basic'}持久排空来源缺失、篡改或父子混配`,async()=>{
 await expect(collect({deep,missing:drain})).rejects.toThrow();
 for(const path of [deploy,drain])await expect(collect({deep,overrides:{[path]:read(path)+'\n# unreviewed'}})).rejects.toThrow();
 await expect(collect({deep,overrides:{[deploy]:parent.read(deploy)}})).rejects.toThrow();
 await expect(collect({deep,fixture:parent,overrides:{[deploy]:read(deploy)}})).rejects.toThrow();
 await expect(collect({deep,fixture:parent,extraPaths:[drain],overrides:{[drain]:read(drain)}})).rejects.toThrow();
});

it('候选缓存回收的完整来源与已发布f098组分别有效，单成员缺失或混配拒绝',async()=>{
 const prior=readFixedExistingOpsGitFixture('f098854a1e16621576685052ef41b00a9622daa6');
 for(const deep of [false,true]){
  expect(await collect({deep})).not.toHaveLength(0);
  expect(await collect({deep,fixture:prior})).not.toHaveLength(0);
  for(const member of [...cacheInputs,deploy]){
   await expect(collect({deep,missing:member})).rejects.toThrow();
   await expect(collect({deep,overrides:{[member]:prior.read(member)}})).rejects.toThrow();
   // 旧组未将这两个独立stage脚本登记为来源输入，不能倒称已有历史保护。
   if(!['scripts/staging-deploy.sh','scripts/lib/brain-staging.sh'].includes(member))await expect(collect({deep,fixture:prior,overrides:{[member]:read(member)}})).rejects.toThrow();
  }
 }
});

it('恢复清退完整组真实消费新helper，当前十二成员缺失/未知拒绝，e38旧组保留',async()=>{
 const prior=readFixedExistingOpsGitFixture('e38df977718bc673e0a22b12e363dbd964ed7699');
 const members=["scripts/lib/brain-drain-client.sh","scripts/brain-deploy.sh","scripts/brain-rollback.sh","scripts/lib/bluegreen.sh","scripts/lib/bluegreen-sidecar.sh","scripts/lib/brain-post-deploy.sh","scripts/__tests__/brain-deploy-sha-readonly.test.sh","scripts/ci/__tests__/basic-retired-cd-entrypoints.test.mjs","scripts/ci/__tests__/basic-brain-predecessor.test.mjs","scripts/ci/__tests__/helpers/brain-deploy-predecessor.fixture.mjs","scripts/ci/prepare-ubuntu-archive.mjs","scripts/ci/__tests__/basic-ubuntu-archive.test.mjs"];
 for(const deep of [false,true]){
  const current=await collect({deep});expect(current).toContainEqual(expect.objectContaining({consumer_path:deploy,input_path:'scripts/lib/brain-post-deploy.sh',kind:'reviewed_deploy_post_success_helper'}));
  expect(await collect({deep,fixture:prior})).not.toHaveLength(0);
  for(const member of members){
   await expect(collect({deep,missing:member})).rejects.toThrow();
   await expect(collect({deep,overrides:{[member]:read(member)+'\n// unreviewed recovery bytes\n'}})).rejects.toThrow();
   if(prior.paths.includes(member)&&prior.read(member)!==read(member))await expect(collect({deep,overrides:{[member]:prior.read(member)}})).rejects.toThrow();
  }
  // 旧组只对它真实固定的三个成员断言反向拒绝，不倒称已有新helper保护。
  for(const member of [deploy,'scripts/__tests__/brain-deploy-sha-readonly.test.sh','scripts/ci/__tests__/basic-retired-cd-entrypoints.test.mjs'])
   await expect(collect({deep,fixture:prior,overrides:{[member]:read(member)}})).rejects.toThrow();
  await expect(collect({deep,fixture:prior,extraPaths:[recoveryNew[0]],overrides:{[recoveryNew[0]]:read(recoveryNew[0])}})).rejects.toThrow();
 }
});

const nativeMarker='packages/brain/config/native-agent.json';
const nativeMembers=[nativeMarker,'scripts/ci/__tests__/basic-fixed-core.test.mjs','scripts/ci/run-basic-check.mjs','scripts/ci/ops-checks.mjs','scripts/brain-deploy.sh','packages/brain/src/scheduler-jobs.js','packages/brain/Dockerfile','scripts/ci/__tests__/basic-ops-coverage.test.mjs','scripts/ci/__tests__/helpers/brain-deploy-predecessor.fixture.mjs','scripts/ci/__tests__/basic-native-agent-deploy.test.mjs','packages/brain/scripts/native-agent-release.mjs','packages/brain/scripts/native-agent/__tests__/native-agent.node-test.mjs','tests/brain-ci-pg-layering.test.ts',...['bundle.mjs','config.mjs','store.mjs','process.mjs','worker.mjs','cli.mjs'].map(p=>'packages/brain/scripts/native-agent/'+p),'packages/brain/scripts/coding-workflow/lib/codex-auth.mjs','packages/brain/src/orchestrator/activity-supervisor-state.cjs'];
it('原生执行端仅接受有限完整来源；17项PG与真实发布和镜像消费边，main272历史仍有效',async()=>{
 const prior=readFixedExistingOpsGitFixture('2a921e107cc042e6bfafd367ae4735281957d35e');
 for(const deep of [false,true]){
  expect(await collect({deep,fixture:prior})).not.toHaveLength(0);
  const current=await collect({deep});
  expect(current).toContainEqual(expect.objectContaining({consumer_path:deploy,input_path:'packages/brain/scripts/native-agent-release.mjs',kind:'reviewed_native_agent_release_entry'}));
  expect(current).toContainEqual(expect.objectContaining({consumer_path:'scripts/ci/run-basic-check.mjs',input_path:'packages/brain/scripts/native-agent/bundle.mjs',kind:'reviewed_native_agent_image_bundle_check'}));
  if(!deep){const pg=current.filter(r=>r.kind==='reviewed_pr_postgres_test_selector');expect(pg).toHaveLength(17);for(const name of ['resource-lease','api-control','flow','notion-flow'])expect(pg).toContainEqual(expect.objectContaining({input_path:'packages/brain/src/__tests__/integration/native-agent-'+name+'.pg.integration.test.js'}));}
  for(const member of nativeMembers){
   await expect(collect({deep,missing:member})).rejects.toThrow();
   await expect(collect({deep,overrides:{[member]:read(member)+'\n# unknown native source'}})).rejects.toThrow();
   if(prior.paths.includes(member)&&prior.read(member)!==read(member))await expect(collect({deep,overrides:{[member]:prior.read(member)}})).rejects.toThrow();
  }
  await expect(collect({deep,fixture:prior,extraPaths:[nativeMarker],overrides:{[nativeMarker]:read(nativeMarker)}})).rejects.toThrow();
 }
});

it('原生快速收割只追加已审scheduler字节，main274完整组与缺失漂移保护保留',async()=>{
 const prior=readFixedExistingOpsGitFixture('59635bb16d2243a51a6ea07f5cbafaca3fa4aac7'),scheduler='packages/brain/src/scheduler-jobs.js';
 for(const deep of [false,true]){
  expect(await collect({deep,fixture:prior})).not.toHaveLength(0);
  expect(await collect({deep})).not.toHaveLength(0);
  await expect(collect({deep,missing:scheduler})).rejects.toThrow();
  await expect(collect({deep,overrides:{[scheduler]:read(scheduler)+'\n// unknown completion loop'}})).rejects.toThrow();
 }
});
