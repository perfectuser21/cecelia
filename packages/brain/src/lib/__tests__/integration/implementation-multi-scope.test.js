import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import { beforeEach,afterEach,it,expect } from 'vitest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import { readImplementationImpact } from '../../implementation-impact.js';
import * as multi from '../../../../../../scripts/ci/implementation-multi-scope.mjs';
let a,b,reports,source;
beforeEach(async()=>{
 a=await releaseEvidenceDatabase({scope:'cecelia-kr'});b=await releaseEvidenceDatabase({scope:'cecelia-factory'});
 const r=a.releaseInput.ci_evidence[0].report;
 source={...r.source,changed_files:[{path:'src/shared-lock.js'},{path:'src/controller.js'}]};
 reports=[r,await readImplementationImpact(b.db,{scope:'cecelia-factory',repo:source.repo,base_revision:source.base_revision,head_revision:source.head_revision,changed_files:[{path:'src/controller.js'}]})];
});
afterEach(async()=>{await a?.close();await b?.close();});
it('真实PG两scope报告按明确切片保留各投影，联合覆盖完整差异并不伪造单一投影',()=>{
 expect(multi.aggregateScopedImplementationEvidence).toBeTypeOf('function');
 const proof=multi.aggregateScopedImplementationEvidence({source,expectedScopes:['cecelia-kr','cecelia-factory'],reports});
 expect(proof.source.changed_files).toEqual(source.changed_files);expect(proof.scope_reports).toHaveLength(2);
 expect(proof.scope_reports.map(r=>r.head.projection.projection_run_id)).toEqual(reports.map(r=>r.head.projection.projection_run_id));
 expect(proof.file_coverage.map(f=>f.path)).toEqual(source.changed_files.map(f=>f.path));
 expect(proof.business_runtime_status).toBe('not_evaluated');expect(proof).not.toHaveProperty('head.projection');
});
it('缺整个scope或漏一个Git文件都拒绝，不以另一scope通过标签代替',()=>{
 expect(()=>multi.aggregateScopedImplementationEvidence({source,expectedScopes:['cecelia-kr','cecelia-factory'],reports:[reports[0]]})).toThrow();
 expect(()=>multi.aggregateScopedImplementationEvidence({source:{...source,changed_files:[...source.changed_files,{path:'migrations/unknown.sql'}]},expectedScopes:['cecelia-kr','cecelia-factory'],reports})).toThrow();
});
it('真实UNKNOWN、缺断言、截断图、错误repo/SHA必须保留并拒绝',()=>{
 for(const change of [r=>r.gaps.push({code:'regression_missing'}),r=>r.required_assertions=[],r=>r.head.traversal.truncated=true,r=>r.source.repo='other/repo',r=>r.source.head_revision='c'.repeat(40)]){
  const altered=structuredClone(reports);change(altered[1]);expect(()=>multi.aggregateScopedImplementationEvidence({source,expectedScopes:['cecelia-kr','cecelia-factory'],reports:altered})).toThrow();
 }
});

it('组合准入必须核真实Git完整差异与祖先，不能拿领域切片冒完整diff',()=>{
 const root=mkdtempSync(join(tmpdir(),'multi-scope-source-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 try{
  git('init','-q');git('remote','add','origin','https://github.com/'+source.repo+'.git');
  mkdirSync(join(root,'src'));for(const name of ['controller.js','shared-lock.js'])writeFileSync(join(root,'src',name),'export const old=true;\n');
  const commit=()=>{git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');return git('rev-parse','HEAD');};
  const base=commit();for(const name of ['controller.js','shared-lock.js'])writeFileSync(join(root,'src',name),'export const changed=true;\n');const head=commit();
  const src={...source,base_revision:base,head_revision:head},parts=structuredClone(reports);
  for(const part of parts){part.source.base_revision=base;part.source.head_revision=head;for(const side of ['base','head']){part[side].revision=src[`${side}_revision`];part[side].graph_snapshot.source_revision=src[`${side}_revision`];}}
  const proof=multi.aggregateScopedImplementationEvidence({source:src,expectedScopes:['cecelia-kr','cecelia-factory'],reports:parts});
  expect(multi.verifyScopedImplementationGitSource).toBeTypeOf('function');
  expect(()=>multi.verifyScopedImplementationGitSource(root,proof)).not.toThrow();
  const incomplete=multi.aggregateScopedImplementationEvidence({source:{...src,changed_files:[src.changed_files[0]]},expectedScopes:['cecelia-kr'],reports:[parts[0]]});
  expect(()=>multi.verifyScopedImplementationGitSource(root,incomplete)).toThrow('IMPACT_MULTISCOPE_DIFF_MISMATCH');
  writeFileSync(join(root,'src/controller.js'),'dirty\n');expect(()=>multi.verifyScopedImplementationGitSource(root,proof)).toThrow('IMPACT_MULTISCOPE_SOURCE_DIRTY');
 }finally{rmSync(root,{recursive:true,force:true});}
});
