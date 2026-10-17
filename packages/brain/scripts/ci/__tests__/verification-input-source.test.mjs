import { it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { collectAuxiliarySourceEvidence, applyAuxiliarySourceEvidence, assertAuxiliarySourceEvidence } from '../../../../../scripts/ci/implementation-auxiliary-evidence.mjs';

const roots=[],owner='__tests__/reader.test.mjs',input='__tests__/fixtures/input.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>sha(JSON.stringify(canonical(v)));
afterEach(()=>{for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
function fixture({ownerPath=owner,inputPath=input,code="import { input } from './fixtures/input.mjs';\nexport const consumed=input;\n",role='verification_input',extra={},missing,symlink=false}={}){
 const root=mkdtempSync(join(tmpdir(),'verification-input-source-'));roots.push(root);
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const put=(p,text)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),text);};
 git('init','-q');git('config','user.name','SourceFixture');git('config','user.email','source@example.invalid');git('remote','add','origin','https://github.com/example/repo.git');
 put(ownerPath,code);put(inputPath,'export const input=1;\nexport default input;\n');git('add','.');git('commit','-qm','fixed base');const base=git('rev-parse','HEAD');
 put(inputPath,'export const input=2;\nexport default input;\n');
 if(missing)rmSync(join(root,missing==='owner'?ownerPath:inputPath));
 if(symlink){rmSync(join(root,inputPath));put('real-input.mjs','export const input=2;\nexport default input;\n');symlinkSync('../../real-input.mjs',join(root,inputPath));}
 put('.implementation-source-relations.json',JSON.stringify({schema_version:1,repo:'example/repo',relations:[{owner_path:ownerPath,path:inputPath,role,...extra}]}));
 git('add','.');git('commit','-qm','actual fixed input relation');const head=git('rev-parse','HEAD');
 const source={repo:'example/repo',base_revision:base,head_revision:head,changed_files:[{path:'.implementation-source-relations.json'},{path:inputPath}]};
 const implementation={kind:'code',repo:source.repo,path:ownerPath,revision:head,digest:'sha256:'+sha(code)};
 const usage={implementation};
 const report={source,mapping_status:'unknown',gaps:source.changed_files.map(f=>({code:'changed_file_unclaimed',...f})),unclaimed_paths:source.changed_files,
  affected_usages:[{evidence:[{side:'head',revision:head,implementation}]}],required_assertions:[]};
 for(const [side,rev]of[['base',base],['head',head]])report[side]={revision:rev,graph_snapshot:{digest:'a'.repeat(64)},affected_usages:side==='head'?[usage]:[],file_coverage:source.changed_files.map(f=>({path:f.path,matched_paths:[],truncated:false}))};
 const ownerCoverage={base:[],head:[{path:ownerPath,matched_paths:[ownerPath],truncated:false}]};
 return {root,git,source,report,ownerCoverage,ownerPath,inputPath};
}
const collect=f=>collectAuxiliarySourceEvidence(f.root,f.source);
function apply(f,e=collect(f)){applyAuxiliarySourceEvidence(f.report,e,f.ownerCoverage);return f.report;}
function rehash(e){e.evidence_sha256=digest({schema_version:e.schema_version,source:e.source,base:e.base,head:e.head});return e;}

it.each(["import { input } from './fixtures/input.mjs';\nexport const consumed=input;\n","import input from './fixtures/input.mjs';\nexport { input };\n","import './fixtures/input.mjs';\n"])(
 'verification_input freezes actual regular Git input and direct top-level ESM test import %s',code=>{
  const f=fixture({code}),e=collect(f),row=e.head.relations[0];
  expect(row).toMatchObject({owner_path:owner,path:input,role:'verification_input',owner_sha256:sha(code),sha256:sha(readFileSync(join(f.root,input)))});
  expect(row.consumer_evidence).toMatchObject({kind:'direct_static_test_import',import_specifier:'./fixtures/input.mjs'});
  expect(row.consumer_evidence.import_range).toEqual([0,code.indexOf(';')+1]);
  apply(f,e);expect(f.report.mapping_status).toBe('verified');expect(f.report.unclaimed_paths).toEqual([]);
  expect(f.report.head.file_coverage[1]).toMatchObject({coverage_kind:'auxiliary_source',auxiliary_role:'verification_input',native_matched_paths:[]});
  expect(()=>assertAuxiliarySourceEvidence(f.report)).not.toThrow();
 });
