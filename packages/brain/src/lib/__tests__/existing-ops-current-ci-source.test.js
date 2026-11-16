import {it,expect} from 'vitest';
import {parse} from 'acorn';
import {collectBasicCiSources,collectDeepCiSources} from '../existing-ops-stage-source.js';
import {collectWorkspaceInputEdges} from '../existing-ops-workspace-source.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';
const fixed=readFixedExistingOpsGitFixture('d06de84e9f7d2d489a151e0b13b38f81651dd3fa');
const ast=text=>parse(text,{ecmaVersion:'latest',sourceType:'module'});
const collect=async(overrides={})=>{
 const relations=[],read=async path=>overrides[path]??fixed.read(path);
 await collectBasicCiSources({read,ci:await read('.github/workflows/ci.yml'),revision:fixed.revision,relations,parse:ast,paths:fixed.paths});
 await collectDeepCiSources({read,revision:fixed.revision,relations});return relations;
};
it('历史d06完整来源可读且不授予历史执行结果',async()=>{
 const relations=await collect();
 expect(relations).toContainEqual(expect.objectContaining({consumer_path:'scripts/ci/run-basic-check.mjs',input_path:'apps/api/vitest.config.ts',kind:'dashboard_features_unit_config',revision:fixed.revision}));
 expect(relations.some(r=>r.kind==='scheduled_or_manual_full_postgres_entry')).toBe(true);
 expect(relations.every(r=>r.revision===fixed.revision)).toBe(true);
});
for(const path of ['.github/workflows/ci.yml','scripts/ci/run-basic-check.mjs','scripts/ci/basic-scope.mjs','scripts/ci/skill-source-tests.mjs']){
 it(`来源篡改或未知成员不能继承完整入口：${path}`,async()=>{
  const original=fixed.read(path),changed=path.endsWith('.yml')?original.replace('name:','unknown_control:'):original+'\n// unknown source\n';
  await expect(collect({[path]:changed})).rejects.toThrow();
 });
}
it('旧Engine和Quality完整历史cohort不再提供入口资格',async()=>{
 for(const revision of ['69de823cda6d789130898399c3ad770c15b6fb71','227c14e6ff8970f5c408a8dc87e8b9d0f0d16cfe']){
 const old=readFixedExistingOpsGitFixture(revision);
 await expect(collectBasicCiSources({read:async path=>old.read(path),ci:old.read('.github/workflows/ci.yml'),revision:old.revision,relations:[],parse:ast,paths:old.paths})).rejects.toThrow('basic_ci_source_unproven');
 }
});
it('当前workspace来源不向已退役Engine或Quality测试授予自动消费者资格',async()=>{
 const edges=await collectWorkspaceInputEdges({revision:fixed.revision,paths:fixed.paths,readSource:async path=>fixed.read(path),parse:ast});
 expect(edges.some(edge=>/^(?:packages\/engine|packages\/quality)\//.test(edge.dst_path))).toBe(false);
});
it('候选完整控制封组真实读取五项必需任务协议；单成员混配均无来源资格',async()=>{
 const {readFileSync,existsSync}=await import('node:fs');
 const {execFileSync}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const root=fileURLToPath(new URL('../../../../../',import.meta.url));
 const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(new URL(p,'file://'+root)));
 const read=async path=>readFileSync(new URL(path,'file://'+root),'utf8');
 const observe=async overrides=>{const relations=[],source=async path=>overrides[path]??read(path);await collectBasicCiSources({read:source,ci:await source('.github/workflows/ci.yml'),revision:'f'.repeat(40),relations,parse:ast,paths});return relations;};
 const relations=await observe({});
 expect(relations).toContainEqual(expect.objectContaining({consumer_path:'scripts/ci/run-basic-check.mjs',input_path:'apps/api/vitest.config.ts',kind:'dashboard_features_unit_config'}));
 expect(relations.some(r=>r.kind==='reviewed_resource_canary_scope_plan'||r.kind==='strict_resource_plan_decoder'||r.kind==='reviewed_resource_control_node_test')).toBe(false);
 expect(relations.some(r=>r.kind==='registered_skill_ownership_resolver'||r.kind==='reviewed_skill_source_exclusion'||r.kind==='literal_url_workflow_verification_input')).toBe(false);
 for(const path of ['.github/actions/skills-source/action.yml','scripts/skill_source_ownership.py'])await expect(observe({[path]:(await read(path))+'\n# unknown source\n'})).rejects.toThrow('basic_ci_source_unproven');
 for(const member of ['scripts/ci/check-basic-results.mjs','scripts/ci/__tests__/basic-results.test.mjs','scripts/ci/__tests__/basic-workflow.test.mjs']){
  await expect(observe({[member]:''})).rejects.toThrow('basic_ci_source_unproven');
  await expect(observe({[member]:(await read(member))+'\n// unknown scope member\n'})).rejects.toThrow('basic_ci_source_unproven');
 }
 await expect(observe({'scripts/ci/check-basic-results.mjs':fixed.read('scripts/ci/check-basic-results.mjs')})).rejects.toThrow('basic_ci_source_unproven');
 await expect(observe({'scripts/ci/run-basic-check.mjs':fixed.read('scripts/ci/run-basic-check.mjs')})).rejects.toThrow('basic_ci_source_unproven');
 const previous=readFixedExistingOpsGitFixture('4d8bed7c7504f8e3e2d84b283bde735927642f8b');
 for(const path of ['scripts/ci/prepare-ubuntu-archive.mjs','scripts/ci/__tests__/basic-ubuntu-archive.test.mjs'])await expect(observe({[path]:previous.read(path)})).rejects.toThrow('basic_ci_source_unproven');
 await expect(observe({'.github/workflows/ci.yml':(await read('.github/workflows/ci.yml')).replace('name:', 'unknown_control:')})).rejects.toThrow('basic_ci_source_unproven');
 for(const retired of ['scripts/ci/skill-source-tests.mjs','scripts/ci/__tests__/basic-skill-source-coverage.test.mjs','packages/brain/vitest.skill-source.config.mjs','packages/brain/src/__tests__/golden-path-skill-snapshot.skill-source.test.js']){
  await expect(collectBasicCiSources({read,ci:await read('.github/workflows/ci.yml'),revision:'f'.repeat(40),relations:[],parse:ast,paths:[...paths,retired]})).rejects.toThrow('basic_ci_source_unproven');
 }
});

it('d06历史完整封组仍校验W19真实输入；候选不依赖这些退役文件',async()=>{
 for(const target of ['scripts/ci/check-w19-frozen.mjs','scripts/ci/__tests__/basic-w19-freeze.test.mjs','playground/server.js']){
  for(const missing of [false,true]){
   const read=async path=>{if(path===target){if(missing)throw Error('missing historical input');return fixed.read(path)+'\n// drift';}return fixed.read(path);};
   await expect(collectBasicCiSources({read,ci:fixed.read('.github/workflows/ci.yml'),revision:fixed.revision,relations:[],parse:ast,paths:fixed.paths})).rejects.toThrow();
  }
 }
});

it('脚本清退新profile拒绝缺失/篡改/未知成员，完整旧组仍兼容',async()=>{
 const {readFileSync,existsSync}=await import('node:fs'),{execFileSync}=await import('node:child_process'),{fileURLToPath}=await import('node:url');
 const root=fileURLToPath(new URL('../../../../../',import.meta.url));
 const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(new URL(p,'file://'+root)));
 const profile='packages/brain/src/lib/existing-ops-resource-retirement-profile.json',ops='scripts/ci/ops-checks.mjs';
 const read=path=>readFileSync(new URL(path,'file://'+root),'utf8');
 const observe=async(overrides={},missing)=>{const relations=[],source=async path=>{if(path===missing)throw Error('missing profile');return overrides[path]??read(path);};await collectBasicCiSources({read:source,ci:await source('.github/workflows/ci.yml'),revision:'f'.repeat(40),relations,parse:ast,paths});return relations;};
 await expect(observe()).resolves.toEqual(expect.any(Array));
 await expect(observe({},profile)).rejects.toThrow();
 for(const text of [read(profile)+'\n',JSON.stringify({...JSON.parse(read(profile)),unknown:'f'.repeat(64)}),'{}'])await expect(observe({[profile]:text})).rejects.toThrow('basic_ci_source_unproven');
 await expect(observe({[ops]:read(ops)+'\n// unknown operations selector\n'})).rejects.toThrow('basic_ci_source_unproven');
 const oldOps=execFileSync('git',['show','10e5943803aa9338f468df7ac19e647967aca7b5:scripts/ci/ops-checks.mjs'],{cwd:root,encoding:'utf8'});
 await expect(observe({[ops]:oldOps})).rejects.toThrow('basic_ci_source_unproven');
 const old=readFixedExistingOpsGitFixture('91d37b2c3aab471aeaf88df25eec6dda9cb306d3');
 await expect(collectBasicCiSources({read:async path=>old.read(path),ci:old.read('.github/workflows/ci.yml'),revision:old.revision,relations:[],parse:ast,paths:old.paths})).resolves.toEqual(expect.any(Array));
});


