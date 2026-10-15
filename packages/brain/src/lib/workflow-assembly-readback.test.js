import {it,expect,vi} from 'vitest';
import {verifyAssemblyReadback} from './workflow-assembly-readback.js';
it('配方有行但缺固定build映射仍拒绝，不能靠数量冒充完成',async()=>{
 const db={query:vi.fn(async sql=>({rows:sql.includes('SELECT recipe')?[{recipe:[{slot_key:'render',activity_id:'a',activity_version_id:null}]}]:[{slot_key:'render',activity_id:'a',activity_definition_version_id:'b',activity_version_id:null}]}))};
 await expect(verifyAssemblyReadback(db,'w',[{slot_key:'render',activity_id:'a',activity_version_id:'b'}])).rejects.toThrow(/回读/);
});