it.each(['src/reader.mjs','__tests__/helpers/reader.mjs','__tests__/fixtures/reader.test.mjs'])('non-test/helper/fixture cannot become selected test owner: %s',ownerPath=>{
 const f=fixture({ownerPath});expect(()=>collect(f)).toThrow();
});
it.each(['src/input.mjs','__tests__/helpers/input.mjs','__tests__/fixtures/input.js','__tests__/fixtures/nested/input.mjs'])('verification_input cannot become arbitrary production/helper/nested input: %s',inputPath=>{
 const f=fixture({inputPath});expect(()=>collect(f)).toThrow();
});
it.each([
 "export const input=1;\n",
 "const value=import('./fixtures/input.mjs');\n",
 "function dead(){return import('./fixtures/input.mjs');}\n",
 "import './fixtures/../fixtures/input.mjs';\n",
 "import '../__tests__/fixtures/input.mjs';\n",
 "import 'fixture-alias';\n",
 "// import './fixtures/input.mjs';\nexport const value=1;\n",
 "import './fixtures/other.mjs';\n",
])('missing/dynamic/dead/comment/alias/noncanonical imports cannot prove input: %s',code=>{
 const f=fixture({code});expect(()=>collect(f)).toThrow();
});
it.each(['owner','input'])('missing fixed Git %s fails closed',missing=>{const f=fixture({missing});expect(()=>collect(f)).toThrow();});
it('Git symlink input is rejected rather than following its bytes',()=>{const f=fixture({symlink:true});expect(()=>collect(f)).toThrow(/REGULAR_FILE/);});
it('unknown relation keys and legacy verification still reject a fixture',()=>{
 for(const options of [{extra:{consumer_path:owner}},{role:'verification'}]){const f=fixture(options);expect(()=>collect(f)).toThrow();}
});
it.each(['missing-native','wrong-digest','wrong-repo','wrong-revision','wrong-kind','wrong-side','graph-only','truncated'])(
 'unclaimed or forged native selected-test owner cannot cover fixture: %s',kind=>{
  const f=fixture(),e=collect(f),impl=f.report.affected_usages[0].evidence[0].implementation;
  if(kind==='missing-native')f.report.affected_usages=[];
  if(kind==='wrong-digest')impl.digest='sha256:'+'0'.repeat(64);
  if(kind==='wrong-repo')impl.repo='other/repo';
  if(kind==='wrong-revision')impl.revision=f.source.base_revision;
  if(kind==='wrong-kind')impl.kind='skill';
  if(kind==='wrong-side')f.report.affected_usages[0].evidence[0].side='base';
  if(kind==='graph-only'){impl.path='src/controller.js';f.ownerCoverage.head[0].matched_paths=['src/controller.js'];}
  if(kind==='truncated')f.ownerCoverage.head[0].truncated=true;
  expect(()=>apply(f,e)).toThrow();
 });
it.each(['proof-kind','unknown-proof-key','negative-range','out-of-range','short-range','owner-source','specifier','input-hash','owner-hash'])(
 'frozen typed import proof and fixed hashes reject tampering: %s',kind=>{
  const f=fixture(),e=collect(f),row=e.head.relations[0];
  if(kind==='proof-kind')row.consumer_evidence.kind='dynamic_import';
  if(kind==='unknown-proof-key')row.consumer_evidence.extra=true;
  if(kind==='negative-range')row.consumer_evidence.import_range=[-1,2];
  if(kind==='out-of-range')row.consumer_evidence.import_range=[0,Number.MAX_SAFE_INTEGER];
  if(kind==='short-range')row.consumer_evidence.import_range[1]-=1;
  if(kind==='owner-source')row.consumer_evidence.owner_source='export const unrelated=1;';
  if(kind==='specifier')row.consumer_evidence.import_specifier='./fixtures/../fixtures/input.mjs';
  if(kind==='input-hash')row.sha256='0'.repeat(64);
  if(kind==='owner-hash')row.owner_sha256='0'.repeat(64);
  if(!kind.endsWith('-hash'))rehash(e);
  expect(()=>apply(f,e)).toThrow();
 });
it('dirty uncommitted input bytes do not replace fixed Git fixture bytes',()=>{
 const f=fixture(),e=collect(f);writeFileSync(join(f.root,input),'DIRTY_INPUT');
 expect(collect(f)).toEqual(e);expect(e.head.relations[0].sha256).toBe(sha('export const input=2;\nexport default input;\n'));
});