it('Workflow发布和注册执行只认可本次完整必需CI步骤，禁用换库或空跑拒绝',async()=>{
 const {readFileSync,existsSync}=await import('node:fs'),{execFileSync}=await import('node:child_process'),{fileURLToPath}=await import('node:url'),{default:yaml}=await import('js-yaml');
 const root=fileURLToPath(new URL('../../../../../',import.meta.url));
 const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(new URL(p,'file://'+root)));
 const read=path=>readFileSync(new URL(path,'file://'+root),'utf8'),workflow='.github/workflows/ci.yml',doc=yaml.load(read(workflow));
 const steps=doc.jobs['runtime-integration'].steps,publisher='foundation-publish.test.mjs',registration='workflow-foundation.pg.integration.test.js';
 const publishStep=steps.filter(step=>step.run?.includes(publisher)),registerStep=steps.filter(step=>step.run?.includes(registration));
 expect(publishStep).toHaveLength(0);expect(registerStep).toHaveLength(1);
 const {default:brain}=await import('../../../vitest.config.js'),{default:fg}=await import('fast-glob');
 expect(fg.sync(brain.test.include,{cwd:root+'packages/brain',ignore:brain.test.exclude})).toContain('scripts/commander-workflow/__tests__/foundation-publish.test.mjs');
 expect(registerStep[0]).toEqual({name:'Verify Workflow registration to Brain and real DBOS execution','working-directory':'packages/brain',env:{DB_NAME:'cecelia_scratch',DB_HOST:'127.0.0.1',DB_PORT:'5432',DB_USER:'onboarding_ci',DB_PASSWORD:'onboarding_ci',TEST_DB_URL:'postgresql://onboarding_ci:onboarding_ci@127.0.0.1:5432/cecelia_scratch'},run:'npx vitest run --config vitest.integration.config.js src/__tests__/integration/workflow-foundation.pg.integration.test.js src/__tests__/integration/foundation-legacy-entrances.pg.integration.test.js --maxWorkers=1 --minWorkers=1',if:'!cancelled()'});
 const observe=async ci=>{const relations=[];await collectBasicCiSources({read:async path=>path===workflow?ci:read(path),ci,revision:'f'.repeat(40),relations,parse:ast,paths});return relations;};
 expect(await observe(read(workflow))).not.toHaveLength(0);
 for(const fragment of [registration])for(const mutate of [step=>{step.if='false';},step=>{step.run='echo not-executed';},step=>{step['working-directory']='scripts';}]){
  const changed=structuredClone(doc);mutate(changed.jobs['runtime-integration'].steps.find(step=>step.run?.includes(fragment)));
  await expect(observe(yaml.dump(changed))).rejects.toThrow('basic_ci_source_unproven');
 }
 for(const fragment of [registration]){
  const changed=structuredClone(doc);changed.jobs['runtime-integration'].steps=changed.jobs['runtime-integration'].steps.filter(step=>!step.run?.includes(fragment));
  await expect(observe(yaml.dump(changed))).rejects.toThrow('basic_ci_source_unproven');
 }
 for(const key of ['DB_NAME','TEST_DB_URL']){
  const changed=structuredClone(doc);changed.jobs['runtime-integration'].steps.find(step=>step.run?.includes(registration)).env[key]=key==='DB_NAME'?'cecelia':'postgresql://ci@127.0.0.1:5432/cecelia';
  await expect(observe(yaml.dump(changed))).rejects.toThrow('basic_ci_source_unproven');
 }
});


