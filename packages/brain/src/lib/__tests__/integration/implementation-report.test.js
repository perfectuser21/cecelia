import { beforeEach,afterEach,it,expect } from 'vitest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import { assertImplementationReport } from '../../implementation-report.js';
let fixture;
beforeEach(async()=>{fixture=await releaseEvidenceDatabase();});
afterEach(async()=>{await fixture?.close();});
it('实际PG生成的双Workflow影响报告可验证，删任一消费者覆盖即拒绝',()=>{
  const report=structuredClone(fixture.releaseInput.ci_evidence[0].report);
  expect(()=>assertImplementationReport(report)).not.toThrow();
  const omitted=report.required_assertions[0].source_bindings[0].capability_id;
  for(const assertion of report.required_assertions)assertion.source_bindings=assertion.source_bindings.filter(binding=>binding.capability_id!==omitted);
  expect(()=>assertImplementationReport(report)).toThrow('IMPACT_REGRESSION_MISSING');
});
it('双边软件图与逐文件覆盖证据必需，不以PASS标签代替',()=>{
  for(const mutate of [r=>delete r.head.file_coverage,r=>delete r.base.graph_snapshot]){
    const report=structuredClone(fixture.releaseInput.ci_evidence[0].report);mutate(report);expect(()=>assertImplementationReport(report)).toThrow();
  }
});
