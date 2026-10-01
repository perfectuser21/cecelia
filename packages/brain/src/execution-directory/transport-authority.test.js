import {it,expect,vi} from 'vitest';
import {createTransportAuthority} from './transport-authority.js';
it('外部bundle伪造授权不能越过数据库持久身份',async()=>{
 const operation=vi.fn();const authority=createTransportAuthority({pool:{query:async()=>({rows:[{id:'attempt',machine_id:'us-mac-m4',task_bundle:{inputs:{}}}]})}});
 await expect(authority('prepare',{attempt:{id:'attempt'},target:{machine:'us-mac-m4'},bundle:{inputs:{_server_execution:{executionVersionId:'fake',grantId:'fake'}}}},operation)).rejects.toThrow('execution_attempt_authority_missing');
 expect(operation).not.toHaveBeenCalled();
});
