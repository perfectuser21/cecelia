import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as gate from '../../../../../scripts/ci/implementation-gate.mjs';
import { runImplementationPrGate } from '../../../../../scripts/ci/implementation-pr-gate.mjs';
import { assertImplementationReport } from '../../../src/lib/implementation-report.js';
import { applyAutoVersion } from '../../auto-version-apply.mjs';

const roots=[];
it('独立Node入口在Brain-only安装下仍真实记录无效输入，不提前加载scratch图扫描依赖',()=>{
 const f=fixture();const outputDir=join(f.root,'node-cli-gap');
 const moduleUrl=new URL('../../../../../scripts/ci/implementation-pr-gate.mjs',import.meta.url).href;
 const options={repoRoot:f.root,scope:'scope',base:f.source.base_revision,head:f.source.head_revision,mode:'invalid',outputDir};
 const code=`const {runImplementationPrGate}=await import(${JSON.stringify(moduleUrl)});try{await runImplementationPrGate(${JSON.stringify(options)});process.exitCode=2;}catch(error){if(error.code!=='IMPLEMENTATION_CI_INPUT_INVALID')throw error;}`;
 execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:f.root,encoding:'utf8'});
 expect(JSON.parse(readFileSync(join(outputDir,'gap.json'),'utf8'))).toMatchObject({status:'unknown',code:'IMPLEMENTATION_CI_INPUT_INVALID'});
});
function versionFixture(relations) {
 const f=fixture([]);
 mkdirSync(join(f.root,'packages/brain'),{recursive:true});
 writeFileSync(join(f.root,'packages/brain/package.json'),'{"version":"1.2.3"}');
 writeFileSync(join(f.root,'packages/brain/package-lock.json'),'{"version":"1.2.3","packages":{"":{"version":"1.2.3"}}}');
 writeFileSync(join(f.root,'package-lock.json'),'{"packages":{"packages/brain":{"version":"1.2.3"}}}');
 writeFileSync(join(f.root,'DEFINITION.md'),'**Brain 版本**: 1.2.3\n\n## Brain 1.2.3 — old\n');
 const text='{"schema_version":1,"repo":"example/repo","relations": [\n  '+relations.join(',\n  ')+'\n]}\n';
 writeFileSync(join(f.root,'.implementation-source-relations.json'),text);
 return {...f,text};
}
const releaseRow='{ "owner_path" : "src/controller.js", "path" : "changes/controller.md", "role" : "release" }';
const docRow='{ "path" : "docs/controller.md", "role" : "documentation", "owner_path" : "src/controller.js" }';
const verifyRow='{"owner_path":"src/controller.js", "role":"verification", "path":"scripts/smoke/controller.sh"}';
it.each([[releaseRow,docRow,verifyRow],[docRow,releaseRow,verifyRow],[docRow,verifyRow,releaseRow],[releaseRow]])('真实版本机器人只消费实际删除片的release关系，保留其他关系原始字节 %j',(...rows)=>{
 const f=versionFixture(rows);
 const result=applyAutoVersion(f.root);
 expect(result).toMatchObject({newVersion:'1.2.4',fragmentsConsumed:1});
 expect(existsSync(join(f.root,'changes/controller.md'))).toBe(false);
 const text=readFileSync(join(f.root,'.implementation-source-relations.json'),'utf8');
 expect(JSON.parse(text).relations).toEqual(rows.filter(row=>row!==releaseRow).map(row=>JSON.parse(row)));
 for(const row of rows.filter(row=>row!==releaseRow))expect(text).toContain(row);
 expect(JSON.parse(readFileSync(join(f.root,'package-lock.json'))).packages['packages/brain'].version).toBe('1.2.4');
 f.git('add','.');f.git('commit','-qm','actual bot consumption');f.source.head_revision=f.git('rev-parse','HEAD');
 expect(()=>gate.collectAuxiliarySourceEvidence(f.root,f.source)).not.toThrow();
});
it('不消费未实际删除的release路径，也不清理同路径其他角色；严格来源缺失仍拒绝',()=>{
 const otherRelease=releaseRow.replace('controller.md','unconsumed.md');
 const samePathDoc=releaseRow.replace('release','documentation');
 for(const row of [otherRelease,samePathDoc]){
  const f=versionFixture([row]);applyAutoVersion(f.root);
  expect(readFileSync(join(f.root,'.implementation-source-relations.json'),'utf8')).toBe(f.text);
  f.git('add','.');f.git('commit','-qm','missing remains');f.source.head_revision=f.git('rev-parse','HEAD');
  expect(()=>gate.collectAuxiliarySourceEvidence(f.root,f.source)).toThrow('AUXILIARY_SOURCE_MISSING');
 }
});
it('非法声明在版本机器人写入或删除实际片之前拒绝',()=>{
 const f=versionFixture([releaseRow]);
 writeFileSync(join(f.root,'.implementation-source-relations.json'),'{invalid');
 expect(()=>applyAutoVersion(f.root)).toThrow();
 expect(existsSync(join(f.root,'changes/controller.md'))).toBe(true);
 expect(JSON.parse(readFileSync(join(f.root,'packages/brain/package.json'))).version).toBe('1.2.3');
});
it('真实机器人消费多个连续release行，保留分隔的文档与验证行字节',()=>{
 const second=releaseRow.replace('controller.md','second.md');
 const third=releaseRow.replace('controller.md','third.md');
 const f=versionFixture([releaseRow,second,docRow,third,verifyRow]);
 for(const file of ['second','third'])writeFileSync(join(f.root,`changes/${file}.md`),'## Brain {VERSION} — extra\n');
 expect(applyAutoVersion(f.root)).toMatchObject({fragmentsConsumed:3,newVersion:'1.2.6'});
 const text=readFileSync(join(f.root,'.implementation-source-relations.json'),'utf8');
 expect(JSON.parse(text).relations).toEqual([JSON.parse(docRow),JSON.parse(verifyRow)]);
 expect(text).toContain(docRow);expect(text).toContain(verifyRow);
});
it('版本机器人不跟随来源声明软链接，也拒绝重复JSON键而不删片',()=>{
 for(const invalid of ['symlink','broken-symlink','duplicate-key']){
  const f=versionFixture([releaseRow]);const manifest=join(f.root,'.implementation-source-relations.json');
  if(invalid.endsWith('symlink')){
   rmSync(manifest);symlinkSync(join(f.root,invalid==='symlink'?'docs/controller.md':'missing.json'),manifest);
  }else writeFileSync(manifest,f.text.replace('"schema_version":1','"schema_version":1,"schema_version":1'));
  expect(()=>applyAutoVersion(f.root)).toThrow();
  expect(existsSync(join(f.root,'changes/controller.md'))).toBe(true);
  expect(JSON.parse(readFileSync(join(f.root,'packages/brain/package.json'))).version).toBe('1.2.3');
 }
});
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(relations=[{owner_path:'src/controller.js',path:'docs/controller.md',role:'documentation'}]) {
 const root=mkdtempSync(join(tmpdir(),'auxiliary-source-'));roots.push(root);
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 git('init','-q');git('config','user.email','ci@example.invalid');git('config','user.name','ci');git('remote','add','origin','https://github.com/example/repo.git');
 mkdirSync(join(root,'src'));mkdirSync(join(root,'docs'));mkdirSync(join(root,'scripts/smoke'),{recursive:true});
 mkdirSync(join(root,'changes'));
 writeFileSync(join(root,'src/controller.js'),'export const value=1;\n');
 writeFileSync(join(root,'docs/controller.md'),'controller documentation\n');
 writeFileSync(join(root,'scripts/smoke/controller.sh'),'#!/bin/bash\nset -e\nprintf auxiliary-checked > actual-output\n');
 writeFileSync(join(root,'changes/controller.md'),'## Brain {VERSION} — controller\n');
 git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
 writeFileSync(join(root,'.implementation-source-relations.json'),JSON.stringify({schema_version:1,repo:'example/repo',relations}));
 writeFileSync(join(root,'docs/controller.md'),'updated controller documentation\n');
 git('add','.');git('commit','-qm','head');const head=git('rev-parse','HEAD');
 const side=revision=>({revision,graph_snapshot:{repo:'example/repo',source_revision:revision,digest:'a'.repeat(64)},projection:{projection_run_id:'11111111-1111-4111-8111-111111111111',manifest_version_id:'22222222-2222-4222-8222-222222222222',manifest_digest:'b'.repeat(64),projection_digest:'c'.repeat(64)},definition_versions:{workflows:[{id:'33333333-3333-4333-8333-333333333333',payload_sha256:'d'.repeat(64)}],activities:[{id:'44444444-4444-4444-8444-444444444444',payload_sha256:'e'.repeat(64)}]},gaps:[],traversal:{truncated:false}});
 const source={repo:'example/repo',base_revision:base,head_revision:head,changed_files:[{path:'.implementation-source-relations.json'},{path:'docs/controller.md'}]};
 const report={source,base:side(base),head:side(head),mapping_status:'unknown',gaps:source.changed_files.map(p=>({code:'changed_file_unclaimed',...p})),unclaimed_paths:source.changed_files,affected_usages:[{workflow_id:'workflow',reference_id:'usage',activity_id:'activity',evidence:[{capability_id:'capability',activity_id:'activity',side:'head',implementation:{path:'src/controller.js'}}]}],required_assertions:[{assertion_ref:'scripts/smoke/controller.sh',source_repo:'example/repo',source_bindings:[{capability_id:'capability',activity_id:'activity'}]}]};
 for(const key of ['base','head'])report[key].file_coverage=source.changed_files.map((p,i)=>({change_index:i,path:p.path,matched_paths:[],truncated:false}));
 const ownerCoverage={base:[],head:[{path:'src/controller.js',matched_paths:['src/controller.js'],truncated:false}]};
 return {root,git,source,report,ownerCoverage};
}
it('真实固定Git文档来源可验证已认领代码的辅助覆盖，不增加运行时import或业务归属',()=>{
 const f=fixture();
 expect(runImplementationPrGate).toBeTypeOf('function');
 expect(gate.collectAuxiliarySourceEvidence).toBeTypeOf('function');
 const evidence=gate.collectAuxiliarySourceEvidence(f.root,f.source);
 expect(evidence.head.relations[0]).toMatchObject({owner_path:'src/controller.js',path:'docs/controller.md',role:'documentation'});
 expect(evidence.head.source_revision).toBe(f.source.head_revision);
 gate.applyAuxiliarySourceEvidence(f.report,evidence,f.ownerCoverage);
 expect(()=>assertImplementationReport(f.report)).not.toThrow();
 expect(f.report.head.file_coverage[1].native_matched_paths).toEqual([]);
 expect(f.report.head.file_coverage[1].coverage_kind).toBe('auxiliary_source');
 expect(f.report.affected_usages[0].activity_id).toBe('activity');
});
it('缺声明和未认领父模块保持UNKNOWN',()=>{
 const f=fixture();expect(gate.collectAuxiliarySourceEvidence).toBeTypeOf('function');
 const evidence=gate.collectAuxiliarySourceEvidence(f.root,f.source);
 gate.applyAuxiliarySourceEvidence(f.report,evidence,{base:[],head:[]});
 expect(f.report.mapping_status).toBe('unknown');expect(()=>assertImplementationReport(f.report)).toThrow();
 const missing=fixture([]);const e=gate.collectAuxiliarySourceEvidence(missing.root,missing.source);
 gate.applyAuxiliarySourceEvidence(missing.report,e,missing.ownerCoverage);
 expect(missing.report.mapping_status).toBe('unknown');
});
it.each([
 ['路径越界',[{owner_path:'src/controller.js',path:'../escape.md',role:'documentation'}]],
 ['非法角色',[{owner_path:'src/controller.js',path:'docs/controller.md',role:'runtime'}]],
 ['生产代码伪装文档',[{owner_path:'src/controller.js',path:'src/controller.js',role:'documentation'}]],
 ['缺失文件',[{owner_path:'src/controller.js',path:'docs/missing.md',role:'documentation'}]],
 ['重复冲突',[{owner_path:'src/controller.js',path:'docs/controller.md',role:'documentation'},{owner_path:'src/controller.js',path:'docs/controller.md',role:'release'}]],
])('%s不能进入固定来源证据',(_label,relations)=>{
 const f=fixture(relations);expect(gate.collectAuxiliarySourceEvidence).toBeTypeOf('function');
 expect(()=>gate.collectAuxiliarySourceEvidence(f.root,f.source)).toThrow();
});
it('跨repo声明拒绝，固定证据错digest、错revision与反向关系拒绝',()=>{
 const f=fixture();expect(gate.collectAuxiliarySourceEvidence).toBeTypeOf('function');
 const evidence=gate.collectAuxiliarySourceEvidence(f.root,f.source);
 gate.applyAuxiliarySourceEvidence(f.report,evidence,f.ownerCoverage);
 for(const mutate of [r=>{r.auxiliary_source_evidence.head.relations[0].sha256='0'.repeat(64);},r=>{r.auxiliary_source_evidence.head.source_revision=r.source.base_revision;},r=>{r.auxiliary_source_evidence.head.relations[0].owner_path='docs/controller.md';}]){
  const copy=structuredClone(f.report);mutate(copy);expect(()=>gate.assertAuxiliarySourceEvidence(copy)).toThrow();
 }
 writeFileSync(join(f.root,'.implementation-source-relations.json'),JSON.stringify({schema_version:1,repo:'other/repo',relations:[]}));
 f.git('add','.');f.git('commit','-qm','cross repo');f.source.head_revision=f.git('rev-parse','HEAD');
 expect(()=>gate.collectAuxiliarySourceEvidence(f.root,f.source)).toThrow();
});
it('执行门禁从同固定SHA重算证据，拒绝报告伪造的辅助字节',async()=>{
 const f=fixture();expect(gate.collectAuxiliarySourceEvidence).toBeTypeOf('function');
 const evidence=gate.collectAuxiliarySourceEvidence(f.root,f.source);
 gate.applyAuxiliarySourceEvidence(f.report,evidence,f.ownerCoverage);
 const receipt=await gate.runImplementationGate({repoRoot:f.root,report:f.report});expect(receipt.verdict).toBe('PASS');
 expect(readFileSync(join(f.root,'actual-output'),'utf8')).toBe('auxiliary-checked');
 f.report.auxiliary_source_evidence.head.relations[0].sha256='f'.repeat(64);
 await expect(gate.runImplementationGate({repoRoot:f.root,report:f.report})).rejects.toThrow();
});
it.each([['verification','scripts/smoke/controller.sh'],['release','changes/controller.md']])('合法%s关系固定实际源字节，不成为生产代码',(_role,path)=>{
 const f=fixture([{owner_path:'src/controller.js',path,role:_role}]);
 const evidence=gate.collectAuxiliarySourceEvidence(f.root,f.source);
 expect(evidence.head.relations[0]).toMatchObject({owner_path:'src/controller.js',path,role:_role});
 expect(evidence.head.relations[0].sha256).toMatch(/^[a-f0-9]{64}$/);
});
it('辅助覆盖不能吞其他UNKNOWN或截断；删固定证据不能只靠matched_paths放行',()=>{
 const f=fixture();const evidence=gate.collectAuxiliarySourceEvidence(f.root,f.source);
 f.report.gaps.push({code:'scope_manifest_missing',side:'head'});
 gate.applyAuxiliarySourceEvidence(f.report,evidence,f.ownerCoverage);
 expect(f.report.gaps).toEqual([{code:'scope_manifest_missing',side:'head'}]);
 expect(f.report.mapping_status).toBe('unknown');expect(()=>assertImplementationReport(f.report)).toThrow();
 const copy=structuredClone(f.report);delete copy.auxiliary_source_evidence;
 expect(()=>gate.assertAuxiliarySourceEvidence(copy)).toThrow(/MISSING/);
 const trunc=fixture();trunc.ownerCoverage.head[0].truncated=true;
 expect(()=>gate.applyAuxiliarySourceEvidence(trunc.report,gate.collectAuxiliarySourceEvidence(trunc.root,trunc.source),trunc.ownerCoverage)).toThrow();
});
it('Git软链接和父子反向配置不可声明为已核字节',()=>{
 const f=fixture();rmSync(join(f.root,'docs/controller.md'));symlinkSync('../src/controller.js',join(f.root,'docs/controller.md'));
 f.git('add','.');f.git('commit','-qm','symlink');f.source.head_revision=f.git('rev-parse','HEAD');
 expect(()=>gate.collectAuxiliarySourceEvidence(f.root,f.source)).toThrow(/REGULAR_FILE/);
 const reverse=fixture([{owner_path:'docs/controller.md',path:'src/controller.js',role:'documentation'}]);
 expect(()=>gate.collectAuxiliarySourceEvidence(reverse.root,reverse.source)).toThrow(/OWNER/);
});
it('真实PR入口拒绝错误固定上下文并留下UNKNOWN案卷，不接数据库',async()=>{
 const f=fixture(),outputDir=join(f.root,'evidence');
 await expect(runImplementationPrGate({repoRoot:f.root,scope:'phones',base:f.source.base_revision,head:f.source.head_revision,mode:'invalid',outputDir})).rejects.toThrow(/INPUT_INVALID/);
 expect(JSON.parse(readFileSync(join(outputDir,'gap.json'),'utf8'))).toMatchObject({status:'unknown',code:'IMPLEMENTATION_CI_INPUT_INVALID'});
});

