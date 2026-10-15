import {it,expect,vi} from 'vitest';
import {ensureAssemblyWarehouse,syncAssemblyActivity} from './workflow-assembly-store.js';
it('同名未知仓库来源不能被声明认领，原行不UPDATE或DELETE',async()=>{
 const db={query:vi.fn(async()=>({rows:[{key:'renderer',name:'渲染',kind:'code',shelf:'generic_action',impl_ref:'render.js',active:true}]}))};
 await expect(ensureAssemblyWarehouse(db,{warehouse_items:[{key:'renderer',name:'渲染',kind:'code',shelf:'generic_action',impl_ref:'render.js'}]},{repo:'org/repo',path:'contract.json'})).rejects.toThrow(/来源/);
 expect(db.query.mock.calls.some(([sql])=>/^UPDATE|^DELETE/.test(sql))).toBe(false);
});
it('读取共享固定合同只核对依赖，不写合同列和步骤或删除人工用料',async()=>{
 const db={query:vi.fn(async()=>({rows:[]}))};
 await syncAssemblyActivity(db,{activityId:'a',contract:{steps:[{key:'read'}]},source:{repo:'org/repo',path:'contract.json'},readOnly:true,strict:true,synchronizeSteps:true});
 expect(db.query).not.toHaveBeenCalled();
});