it('现役十项PG控制闭包固定读取；缺失、篡改及旧新成员拼接均拒绝',async()=>{
 const {readFileSync,existsSync}=await import('node:fs'),{execFileSync}=await import('node:child_process'),{fileURLToPath}=await import('node:url');
 const root=fileURLToPath(new URL('../../../../../',import.meta.url));
 const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(new URL(p,'file://'+root)));
 const read=path=>readFileSync(new URL(path,'file://'+root),'utf8');
 const profile='packages/brain/src/lib/existing-ops-dormant-boundaries-profile.json';
 const observe=async(overrides={},missing)=>{const relations=[],source=async path=>{if(path===missing)throw Error('missing control');return overrides[path]??read(path);};await collectBasicCiSources({read:source,ci:await source('.github/workflows/ci.yml'),revision:'f'.repeat(40),relations,parse:ast,paths});return relations;};
 const relations=await observe();
 expect(relations).toContainEqual(expect.objectContaining({consumer_path:'packages/brain/src/lib/existing-ops-stage-modes.js',input_path:profile,kind:'reviewed_basic_ci_source_profile'}));
 const pg=relations.filter(row=>row.kind==='reviewed_pr_postgres_test_selector');
 expect(pg).toHaveLength(10);
 expect(pg.map(row=>row.input_path)).toContain('packages/brain/src/__tests__/integration/reasoning-governance-contract.pg.integration.test.js');
 const controls=[profile,'scripts/ci/preview-ui.mjs','scripts/ci/__tests__/basic-fixed-core.test.mjs','scripts/ci/__tests__/basic-preview-ui.test.mjs','scripts/ci/run-basic-check.mjs','scripts/ci/ops-checks.mjs','scripts/ci/deep-integration.config.mjs','scripts/ci/debt-pg.config.mjs','scripts/ci/debt-pg-tests.json','scripts/ci/__tests__/basic-current-pg-gate.test.mjs','tests/brain-ci-pg-layering.test.ts'];
 for(const member of controls){
  await expect(observe({},member)).rejects.toThrow();
  for(const text of ['',read(member)+'\n/* unknown control */'])await expect(observe({[member]:text})).rejects.toThrow('basic_ci_source_unproven');
 }
 await expect(observe({[profile]:JSON.stringify({...JSON.parse(read(profile)),unknown:'f'.repeat(64)})})).rejects.toThrow('basic_ci_source_unproven');
 const before=readFixedExistingOpsGitFixture('91d37b2c3aab471aeaf88df25eec6dda9cb306d3');
 for(const member of ['scripts/ci/run-basic-check.mjs']){
  expect(before.read(member)).not.toBe(read(member));
  await expect(observe({[member]:before.read(member)})).rejects.toThrow('basic_ci_source_unproven');
  await expect(collectBasicCiSources({read:async path=>path===member?read(member):before.read(path),ci:before.read('.github/workflows/ci.yml'),revision:before.revision,relations:[],parse:ast,paths:before.paths})).rejects.toThrow();
 }
 const olderOps=execFileSync('git',['show','10e5943803aa9338f468df7ac19e647967aca7b5:scripts/ci/ops-checks.mjs'],{cwd:root,encoding:'utf8'});
 await expect(observe({'scripts/ci/ops-checks.mjs':olderOps})).rejects.toThrow('basic_ci_source_unproven');
 const oldMain=readFixedExistingOpsGitFixture('6df58b83c8a0814fd16ff5b3d61f8acad33ef480');
 await expect(collectBasicCiSources({read:async path=>oldMain.read(path),ci:oldMain.read('.github/workflows/ci.yml'),revision:oldMain.revision,relations:[],parse:ast,paths:oldMain.paths})).resolves.toEqual(expect.any(Array));
 await expect(observe({'.github/workflows/ci.yml':oldMain.read('.github/workflows/ci.yml')})).rejects.toThrow('basic_ci_source_unproven');
 await expect(collectBasicCiSources({read,ci:read('.github/workflows/ci.yml'),revision:'f'.repeat(40),relations:[],parse:ast,paths:[...paths,'scripts/ci/basic-scope.mjs']})).rejects.toThrow('basic_ci_source_unproven');
 for(const row of pg)await expect(observe({},row.input_path)).rejects.toThrow();
});