const nightlyReader='.github/workflows/scripts/__tests__/nightly-runtime.test.mjs';
const nightlyCi='.github/workflows/ci.yml';
const nightlyYaml='.github/workflows/nightly-regression.yml';
const workspaceRepo='perfectuser21/zenithjoy-workspace';
const workspaceCi='.github/workflows/implementation-impact.yml';
const workspaceInputs=[workspaceCi,'.github/workflows/pilot-release-verification.yml'];
function workspaceConfigFixture(target=workspaceCi){
 const f=fixture([]);f.git('remote','set-url','origin',`https://github.com/${workspaceRepo}.git`);
 const readerPath=target===workspaceCi?'scripts/ci/__tests__/implementation-impact-workflow.test.mjs':'scripts/ci/__tests__/pilot-release-workflow.test.mjs';
 mkdirSync(join(f.root,'scripts/ci/__tests__'),{recursive:true});mkdirSync(join(f.root,'.github/workflows'),{recursive:true});
 const reader=`import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import YAML from 'yaml';
const file=new URL('../../../${target}',import.meta.url);
function config(){assert.ok(existsSync(file),'exists');return YAML.parse(readFileSync(file,'utf8'));}
test('actual config',()=>{assert.ok(config().jobs);});
`;
 const ci=`on: {pull_request: {branches: [main]}, push: {branches: [main]}}
jobs:
  caller-contract:
    steps:
      - run: node --test scripts/ci/__tests__/implementation-impact-workflow.test.mjs
      - run: node --test scripts/ci/__tests__/pilot-release-workflow.test.mjs
  impact:
    needs: caller-contract
    uses: perfectuser21/cecelia/.github/workflows/implementation-impact.yml@${'a'.repeat(40)}
`;
 const pilot=`on: {push: {branches: [main]}, workflow_dispatch: {}}
jobs:
  caller-contract:
    steps:
      - run: node --test scripts/ci/__tests__/pilot-release-workflow.test.mjs
  verify:
    if: github.ref == 'refs/heads/main'
    needs: caller-contract
    uses: perfectuser21/cecelia/.github/workflows/pilot-release-verification.yml@${'a'.repeat(40)}
`;
 writeFileSync(join(f.root,readerPath),reader);writeFileSync(join(f.root,workspaceCi),ci);writeFileSync(join(f.root,workspaceInputs[1]),pilot);
 writeFileSync(join(f.root,'.implementation-source-relations.json'),JSON.stringify({schema_version:1,repo:workspaceRepo,relations:[]}));
 f.git('add','.');f.git('commit','-qm','fixed workspace source');f.source.base_revision=f.git('rev-parse','HEAD');
 const config={owner_path:readerPath,path:target,role:'verification_config',consumer_path:readerPath,ci_path:workspaceCi};
 writeFileSync(join(f.root,'.implementation-source-relations.json'),JSON.stringify({schema_version:1,repo:workspaceRepo,relations:[config]}));
 f.git('add','.');f.git('commit','-qm','candidate workspace relation');f.source.repo=workspaceRepo;f.source.head_revision=f.git('rev-parse','HEAD');f.source.changed_files=[{path:'.implementation-source-relations.json'},{path:target}];
 return {...f,reader,readerPath,ci,config};
}
it.each(workspaceInputs)('Workspace 精确 reader 的实际函数读取及永久caller-contract生成固定来源证据：%s',target=>{
 const f=workspaceConfigFixture(target),e=gate.collectAuxiliarySourceEvidence(f.root,f.source);
 expect(e.head.relations[0]).toMatchObject({owner_path:f.readerPath,consumer_sha256:expect.stringMatching(/^[a-f0-9]{64}$/),ci_sha256:expect.stringMatching(/^[a-f0-9]{64}$/),consumer_evidence:{read_kind:'YAML.parse/readFileSync',ci_job:'caller-contract',aggregate_job:'impact'}});
});
it.each([
 s=>s.replace("config().jobs","({jobs:true}).jobs"),
 s=>s.replace("return YAML.parse","return {}; return YAML.parse"),
 s=>s.replace("()=>{assert.ok(config().jobs);}","()=>{if(false)assert.ok(config().jobs);}"),
 s=>s.replace("()=>{assert.ok(config().jobs);}","()=>{return; assert.ok(config().jobs);}"),
 s=>s.replace("test('actual config'","test.skip('actual config'"),
 s=>s.replace("test('actual config'","config=()=>({jobs:true});test('actual config'"),
 s=>s.replace("function config()","function config(YAML)"),
 s=>s.replace("const file=new URL", "const URL=()=>({}); const file=new URL"),
 s=>s.replace("return YAML.parse(readFileSync(file,'utf8'));", "return {};/* YAML.parse(readFileSync(file,'utf8')) */"),
])('Workspace 注释、shadow、跳过或不可达函数读取不能伪造消费证明：%#',mutate=>{
 const f=workspaceConfigFixture();writeFileSync(join(f.root,f.readerPath),mutate(f.reader));configCommit(f);
 expect(()=>gate.collectAuxiliarySourceEvidence(f.root,f.source)).toThrow(/AUXILIARY_CONFIG_/);
});
it.each([
 s=>s.replace('needs: caller-contract','needs: other'),
 s=>s.replace('  caller-contract:\n','  caller-contract:\n    if: false\n'),
 s=>s.replace('      - run: node --test','      - if: false\n        run: node --test'),
 s=>s.replace('      - run: node --test','      - continue-on-error: true\n        run: node --test'),
 s=>s.replace('run: node --test','run: echo node --test'),
 s=>s.replace('  caller-contract:\n','  caller-contract:\n    strategy: {matrix: {include: []}}\n'),
 s=>s.replace('      - run: node --test','      - working-directory: other-checkout\n        run: node --test'),
 s=>s.replace('jobs:\n','defaults: {run: {working-directory: other-checkout}}\njobs:\n'),
])('Workspace required caller-contract必须真实调用精确reader：%#',mutate=>{
 const f=workspaceConfigFixture();writeFileSync(join(f.root,workspaceCi),mutate(f.ci));configCommit(f);
 expect(()=>gate.collectAuxiliarySourceEvidence(f.root,f.source)).toThrow(/AUXILIARY_CONFIG_/);
});
it('Workspace 来源关系缺真实图认领仍 UNKNOWN，不能以exact reader赋权',()=>{
 const f=workspaceConfigFixture(),e=gate.collectAuxiliarySourceEvidence(f.root,f.source);
 f.report.source=f.source;for(const side of ['base','head']){f.report[side].revision=f.source[`${side}_revision`];f.report[side].file_coverage=f.source.changed_files.map((p,i)=>({change_index:i,path:p.path,matched_paths:[],truncated:false}));}
 f.report.affected_usages=[];f.report.gaps=f.source.changed_files.map(p=>({code:'changed_file_unclaimed',...p}));f.report.unclaimed_paths=f.source.changed_files;
 gate.applyAuxiliarySourceEvidence(f.report,e,{base:[],head:[]});
 expect(f.report.mapping_status).toBe('unknown');expect(f.report.gaps).toContainEqual({code:'auxiliary_owner_unclaimed',side:'head',path:f.readerPath});
});
it('Workspace exact关系不能跨repo、换reader/input或把业务SQL当配置',()=>{
 for(const change of [{repo:'perfectuser21/cecelia'},{consumer_path:'scripts/ci/__tests__/arbitrary.test.mjs'},{path:'.github/workflows/arbitrary.yml'},{owner_path:nightlyReader}]){
  const f=workspaceConfigFixture(),repo=change.repo||workspaceRepo;
  if(change.repo){f.git('remote','set-url','origin',`https://github.com/${repo}.git`);f.source.repo=repo;}
  const {repo:_repo,...changed}=change;
  writeFileSync(join(f.root,'.implementation-source-relations.json'),JSON.stringify({schema_version:1,repo,relations:[{...f.config,...changed}]}));configCommit(f);
  expect(()=>gate.collectAuxiliarySourceEvidence(f.root,f.source)).toThrow(/AUXILIARY_(CONFIG|MANIFEST)_/);
 }
 const f=workspaceConfigFixture();writeFileSync(join(f.root,workspaceCi),'SELECT * FROM tasks;');configCommit(f);
 expect(()=>gate.collectAuxiliarySourceEvidence(f.root,f.source)).toThrow(/AUXILIARY_CONFIG_CI_/);
});
it('Workspace reader仍不允许documentation/verification角色借test父模块，错reader hash拒绝',()=>{
 for(const role of ['documentation','verification']){
  const f=workspaceConfigFixture();writeFileSync(join(f.root,'.implementation-source-relations.json'),JSON.stringify({schema_version:1,repo:workspaceRepo,relations:[{owner_path:f.readerPath,path:'docs/controller.md',role}]}));configCommit(f);
  expect(()=>gate.collectAuxiliarySourceEvidence(f.root,f.source)).toThrow('AUXILIARY_OWNER_INVALID');
 }
 const f=workspaceConfigFixture(),e=gate.collectAuxiliarySourceEvidence(f.root,f.source);e.head.relations[0].consumer_sha256='f'.repeat(64);
 expect(()=>gate.applyAuxiliarySourceEvidence(f.report,e,{base:[],head:[]})).toThrow('AUXILIARY_EVIDENCE_INVALID');
});
function configFixture(target=nightlyYaml){
 const f=fixture([]);f.git('remote','set-url','origin','https://github.com/perfectuser21/cecelia.git');
 mkdirSync(join(f.root,'.github/workflows/scripts/__tests__'),{recursive:true});
 const reader=`import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';
import {value} from '../../../../src/controller.js';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const workflow=yaml.load(readFileSync(join(root,'${nightlyYaml}'),'utf8'));
const official=yaml.load(readFileSync(join(root,'${nightlyCi}'),'utf8'));
`;
 const ci=`on: [push, pull_request]
jobs:
  lint-auto-merge-decision:
    steps:
      - name: Self-test (nightly launch and health protocol)
        run: node --test ${nightlyReader}
  ci-passed:
    needs: [lint-auto-merge-decision]
    steps:
      - run: |
          check "lint-auto-merge-decision" "\${{ needs.lint-auto-merge-decision.result }}"
`;
 writeFileSync(join(f.root,nightlyReader),reader);writeFileSync(join(f.root,nightlyCi),ci);
 writeFileSync(join(f.root,nightlyYaml),`on: [schedule]
jobs:
  smoke:
    steps:
      - run: echo true
`);
 writeFileSync(join(f.root,'.implementation-source-relations.json'),JSON.stringify({schema_version:1,repo:'perfectuser21/cecelia',relations:[]}));
 f.git('add','.');f.git('commit','-qm','fixed base config files without ownership');f.source.base_revision=f.git('rev-parse','HEAD');
 const config={owner_path:nightlyReader,path:target,role:'verification_config',consumer_path:nightlyReader,ci_path:nightlyCi};
 const relations=[config];
 writeFileSync(join(f.root,target),readFileSync(join(f.root,target),'utf8')+'# candidate config update\n');
 writeFileSync(join(f.root,'.implementation-source-relations.json'),JSON.stringify({schema_version:1,repo:'perfectuser21/cecelia',relations}));
 f.git('add','.');f.git('commit','-qm','real nightly reader and required CI');f.source.repo='perfectuser21/cecelia';f.source.head_revision=f.git('rev-parse','HEAD');f.source.changed_files=[{path:'.implementation-source-relations.json'},{path:target}];
 return {...f,reader,ci,config,relations};
}
it.each([nightlyYaml,nightlyCi])('真实固定Git reader读取配置且由required CI永久执行：%s',target=>{
 const f=configFixture(target);const evidence=gate.collectAuxiliarySourceEvidence(f.root,f.source);
 const row=evidence.head.relations.find(r=>r.path===target);
 expect(row).toMatchObject({role:'verification_config',consumer_path:nightlyReader,ci_path:nightlyCi});
 expect(row.consumer_sha256).toMatch(/^[a-f0-9]{64}$/);expect(row.ci_sha256).toMatch(/^[a-f0-9]{64}$/);
 expect(row.consumer_evidence).toMatchObject({read_kind:'yaml.load/readFileSync',ci_job:'lint-auto-merge-decision',aggregate_job:'ci-passed'});
});

