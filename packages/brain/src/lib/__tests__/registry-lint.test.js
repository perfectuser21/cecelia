import { expect,it } from 'vitest';
import { lintImplementationRegistry } from '../../../../../scripts/ci/registry-lint.mjs';
const activity={id:'activity',capability_key:'cap',activity_key:'activity',contract:{key:'activity',name:'before',steps:[]}};
const snapshot={canonical:{workflows:[{source_capability:'cap'}],activities:[activity],references:[{workflow_id:'wf',slot_key:'activity',activity_id:'activity'}],steps:[]},assertions:[]};
it('新增规范Step/Activity必须显式登记，旧cap下相似名称不得猜身份',()=>{
 const plans=[{workflow:{id:'wf',capability_id:'cap-uuid'},activities:[{activity:{from:'cap',key:'activity',name:'before',steps:[{key:'new'}]}},{activity:{from:'cap',key:'other',name:'before',steps:[]}}]}];
 const result=lintImplementationRegistry(snapshot,plans,{capabilities:{cap:{}}});
 expect(result.status).toBe('unknown');expect(result.gaps).toContainEqual({code:'step_registration_missing',activity_id:'activity',step_key:'new'});
 expect(result.gaps).toContainEqual({code:'activity_registration_missing',identity:'cap.other'});
});
it('修改契约不能靠同文件另一Activity的实现和回归掩盖缺口',()=>{
 const plans=[{workflow:{id:'wf',capability_id:'cap-uuid'},activities:[{activity:{from:'cap',key:'activity',name:'changed',steps:[]},bindings:[]}]}];
 expect(lintImplementationRegistry(snapshot,plans,{capabilities:{cap:{}}}).gaps).toContainEqual({code:'changed_activity_implementation_missing',activity_id:'activity',identity:'cap.activity'});
});