it('Foundation手动发布新封组完整固定，旧封组兼容且发布命令篡改不能继承入口',async()=>{
 const {readFileSync,existsSync}=await import('node:fs'),{execFileSync}=await import('node:child_process'),{fileURLToPath}=await import('node:url'),{default:yaml}=await import('js-yaml');
 const root=fileURLToPath(new URL('../../../../../',import.meta.url)),workflow='.github/workflows/ci.yml';
 const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(new URL(p,'file://'+root)));
 const read=path=>readFileSync(new URL(path,'file://'+root),'utf8');
 const observe=async(overrides={},missing)=>{const source=async path=>{if(path===missing)throw Error('missing publication control');return overrides[path]??read(path);};return collectBasicCiSources({read:source,ci:await source(workflow),revision:'f'.repeat(40),relations:[],parse:ast,paths});};
 await expect(observe()).resolves.toEqual(expect.any(Array));
 for(const member of ['packages/brain/src/lib/existing-ops-foundation-release-profile.json','scripts/ci/__tests__/basic-workflow.test.mjs','scripts/ci/foundation-release-snapshot.mjs','scripts/ci/__tests__/basic-foundation-release-readiness.test.mjs','scripts/ci/pilot-release-verification.mjs']){
  await expect(observe({},member)).rejects.toThrow();
  await expect(observe({[member]:read(member)+'\n// unreviewed publication control\n'})).rejects.toThrow('basic_ci_source_unproven');
 }
 for(const mutate of [job=>{job.if='true';},job=>{job.needs=[];},job=>{job.steps.find(s=>s.run?.includes('pilot-release-verification.mjs')).run='echo PASS';}]){
  const doc=yaml.load(read(workflow));mutate(doc.jobs['foundation-release-verification']);await expect(observe({[workflow]:yaml.dump(doc)})).rejects.toThrow('basic_ci_source_unproven');
 }
 const before=readFixedExistingOpsGitFixture('6df58b83c8a0814fd16ff5b3d61f8acad33ef480');
 await expect(collectBasicCiSources({read:async path=>before.read(path),ci:before.read(workflow),revision:before.revision,relations:[],parse:ast,paths:before.paths})).resolves.toEqual(expect.any(Array));
 await expect(observe({'scripts/ci/__tests__/basic-workflow.test.mjs':before.read('scripts/ci/__tests__/basic-workflow.test.mjs')})).rejects.toThrow('basic_ci_source_unproven');
 for(const revision of ['a96a0abafd','7682eea73b8b898bbf9a9c802b963d8cdca4f04d']){
  const full=execFileSync('git',['rev-parse',revision+'^{commit}'],{cwd:root,encoding:'utf8'}).trim(),historical=readFixedExistingOpsGitFixture(full);
  await expect(collectBasicCiSources({read:async path=>historical.read(path),ci:historical.read(workflow),revision:full,relations:[],parse:ast,paths:historical.paths})).resolves.toEqual(expect.any(Array));
  await expect(observe({[workflow]:historical.read(workflow),'scripts/ci/__tests__/basic-workflow.test.mjs':historical.read('scripts/ci/__tests__/basic-workflow.test.mjs')})).rejects.toThrow('basic_ci_source_unproven');
 }

});

