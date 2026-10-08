import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as gate from '../../../../../scripts/ci/implementation-gate.mjs';
import { runImplementationPrGate } from '../../../../../scripts/ci/implementation-pr-gate.mjs';
import { assertImplementationReport } from '../../../src/lib/implementation-report.js';

const roots=[];
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
