import {it,expect,vi} from 'vitest';
import {createScriptAuthority} from './script-authority.js';
it('伪造reservation owner被数据库身份拦截且不发Worker请求',async()=>{
 const operation=vi.fn();const authority=createScriptAuthority({pool:{query:async()=>({rows:[{id:'reservation',machine_id:'us-mac-m4',owner_key:'real'}]})}});
 await expect(authority('us-mac-m4','start',{reservation_id:'reservation',owner_key:'fake'},operation)).rejects.toThrow('execution_reservation_identity_mismatch');expect(operation).not.toHaveBeenCalled();
});