it('固定核心CI只证明实际11矩阵与Scripts版本门，不再生成Plan消费边',async()=>{
 const {readFileSync,existsSync}=await import('node:fs'),{execFileSync}=await import('node:child_process'),{fileURLToPath}=await import('node:url');
 const root=fileURLToPath(new URL('../../../../../',import.meta.url));
 const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(new URL(p,'file://'+root)));
 const read=async path=>readFileSync(new URL(path,'file://'+root),'utf8'),relations=[];
 await collectBasicCiSources({read,ci:await read('.github/workflows/ci.yml'),revision:'f'.repeat(40),relations,parse:ast,paths});
 expect(relations.some(r=>r.input_path==='scripts/ci/basic-scope.mjs'||r.kind==='required_basic_ci_plan')).toBe(false);
 expect(relations).toContainEqual(expect.objectContaining({consumer_path:'.github/workflows/ci.yml',input_path:'scripts/ci/check-brain-version-bump.sh',kind:'required_scripts_lane_brain_version_increment_guard'}));
 expect(relations).toContainEqual(expect.objectContaining({consumer_path:'.github/workflows/ci.yml',input_path:'scripts/ci/preview-ui.mjs',kind:'preview_only_fixed_git_ui_selector'}));
 expect(relations.filter(r=>r.kind==='reviewed_pr_postgres_test_selector')).toHaveLength(10);
});


