import { afterEach,expect,it,vi } from 'vitest';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync,spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { implementationImpactDatabase,IMPACT_REPO } from '../fixtures/implementation-impact-db.js';
import yaml from 'js-yaml';
import { contractsFixture } from '../fixtures/shared-activity-contracts.js';
import { syncActivityContracts } from '../../activity-contract-sync.js';
import { exportImplementationSnapshot } from '../../lib/implementation-ci-snapshot.js';
import {digestMapManifest} from '../../lib/map-manifest-schema.js';
import {randomUUID} from 'node:crypto';
let fixture,root,out;
afterEach(async()=>{await fixture?.close();fixture=null;if(root)rmSync(root,{recursive:true,force:true});if(out)rmSync(out,{recursive:true,force:true});});
async function completeFixtureMap(f){
  for(const row of (await f.db.query("SELECT id,scope_key,manifest FROM map_manifest_versions WHERE status='active'")).rows){
    const id=randomUUID(),decision=randomUUID();
    const manifest={...row.manifest,source_decision_id:decision,boundaries:[],crosscut_pool:[]};
    for(const node of [...manifest.value_streams,...manifest.capabilities])node.name=node.key;
    const digest=digestMapManifest(manifest);
    const version=(await f.db.query('SELECT COALESCE(max(version),0)+1 next FROM map_manifest_versions WHERE scope_key=$1',[row.scope_key])).rows[0].next;
    await f.db.query("INSERT INTO decisions(id,category,topic,decision,status) VALUES($1,'feature','map','完整CLI种子版本','active')",[decision]);
    await f.db.query("UPDATE map_manifest_versions SET status='superseded' WHERE id=$1",[row.id]);
    await f.db.query("INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,$2,$3,$4,$5,$6,'active',NOW())",[id,row.scope_key,version,decision,manifest,digest]);
    // 种子在导出快照前完成；保留真实原projection/fact revision及节点，只换到完整新manifest。
    await f.db.query('UPDATE map_projection_runs SET manifest_version_id=$2,manifest_digest=$3,projection_digest=$3 WHERE manifest_version_id=$1',[row.id,id,digest]);
  }
}
async function setup({contracts=false,assertionChange=false,generatedChange=false}={}){
  root=mkdtempSync(join(tmpdir(),'implementation-real-git-'));out=mkdtempSync(join(tmpdir(),'implementation-evidence-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  git('init','-q');git('config','user.name','ci');git('config','user.email','ci@example.invalid');git('remote','add','origin',`https://github.com/${IMPACT_REPO}.git`);
  mkdirSync(join(root,'src'));mkdirSync(join(root,'scripts/smoke'),{recursive:true});
  writeFileSync(join(root,'src/shared-lock.js'),'module.exports=1;\n');writeFileSync(join(root,'src/controller.js'),"module.exports=require('./shared-lock.js');\n");
  const assertionRef='scripts/smoke/controller.sh';
  writeFileSync(join(root,assertionRef),'#!/bin/bash\nset -e\nnode -e "if(require(\'./src/controller.js\')!==2)process.exit(8)"\nprintf verified > actual-output\n');
  if(contracts){
    const source=contractsFixture();source.docs.keyword_acquisition.activities[0].implementation_bindings=[{kind:'code',repo:IMPACT_REPO,path:'src/controller.js',revision:'contract'}];source.refresh();
    mkdirSync(join(root,'product-map/contracts'),{recursive:true});mkdirSync(join(root,'product-map/generated'),{recursive:true});
    for(const [name,doc] of Object.entries(source.docs))writeFileSync(join(root,`product-map/contracts/${name}.yaml`),yaml.dump(doc));
    writeFileSync(join(root,'product-map/generated/contracts.json'),JSON.stringify(source.digest));
  }
  if(generatedChange)writeFileSync(join(root,assertionRef),readFileSync(join(root,assertionRef),'utf8').replace('!==2','!==1'));
  git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
  if(generatedChange)writeFileSync(join(root,'product-map/generated/contracts.json'),readFileSync(join(root,'product-map/generated/contracts.json'),'utf8')+'\n');
  else if(assertionChange)writeFileSync(join(root,assertionRef),readFileSync(join(root,assertionRef),'utf8').replace('!==2','!==1')+'# registered regression change\n');
  else writeFileSync(join(root,'src/shared-lock.js'),'module.exports=2;\n');git('add','.');git('commit','-qm','head');const head=git('rev-parse','HEAD');
  fixture=await implementationImpactDatabase({baseRevision:base,headRevision:head,assertionRef,readBinding:async b=>execFileSync('git',['show',`${b.revision}:${b.path}`],{cwd:root,encoding:'utf8'})});
  const completeMap=()=>completeFixtureMap(fixture);
  const syncGit=async revision=>syncActivityContracts(fixture.db,{resolveToken:async()=>'',synchronizeSteps:true,
    fetchFn:async url=>({ok:true,text:async()=>String(url).includes('/commits/main')?revision:
      git('show',`${revision}:${new URL(url).pathname.split('/contents/')[1]}`)}),
    readBinding:async b=>git('show',`${b.revision}:${b.path}`)+'\n'});
  if(contracts)await syncGit(base);
  await completeMap();const b=await exportImplementationSnapshot(fixture.db,{scope:'phones',repo:IMPACT_REPO,revision:base});
  await fixture.advance();if(contracts)await syncGit(head);
  await completeMap();const h=await exportImplementationSnapshot(fixture.db,{scope:'phones',repo:IMPACT_REPO,revision:head});
  writeFileSync(join(out,'base.json'),JSON.stringify(b));writeFileSync(join(out,'head.json'),JSON.stringify(h));
  return {base,head,b,h};
}
function cli(base,head,mode='main'){
  const script=fileURLToPath(new URL('../../../../../scripts/ci/implementation-pr-gate.mjs',import.meta.url));
  return spawnSync(process.execPath,[script,'--repo-root',root,'--scope','phones','--base',base,'--head',head,'--mode',mode,
    '--snapshot-base',join(out,'base.json'),'--snapshot-head',join(out,'head.json'),'--output-dir',out],{encoding:'utf8',env:process.env});
}
it('真实CLI从两个git版本扫描图/投影并运行回归，main收据保留中央definition IDs且零中央写入',async()=>{
  const {base,head,h}=await setup();
  const current=(await fixture.db.query('SELECT id,current_definition_version_id FROM workflows ORDER BY id')).rows;
  const run=cli(base,head);expect(run.status,run.stderr+run.stdout+(existsSync(join(out,'report.json'))?JSON.stringify(JSON.parse(readFileSync(join(out,'report.json'),'utf8')).gaps):'')).toBe(0);
  const report=JSON.parse(readFileSync(join(out,'report.json'),'utf8')),receipt=JSON.parse(readFileSync(join(out,'receipt.json'),'utf8'));
  expect(report.mapping_status).toBe('verified');expect(report.affected_usages).toHaveLength(2);
  expect(report.head.definition_versions.workflows.map(w=>w.id).sort()).toEqual(h.definitions.workflows.map(w=>w.id).sort());
  expect(receipt.purpose).toBe('release');expect(receipt.verdict).toBe('PASS');expect(receipt.source.head_revision).toBe(head);
  expect(readFileSync(join(root,'actual-output'),'utf8')).toBe('verified');
  expect((await fixture.db.query('SELECT id,current_definition_version_id FROM workflows ORDER BY id')).rows).toEqual(current);
});
it('main输入PR旧版本或缺scope快照返回明确失败产物，不能改标签成为发布证据',async()=>{
  const {base,head}=await setup();
  const missing=await exportImplementationSnapshot(fixture.db,{scope:'phones',repo:IMPACT_REPO,revision:'c'.repeat(40)});
  writeFileSync(join(out,'head.json'),JSON.stringify(missing));const run=cli(base,head);
  expect(run.status).toBe(1);expect(readFileSync(join(out,'gap.json'),'utf8')).toContain('snapshot');
});

it('PR按真实head契约产生隔离版本，只发admission_only，中央规范Activity/Step/reference身份保留',async()=>{
  const {base,head,b,h}=await setup({contracts:true});writeFileSync(join(out,'head.json'),JSON.stringify(b));
  const run=cli(base,head,'pr');expect(run.status,run.stderr+run.stdout).toBe(0);
  const report=JSON.parse(readFileSync(join(out,'report.json'),'utf8')),receipt=JSON.parse(readFileSync(join(out,'receipt.json'),'utf8'));
  expect(receipt.purpose).toBe('admission_only');expect(report.source.head_revision).toBe(head);
  expect(report.head.definition_versions.workflows.every(w=>!h.definitions.workflows.some(c=>c.id===w.id))).toBe(true);
  expect(report.affected_usages.map(u=>u.activity_id)).toEqual(expect.arrayContaining(b.canonical.activities.filter(a=>a.activity_key==='preflight').map(a=>a.id)));
});
it('固定head图只来自提交文件，未跟踪及ignored生成JS不能污染SHA证据',async()=>{
  const {base,head}=await setup();
  writeFileSync(join(root,'untracked-phantom.js'),"require('./src/controller.js');\n");
  mkdirSync(join(root,'ignored'));writeFileSync(join(root,'ignored/phantom.js'),"require('../src/controller.js');\n");
  mkdirSync(join(root,'.git/info'),{recursive:true});writeFileSync(join(root,'.git/info/exclude'),'ignored/\n');
  const run=cli(base,head);expect(run.status,run.stderr).toBe(0);
  const report=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));
  expect(report.head.traversal.paths).not.toContain('untracked-phantom.js');
  expect(report.head.traversal.paths).not.toContain('ignored/phantom.js');
});

