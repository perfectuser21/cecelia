import { it,expect } from 'vitest';
import { systemImpactProjection } from '../capability-system-impact.js';
it('公开影响视图递归剥离执行载荷，保留同一Activity不同引用位置及双边版本',()=>{
  const assertion={assertion_ref:'tests/shared.test.js',source_repo:'owner/repo',command:['sh','PRIVATE_COMMAND'],source_bindings:[{activity_id:'a',step_id:'s',context:'PRIVATE_CONTEXT'}]};
  const report={mapping_status:'unknown',source:{repo:'owner/repo',head_revision:'h'},gaps:[{code:'projection_snapshot_missing',context:'PRIVATE_CONTEXT'}],
    base:{revision:'b',required_assertions:[assertion]},head:{revision:'h',required_assertions:[assertion]},required_assertions:[assertion],
    affected_usages:[{workflow_id:'w1',reference_id:'r1',activity_id:'a',evidence:[{side:'base',reference_id:'r1',implementation:{path:'shared.js',env:'PRIVATE_ENV'}}]},
      {workflow_id:'w2',reference_id:'r2',activity_id:'a',context:'PRIVATE_CONTEXT'}]};
  const result=systemImpactProjection(report);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_/);
  expect(result.affected_usages.map(u=>u.reference_id)).toEqual(['r1','r2']);
  expect(result.base.revision).toBe('b');expect(result.head.revision).toBe('h');
  expect(result.required_assertions[0]).toMatchObject({assertion_ref:'tests/shared.test.js',source_bindings:[{activity_id:'a',step_id:'s'}]});
  expect(result.mapping_status).toBe('unknown');expect(result.gaps).toEqual([{code:'projection_snapshot_missing'}]);
});