async function currentSourceInputs(){
 const {readFileSync,existsSync}=await import('node:fs'),{execFileSync}=await import('node:child_process'),{fileURLToPath}=await import('node:url');
 const root=fileURLToPath(new URL('../../../../../',import.meta.url));
 const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(new URL(p,'file://'+root)));
 return {paths,revision:'f'.repeat(40),read:async path=>readFileSync(new URL(path,'file://'+root),'utf8')};
}
it('当前Deep真实字节必须独立证明，不能用d06历史绿替代',async()=>{
 const inputs=await currentSourceInputs(),relations=[];
 await collectDeepCiSources({...inputs,relations,parse:ast});
 expect(relations).toContainEqual(expect.objectContaining({consumer_path:'.github/workflows/nightly-regression.yml',input_path:'scripts/ci/deep-integration.config.mjs',kind:'scheduled_or_manual_full_postgres_entry'}));
});
it('当前聚合真实读源：退休F2及未审现役F3失败关闭，不借历史绿恢复资格',async()=>{
 const {buildExistingOpsSources}=await import('../existing-ops-source.js'),inputs=await currentSourceInputs();
 const proof=await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',paths:inputs.paths,revision:inputs.revision,readSource:inputs.read});
 const [f2,f3]=proof.consumers;
 expect(f2.status).toBe('unknown');expect(f2.bindings).toEqual([]);expect(f2.input_relations).toEqual([]);
 expect(f2.gaps).toContainEqual(expect.objectContaining({code:'deployment_entry_unproven'}));
 expect(f3.status).toBe('unknown');expect(f3.bindings).toEqual([]);expect(f3.input_relations).toEqual([]);
 expect(f3.gaps).toEqual(['native_build_execution_unproven','native_publish_execution_unproven','native_stage_execution_unproven'].map(code=>({code})));
 const relations=[];await collectBasicCiSources({...inputs,ci:await inputs.read('.github/workflows/ci.yml'),relations,parse:ast});await collectDeepCiSources({...inputs,relations});
 expect(relations).toContainEqual(expect.objectContaining({input_path:'packages/brain/src/lib/existing-ops-dormant-boundaries-profile.json',kind:'reviewed_basic_ci_source_profile'}));
 expect(relations).toContainEqual(expect.objectContaining({input_path:'packages/brain/src/lib/existing-ops-dormant-boundaries-profile.json',kind:'reviewed_deep_ci_source_profile'}));
 expect(f3.input_relations.some(r=>r.consumer_path==='.github/workflows/implementation-impact.yml'||r.kind==='trusted_main_snapshot_node_entry')).toBe(false);
 expect(proof.workflows.every(w=>w.executable===false)).toBe(true);
});

it('当前Deep完整组缺失、篡改、旧Nightly或旧单成员拼接均拒绝',async()=>{
 const inputs=await currentSourceInputs(),profile='packages/brain/src/lib/existing-ops-dormant-boundaries-profile.json';
 for(const member of [profile,'.github/workflows/nightly-regression.yml','scripts/ci/deep-integration.config.mjs','scripts/ci/debt-pg.config.mjs','scripts/ci/debt-pg-tests.json','packages/brain/vitest.config.js']){
  for(const missing of [false,true])await expect(collectDeepCiSources({...inputs,relations:[],read:async path=>{if(path===member){if(missing)throw Error('missing');return (await inputs.read(path))+'\n';}return inputs.read(path);}})).rejects.toThrow();
 }
 await expect(collectDeepCiSources({...inputs,paths:inputs.paths.filter(p=>p!==profile),relations:[]})).rejects.toThrow();
 await expect(collectDeepCiSources({...inputs,relations:[],read:async path=>path==='.github/workflows/nightly-regression.yml'?fixed.read(path):inputs.read(path)})).rejects.toThrow();
});