it('只改精确登记的回归脚本仍反查其两个消费者，不泛化其他tests路径',async()=>{
  const {base,head}=await setup({assertionChange:true});const run=cli(base,head);expect(run.status,run.stderr).toBe(0);
  const report=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));
  expect(report.source.changed_files).toEqual([{path:'scripts/smoke/controller.sh'}]);expect(report.affected_usages).toHaveLength(2);
  expect(report.head.file_coverage[0].matched_paths).toContain('src/controller.js');
});

it('main精确生成契约索引经digest核验后可归入消费者，保留中央版本UUID',async()=>{
  const {base,head,h}=await setup({contracts:true,generatedChange:true});const run=cli(base,head);expect(run.status,run.stderr).toBe(0);
  const report=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));
  expect(report.source.changed_files).toEqual([{path:'product-map/generated/contracts.json'}]);
  expect(report.affected_usages).toHaveLength(2);
  expect(report.head.definition_versions.workflows.map(w=>w.id).sort()).toEqual(h.definitions.workflows.map(w=>w.id).sort());
});

it.each([{}, {contracts:true}, {assertionChange:true}, {contracts:true,generatedChange:true}])('seedonly真实setup提交完整新map版本且两快照verified，不调用不安全CLI %j',async options=>{
 const {base,head,b,h}=await setup(options);
 expect(b.status,JSON.stringify(b.gaps)).toBe('verified');expect(h.status,JSON.stringify(h.gaps)).toBe('verified');
 expect(b.gaps).toEqual([]);expect(h.gaps).toEqual([]);expect(b.revision).toBe(base);expect(h.revision).toBe(head);
 const rows=(await fixture.db.query('SELECT * FROM map_manifest_versions ORDER BY version')).rows;
 expect(rows.map(r=>r.version)).toEqual([1,2,3,4]);
 for(const version of [1,3]){const original=rows.find(r=>r.version===version);expect(original.manifest).not.toHaveProperty('boundaries');expect(original.manifest.capabilities[0]).not.toHaveProperty('name');}
 for(const version of [2,4]){
  const row=rows.find(r=>r.version===version);expect(row.manifest.source_decision_id).toBe(row.source_decision_id);expect(row.digest).toBe(digestMapManifest(row.manifest));
  expect((await fixture.db.query('SELECT id FROM decisions WHERE id=$1',[row.source_decision_id])).rows).toEqual([{id:row.source_decision_id}]);
  expect(row.manifest.boundaries).toEqual([]);expect(row.manifest.crosscut_pool).toEqual([]);
  expect(row.manifest.capabilities.every(n=>n.name===n.key)).toBe(true);
  const projections=(await fixture.db.query('SELECT manifest_digest,projection_digest FROM map_projection_runs WHERE manifest_version_id=$1',[row.id])).rows;
  expect(projections).toEqual([{manifest_digest:row.digest,projection_digest:row.digest}]);
 }
 const history=rows.map(({id,manifest,digest,source_decision_id,version})=>({id,manifest,digest,source_decision_id,version}));
 await expect(fixture.db.query("UPDATE map_manifest_versions SET manifest=manifest||'{\"tampered\":true}' WHERE id=$1",[rows[0].id])).rejects.toMatchObject({code:'P0001'});
 expect((await fixture.db.query('SELECT id,manifest,digest,source_decision_id,version FROM map_manifest_versions ORDER BY version')).rows).toEqual(history);
});

it('实际库名不符时只读身份后断开，即使CI变量为真也不向生产发送清理DDL',async()=>{
 const {default:pg}=await import('pg'),{DB_DEFAULTS}=await import('../../db-config.js');
 const {createImplementationScratch}=await import('../../../../../scripts/ci/implementation-snapshot.mjs');
 const configured=DB_DEFAULTS.database;DB_DEFAULTS.database='cecelia_scratch';vi.stubEnv('CI','true');vi.stubEnv('GITHUB_ACTIONS','true');
 const calls=[];const spy=vi.spyOn(pg,'Client').mockImplementation(function(){return {connect:async()=>calls.push('connect'),query:async sql=>{calls.push(sql);return {rows:[{name:'cecelia'}]};},end:async()=>calls.push('end')};});
 try{await expect(createImplementationScratch()).rejects.toMatchObject({code:'IMPLEMENTATION_CI_SCRATCH_REQUIRED'});expect(calls).toEqual(['connect','SELECT current_database() name','end']);}
 finally{spy.mockRestore();DB_DEFAULTS.database=configured;vi.unstubAllEnvs();}
});
