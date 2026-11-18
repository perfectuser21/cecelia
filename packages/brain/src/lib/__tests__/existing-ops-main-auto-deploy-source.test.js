import {expect,it} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import yaml from 'js-yaml';
import {collectBasicCiSources,collectDeepCiSources} from '../existing-ops-stage-source.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';
const root=fileURLToPath(new URL('../../../../../',import.meta.url)),workflow='.github/workflows/ci.yml';
const previous=readFixedExistingOpsGitFixture('5a70db6350f9372e01f7098d2abd49a05990bf64');
const retired=['scripts/post-merge-deploy.sh','scripts/deploy.sh','scripts/ci/assert-deploy-effect.sh','scripts/ci/__tests__/assert-deploy-effect.test.sh',
 'packages/brain/src/cron/drift-sentinel.js','packages/brain/src/cron/__tests__/drift-sentinel.test.js','packages/brain/src/cron/__tests__/drift-sentinel-state.test.js','tests/regression/drift-sentinel-init/tick-runner-drift-sentinel-wiring.test.js','.github/workflows/deploy.yml','.github/workflows/brain-ci-deploy.yml',
 'packages/brain/deploy/com.cecelia.brain.plist','scripts/brain-docker-up.sh','scripts/brain-docker-down.sh','scripts/brain-docker-smoke.sh','scripts/brain-reload.sh',
 'scripts/deploy-workspace/deploy-hk.sh','scripts/deploy-workspace/docker-compose.hk.yml','scripts/deploy-workspace/nginx.conf','scripts/deploy-workspace/nginx-core.conf',
 'packages/brain/deploy/cecelia-watchdog.sh','packages/brain/src/__tests__/deploy-rollback.test.js','packages/brain/scripts/setup-pm2.sh','packages/brain/ecosystem.config.cjs'];
const controls=[workflow,'scripts/ci/__tests__/basic-workflow.test.mjs','scripts/ci/__tests__/basic-brain-auto-deploy.test.mjs',
 'scripts/ci/__tests__/basic-retired-cd-entrypoints.test.mjs','scripts/ci/__tests__/basic-brain-candidate-host.test.mjs',
 'scripts/ci/gate3-trigger-deploy.sh','scripts/ci/gate3-wait-deploy.sh','scripts/ci/__tests__/gate3-wait-deploy.test.sh',
 'scripts/deploy-local.sh','scripts/brain-build.sh','scripts/lib/brain-candidate-docker.sh','packages/brain/src/__tests__/deploy-root-guard.test.js',
 'scripts/brain-deploy.sh','packages/brain/deploy/install.sh','scripts/setup-autostart.sh','scripts/__tests__/brain-deploy-sha-readonly.test.sh',
 'packages/brain/scripts/cecelia-run.sh','packages/brain/src/scheduler-jobs.js','packages/brain/src/tick-runner.js','packages/brain/src/tick-state.js','scripts/smoke/brain-compose-envfile-authority-smoke.sh',
 'scripts/promote-dashboard.sh','scripts/check-deploy-fingerprint.sh','scripts/__tests__/dashboard-release-bind.test.mjs',
 'scripts/__tests__/dashboard-release-bind-fingerprint.test.mjs','scripts/__tests__/dashboard-release-promote.test.sh','scripts/__tests__/dashboard-release-rollback.test.sh',
 'packages/brain/src/routes/ops.js','packages/brain/src/__tests__/deploy-receipt.test.js','packages/brain/src/__tests__/integration/deploy-rollback-flow.integration.test.js'];
const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(root+p));
const read=p=>readFileSync(root+p,'utf8'),ast=text=>parse(text,{ecmaVersion:'latest',sourceType:'module'});
async function collect({overrides={},missing,deep=false,fixture,selected}={}){
 const source=async p=>{if(p===missing)throw Error('missing reviewed input');return overrides[p]??(fixture?fixture.read(p):read(p));};
 const relations=[],request={read:source,revision:fixture?.revision??'f'.repeat(40),relations,parse:ast,paths:selected??fixture?.paths??paths};
 if(deep)await collectDeepCiSources(request);else await collectBasicCiSources({...request,ci:await source(workflow)});
 return relations;
}
it('main源码通过后的唯一发布入口完整来源可读，原Preview清退完整组仍兼容',async()=>{
 expect(yaml.load(read(workflow)).jobs['brain-deploy'].needs).toEqual(['ci-passed']);
 for(const deep of [false,true])for(const fixture of [undefined,previous]){
  const relations=await collect({deep,fixture});expect(relations).not.toHaveLength(0);
  expect(relations.some(row=>row.kind==='preview_only_fixed_git_ui_selector')).toBe(false);
  if(!deep&&!fixture)for(const target of ['scripts/ci/gate3-trigger-deploy.sh','scripts/ci/gate3-wait-deploy.sh'])expect(relations).toContainEqual(expect.objectContaining({consumer_path:workflow,input_path:target,kind:'reviewed_main_push_deploy_control'}));
 }
});
it.each(retired)('旧发布或漂移触发入口不能恢复而继承本轮来源资格：%s',async target=>{
 expect(paths).not.toContain(target);
 for(const deep of [false,true])await expect(collect({deep,selected:[...paths,target],overrides:{[target]:previous.paths.includes(target)?previous.read(target):'# restored retired deployment workflow'}})).rejects.toThrow('basic_ci_source_unproven');
});
it.each(controls)('本轮发布实际控制成员缺失或篡改必须拒绝：%s',async target=>{
 for(const deep of [false,true]){
  await expect(collect({deep,missing:target})).rejects.toThrow();
  await expect(collect({deep,overrides:{[target]:read(target)+'\n# unknown control'}})).rejects.toThrow();
 }
});
it('本轮与旧组CI、固定SHA、候选Docker及等待控制不能混配',async()=>{
 for(const deep of [false,true])for(const target of [workflow,'scripts/ci/__tests__/basic-workflow.test.mjs','scripts/deploy-local.sh','scripts/brain-build.sh','scripts/lib/brain-candidate-docker.sh','scripts/ci/gate3-wait-deploy.sh']){
  expect(read(target)).not.toBe(previous.read(target));
  await expect(collect({deep,overrides:{[target]:previous.read(target)}})).rejects.toThrow('basic_ci_source_unproven');
  if(target===workflow||target.includes('basic-workflow'))await expect(collect({deep,fixture:previous,overrides:{[target]:read(target)}})).rejects.toThrow('basic_ci_source_unproven');
 }
});
it('发布必须依赖本次源码成功、仅main push并核对精确SHA，禁降级权限及空跑',async()=>{
 for(const mutate of [job=>{job.needs=[];},job=>{job.if="github.event_name == 'push'";},job=>{job['continue-on-error']=true;},
  job=>{job.permissions.contents='write';},job=>{job.env.REQUIRE_EXACT_SHA='0';},job=>{job.env.GITHUB_SHA='main';},
  job=>{job.steps.find(s=>s.uses==='actions/checkout@v4').with.ref='main';},job=>{job.steps.find(s=>s.run?.includes('gate3-wait-deploy.sh')).run='echo PASS';}]){
  const doc=yaml.load(read(workflow));mutate(doc.jobs['brain-deploy']);
  await expect(collect({overrides:{[workflow]:yaml.dump(doc)}})).rejects.toThrow('basic_ci_source_unproven');
 }
});
it('漂移触发器退役后不再留下owner到专属回归的现役关系',()=>{
 const relations=JSON.parse(read('.implementation-source-relations.json')).relations;
 expect(relations.some(row=>row.owner_path==='packages/brain/src/cron/drift-sentinel.js')).toBe(false);
});