it('本轮休眠清退仅接受新完整控制组，缺失、篡改和历史单成员混配均拒绝',async()=>{
 const inputs=await currentSourceInputs(),profile='packages/brain/src/lib/existing-ops-dormant-boundaries-profile.json';
 const source=JSON.parse(await inputs.read(profile));
 expect(source['packages/brain/src/lib/existing-ops-closeout-profile.json']).toBe('7ccb681d2e3aa696bee74e109e028fb55b42b6ac29419d20d7e82fb908297c19');
 expect(source['scripts/ci/__tests__/basic-brain-debt-restored-selection.test.mjs']).toMatch(/^[a-f0-9]{64}$/);
 const observe=async({read=inputs.read,paths=inputs.paths}={})=>{
  const relations=[];await collectBasicCiSources({...inputs,read,paths,ci:await read('.github/workflows/ci.yml'),relations,parse:ast});
  await collectDeepCiSources({...inputs,read,paths,relations});return relations;
 };
 const relations=await observe();
 for(const kind of ['reviewed_basic_ci_source_profile','reviewed_deep_ci_source_profile'])expect(relations).toContainEqual(expect.objectContaining({input_path:profile,kind}));
 for(const member of [profile,'packages/brain/vitest.config.js','scripts/ci/__tests__/basic-brain-debt-restored-selection.test.mjs']){
  for(const missing of [false,true])await expect(observe({read:async path=>{if(path===member){if(missing)throw Error('missing member');return (await inputs.read(path))+'\n';}return inputs.read(path);}})).rejects.toThrow();
 }
 await expect(observe({paths:inputs.paths.filter(p=>p!==profile)})).rejects.toThrow();
 const {execFileSync}=await import('node:child_process'),{fileURLToPath}=await import('node:url');
 const root=fileURLToPath(new URL('../../../../../',import.meta.url));
 const previous=readFixedExistingOpsGitFixture('3e827180e50e5c73e999ca744a2689488f75814b');
 await expect(observe({read:async path=>previous.read(path),paths:previous.paths})).resolves.toEqual(expect.any(Array));
 const oldConfig=execFileSync('git',['show','3e827180e50e5c73e999ca744a2689488f75814b:packages/brain/vitest.config.js'],{cwd:root,encoding:'utf8'});
 await expect(observe({read:async path=>path==='packages/brain/vitest.config.js'?oldConfig:inputs.read(path)})).rejects.toThrow();
});

it('人工验收十项退出真实默认及Deep选择，迁移和公共正常验收继续登记',async()=>{
 const {default:brain,POSTGRES_INTEGRATION_TESTS:pg}=await import('../../../vitest.config.js');
 const {default:deep}=await import('../../../../../scripts/ci/deep-integration.config.mjs');
 const {default:glob}=await import('fast-glob'),{fileURLToPath}=await import('node:url');
 const cwd=fileURLToPath(new URL('../../../',import.meta.url));
 const retired=['acceptance','acceptance-state-machine','acceptance-run-scope','acceptance-ai-results','acceptance-scenario-gate','acceptance-aging-expire','acceptance-lifecycle','acceptance-review-closure','acceptance-create-gate','acceptance-version-freeze'].map(n=>`src/__tests__/integration/${n}.integration.test.js`);
 const selected=config=>glob.sync(config.test.include,{cwd,ignore:config.test.exclude});
 for(const file of retired){expect(pg).not.toContain(file);expect(selected(brain)).not.toContain(file);expect(selected(deep)).not.toContain(file);}
 for(const file of ['src/__tests__/integration/migration-392-acceptance-two-column.integration.test.js','src/__tests__/integration/migration-393-gp-harness-glue.integration.test.js','src/__tests__/integration/golden-path-contract.integration.test.js'])expect(pg).toContain(file);
});
