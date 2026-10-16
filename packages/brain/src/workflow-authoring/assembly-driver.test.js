import {it,expect,vi} from 'vitest';
import {advanceAuthoringAssembly} from './assembly-driver.js';
it('预算撤销与管理任务撤权在默认driver中零连接零调用',async()=>{
 const query=vi.fn(async()=>({rows:[{id:'id',status:'in_progress',claimed_by:null,payload:{workflow_authoring:true},result:{}}]})),connect=vi.fn();
 const pool={query,connect};
 const revoked=await advanceAuthoringAssembly(pool,'id');expect(revoked).toMatchObject({status:'blocked',gaps:[{code:'authoring_authority_revoked'}]});expect(connect).not.toHaveBeenCalled();
 query.mockClear();const expired=await advanceAuthoringAssembly(pool,'id',{deadline:Date.now()-1});
 expect(expired.status).toBe('blocked');expect(query).not.toHaveBeenCalled();
});
