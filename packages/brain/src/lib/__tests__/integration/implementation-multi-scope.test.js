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
