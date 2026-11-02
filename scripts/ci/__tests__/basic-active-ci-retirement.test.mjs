import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {collectVerificationInputEvidence} from '../implementation-verification-inputs.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const baseRevision='69de823cda6d789130898399c3ad770c15b6fb71';
const runner='scripts/ci/run-basic-check.mjs',scope='scripts/ci/basic-scope.mjs';
const testPath='scripts/ci/__tests__/basic-results.test.mjs';
const paths=['.github/workflows/ci.yml',runner,scope,'scripts/ci/check-basic-results.mjs','scripts/ci/ops-checks.mjs',testPath];
const original=Object.fromEntries(paths.map(path=>[path,execFileSync('git',['--no-replace-objects','show',baseRevision+':'+path],{cwd:root,encoding:'utf8'})]));
// 复用独立collector回归中冻结的完整候选文本，只解码AST字面量，不执行测试或候选代码。
const tree=parse(readFileSync(join(root,'packages/brain/src/lib/__tests__/existing-ops-active-ci-retirement.test.js'),'utf8'),{ecmaVersion:'latest',sourceType:'module'});
const frozen=tree.body.find(row=>row.type==='VariableDeclaration'&&row.declarations.some(d=>d.id.name==='retiredSources'))
 .declarations.find(d=>d.id.name==='retiredSources').init;
assert.equal(frozen.type,'ObjectExpression');
const retired=Object.fromEntries(frozen.properties.map(p=>{assert.equal(p.type,'Property');assert.equal(p.key.type,'Literal');assert.equal(p.value.type,'Literal');return[p.key.value,p.value.value];}));
assert.deepEqual(Object.keys(retired).sort(),['packages/engine/vitest.config.ts','packages/quality/vitest.config.ts',runner,scope].sort());

function fixture(t,{changes={ [runner]:retired[runner],[scope]:retired[scope] }}={}){
 const directory=mkdtempSync(join(tmpdir(),'active-ci-retirement-input-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false',...args],{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const write=(path,text)=>{mkdirSync(dirname(join(directory,path)),{recursive:true});writeFileSync(join(directory,path),text);};
 const commit=()=>{git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','test: fixed actual CI source');return git('rev-parse','HEAD');};
 git('init','-q');git('remote','add','origin','https://github.com/perfectuser21/cecelia.git');
 for(const[path,text]of Object.entries(original))write(path,text);
 const base=commit();
 for(const[path,text]of Object.entries(changes))write(path,text);
 write(testPath,original[testPath]+'\n// 真实测试文件固定Git变更输入。\n');
 const head=commit(),source={repo:'perfectuser21/cecelia',base_revision:base,head_revision:head,
  changed_files:git('diff','--no-renames','--name-only',base,head).split('\n').map(path=>({path}))};
 return {root:directory,source,git};
}
const observe=f=>collectVerificationInputEvidence(f.root,{source:f.source});
const selected=proof=>proof.rows.find(row=>row.input_facts.path===testPath&&row.input_facts.source.side==='head');

test('退役后的完整Basic入口以固定Git事实选择真实Node回归，仍不授执行或owner资格',t=>{
 const f=fixture(t),proof=observe(f),row=selected(proof);
 assert.ok(row,JSON.stringify(proof.unproven));
 assert.equal(row.witness.kind,'basic_regular_node_test');
 assert.equal(row.input_facts.source.revision,f.source.head_revision);
 assert.equal(row.input_facts.entry_verified,false);assert.equal(row.input_facts.owner_verified,false);
 assert.equal(row.execution_status,'not_evaluated');assert.equal(row.coverage,'unknown');
 assert.ok(row.eligible_owner_paths.includes(runner));
 for(const path of [runner,scope])assert.equal(row.witness.entry.support.find(file=>file.path===path).source.revision,f.source.head_revision);
});

test('旧完整Basic入口继续选择真实回归',t=>{
 const proof=observe(fixture(t,{changes:{}}));assert.ok(selected(proof),JSON.stringify(proof.unproven));
});

for(const path of [runner,scope]){
 test(`新旧Basic入口成员不能混配：${path}`,t=>{
  const proof=observe(fixture(t,{changes:{[runner]:retired[runner],[scope]:retired[scope],[path]:original[path]}}));
  assert.equal(selected(proof),undefined);assert.ok(proof.unproven.some(row=>row.path===testPath&&row.side==='head'&&row.reason==='entry_unproven'));
 });
 test(`任一完整入口未审字节不能继承新组合：${path}`,t=>{
  const proof=observe(fixture(t,{changes:{[runner]:retired[runner],[scope]:retired[scope],[path]:retired[path]+'\n// 未审漂移\n'}}));
  assert.equal(selected(proof),undefined);assert.ok(proof.unproven.some(row=>row.path===testPath&&row.side==='head'&&row.reason==='entry_unproven'));
 });
}