function configCommit(f){f.git('add','.');f.git('commit','-qm','updated frozen proof');f.source.head_revision=f.git('rev-parse','HEAD');}
it.each([
 ['任意YAML', {path:'.github/workflows/arbitrary.yml'}],
 ['业务SQL', {path:'packages/brain/migrations/business.sql'}],
 ['任意reader', {consumer_path:'src/another.test.mjs'}],
 ['任意CI', {ci_path:'.github/workflows/other.yml'}],
 ['借无关code父', {owner_path:'src/controller.js'}],
 ['其它test父', {owner_path:'src/other.test.js'}],
])('%s不能获得配置消费身份',(_name,change)=>{
 const f=configFixture();writeFileSync(join(f.root,'.implementation-source-relations.json'),JSON.stringify({schema_version:1,repo:f.source.repo,relations:[{...f.config,...change}]}));configCommit(f);
 expect(()=>gate.collectAuxiliarySourceEvidence(f.root,f.source)).toThrow();
});
it.each([
 ['注释伪调用', reader=>'/*'+reader+'*/'],
 ['字符串伪调用', reader=>`const fake=${JSON.stringify(reader)};`],
 ['没有YAML parse',reader=>reader.replaceAll('yaml.load(readFileSync','String(readFileSync')],
 ['YAML方法被覆盖',reader=>reader.replace('const workflow=', 'yaml.load=JSON.parse;const workflow=')],
 ['YAML对象转交其它函数',reader=>reader.replace('const workflow=', 'Object.assign(yaml,{load:JSON.parse});const workflow=')],
 ['真实test回调中的FS shadow',reader=>reader.replace('const workflow=', "import {test} from 'node:test';test('shadow',readFileSync=>{const workflow=").replace("const official=", "});const official=")],
 ['错误YAML模块',reader=>reader.replace("from 'js-yaml'","from 'fake-yaml'")],
 ['错误FS模块',reader=>reader.replace("from 'node:fs'","from 'fake-fs'")],
 ['错误root位置',reader=>reader.replace("new URL('../../../../'","new URL('../../../'")],
 ['URL被shadow',reader=>reader.replace('const root=', 'class URL {}\nconst root=')],
 ['reader被shadow',reader=>reader.replace('const workflow=',"function dead(readFileSync){ const workflow=")+ '\n}'],
 ['空for-of循环',reader=>reader.replace('const workflow=', 'for(const item of []){const workflow=')+'\n}'],
 ['空for-in循环',reader=>reader.replace('const workflow=', 'for(const item in {}){const workflow=')+'\n}'],
 ['test提前return',reader=>reader.replace('const workflow=', "import {test} from 'node:test';test('dead',()=>{return;const workflow=").replace('const official=', '});const official=')],
 ['死分支',reader=>reader.replace('const workflow=', 'if(false){const workflow=')+'\n}'],
 ['未调用函数',reader=>reader.replace('const workflow=', 'function uncalled(){const workflow=')+'\n}'],
])('%s不能替代真实AST读取',(_name,mutate)=>{
 const f=configFixture();writeFileSync(join(f.root,nightlyReader),mutate(f.reader));configCommit(f);
 expect(()=>gate.collectAuxiliarySourceEvidence(f.root,f.source)).toThrow();
});
it.each([
 ['CI注释伪调用', ci=>ci.replace('run: node --test','run: "# node --test')+'"'],
 ['CI echo伪调用', ci=>ci.replace('run: node --test','run: echo node --test')],
 ['CI字符串伪调用', ci=>ci.replace('run: node --test','run: echo "node --test')+'"'],
 ['无required需要', ci=>ci.replace('needs: [lint-auto-merge-decision]','needs: []')],
 ['没有真实汇总调用', ci=>ci.replace('check "lint-auto-merge-decision"','echo "lint-auto-merge-decision"')],
 ['汇总注释', ci=>ci.replace('check "lint-auto-merge-decision"','# check "lint-auto-merge-decision"')],
 ['可被跳过', ci=>ci.replace('    steps:', '    if: false\n    steps:')],
 ['吞失败', ci=>ci.replace('    steps:', '    continue-on-error: true\n    steps:')],
])('%s不能证明永久CI消费',(_name,mutate)=>{
 const f=configFixture();writeFileSync(join(f.root,nightlyCi),mutate(f.ci));configCommit(f);
 expect(()=>gate.collectAuxiliarySourceEvidence(f.root,f.source)).toThrow();
});
it('同固定路径不能以业务SQL冒充workflow，跨repo不能复用精确reader声明',()=>{
 const f=configFixture();writeFileSync(join(f.root,nightlyYaml),'SELECT * FROM tasks;');configCommit(f);
 expect(()=>gate.collectAuxiliarySourceEvidence(f.root,f.source)).toThrow(/INPUT_INVALID/);
 const cross=configFixture();cross.git('remote','set-url','origin','https://github.com/example/repo.git');cross.source.repo='example/repo';
 writeFileSync(join(cross.root,'.implementation-source-relations.json'),JSON.stringify({schema_version:1,repo:cross.source.repo,relations:cross.relations}));configCommit(cross);cross.source.base_revision=cross.source.head_revision;
 expect(()=>gate.collectAuxiliarySourceEvidence(cross.root,cross.source)).toThrow(/CONFIG_REPO_INVALID/);
});
it('配置reader缺真实图认领必须UNKNOWN，普通verification/documentation仍拒test父',()=>{
 const f=configFixture();const evidence=gate.collectAuxiliarySourceEvidence(f.root,f.source);
 f.report.source=f.source;f.report.head.revision=f.source.head_revision;
 f.report.head.graph_snapshot.repo=f.source.repo;f.report.head.graph_snapshot.source_revision=f.source.head_revision;
 gate.applyAuxiliarySourceEvidence(f.report,evidence,{base:[],head:[]});
 expect(f.report.mapping_status).toBe('unknown');expect(f.report.gaps).toContainEqual({code:'auxiliary_owner_unclaimed',side:'head',path:nightlyReader});
 expect(()=>assertImplementationReport(f.report)).toThrow();
 for(const role of ['verification','documentation']){
  const other=configFixture();writeFileSync(join(other.root,'.implementation-source-relations.json'),JSON.stringify({schema_version:1,repo:other.source.repo,relations:[{owner_path:nightlyReader,path:'docs/controller.md',role}]}));configCommit(other);
  expect(()=>gate.collectAuxiliarySourceEvidence(other.root,other.source)).toThrow(/OWNER_INVALID/);
 }
});

