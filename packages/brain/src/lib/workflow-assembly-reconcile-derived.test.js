import {it,expect,vi} from 'vitest';
import * as service from './workflow-assembly-reconcile-derived.js';
it('仅scratch或受CI双标志保护的测试库允许候选写入，不能凭标志解锁production',()=>{
 expect(service.isAssemblyReconcileEnvironment).toBeTypeOf('function');
 expect(service.isAssemblyReconcileEnvironment('cecelia_scratch',{})).toBe(true);
 expect(service.isAssemblyReconcileEnvironment('cecelia_test',{})).toBe(false);
 expect(service.isAssemblyReconcileEnvironment('cecelia_test',{CI:'true'})).toBe(false);
 expect(service.isAssemblyReconcileEnvironment('cecelia_test',{CI:'true',GITHUB_ACTIONS:'true'})).toBe(true);
 expect(service.isAssemblyReconcileEnvironment('cecelia',{CI:'true',GITHUB_ACTIONS:'true'})).toBe(false);
});
it('派生修复预算已到不能开始事务或任何写入',async()=>{
 const db={query:vi.fn()};await expect(service.auditAssemblyDerivations(db,{}, {check:()=>{throw Error('budget');}})).rejects.toThrow('budget');expect(db.query).not.toHaveBeenCalled();
});