it('真实node:test回调中的YAML parse也是固定读取，不把独立未调用函数当证据',()=>{
 const f=configFixture(nightlyCi);
 writeFileSync(join(f.root,nightlyReader),f.reader.replace('const official=', "import {test} from 'node:test';test('ci',()=>{const official=")+'\n});');configCommit(f);
 expect(()=>gate.collectAuxiliarySourceEvidence(f.root,f.source)).not.toThrow();
});
it('只有真实图已认领固定reader后，配置才能获得独立覆盖；篡改reader/CI摘要拒绝',async()=>{
 const f=configFixture();f.source.changed_files=[{path:'.implementation-source-relations.json'},{path:nightlyYaml}];
 const report=f.report;report.source=f.source;report.required_assertions[0].source_repo=f.source.repo;
 for(const side of ['base','head']){
  report[side].revision=f.source[`${side}_revision`];report[side].graph_snapshot.repo=f.source.repo;report[side].graph_snapshot.source_revision=report[side].revision;
  report[side].file_coverage=f.source.changed_files.map((p,i)=>({change_index:i,path:p.path,matched_paths:[],truncated:false}));
 }
 report.gaps=f.source.changed_files.map(f=>({code:'changed_file_unclaimed',path:f.path}));report.unclaimed_paths=f.source.changed_files;
 report.affected_usages[0].evidence[0].implementation.path=nightlyReader;
 const evidence=gate.collectAuxiliarySourceEvidence(f.root,f.source);
 gate.applyAuxiliarySourceEvidence(report,evidence,{base:[],head:[{path:nightlyReader,matched_paths:[nightlyReader],truncated:false}]});
 expect(report.mapping_status).toBe('verified');expect(report.gaps).toEqual([]);
 expect(report.head.file_coverage[1]).toMatchObject({coverage_kind:'auxiliary_source',auxiliary_role:'verification_config',native_matched_paths:[],matched_paths:[nightlyReader]});
 const result=await gate.runImplementationGate({repoRoot:f.root,report});expect(result.verdict).toBe('PASS');expect(readFileSync(join(f.root,'actual-output'),'utf8')).toBe('auxiliary-checked');
 for(const field of ['consumer_sha256','ci_sha256']){
  const copy=structuredClone(report);copy.auxiliary_source_evidence.head.relations.find(r=>r.role==='verification_config')[field]='f'.repeat(64);
  expect(()=>gate.assertAuxiliarySourceEvidence(copy)).toThrow();await expect(gate.runImplementationGate({repoRoot:f.root,report:copy})).rejects.toThrow();
 }
});
