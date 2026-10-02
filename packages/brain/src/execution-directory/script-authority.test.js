import {it,expect,vi} from 'vitest';
import {createScriptAuthority} from './script-authority.js';
it('伪造reservation owner被数据库身份拦截且不发Worker请求',async()=>{
 const operation=vi.fn();const authority=createScriptAuthority({pool:{query:async()=>({rows:[{id:'reservation',machine_id:'us-mac-m4',owner_key:'real'}]})}});
 await expect(authority('us-mac-m4','start',{reservation_id:'reservation',owner_key:'fake'},operation)).rejects.toThrow('execution_reservation_identity_mismatch');expect(operation).not.toHaveBeenCalled();
});
it('Linux历史清理把DB持久version/grant/预约交给root签名器，不相信请求自报权限',async()=>{
 const row={id:'reservation',machine_id:'hk-vps',owner_key:'owner',intent_id:'intent',launch_generation:1,config_digest:'digest',execution_version_id:'version',execution_grant_id:'grant'};
 const node={id:'version',canonical_id:'hk-vps',platform:'linux',endpoints:{worker:'http://127.0.0.1:5231'},state:'revoked'};
 const grant={id:'grant',node_version_id:'version',profile_id:'safe',state:'revoked'};
 const pool={query:async sql=>({rows:sql.includes('capacity_reservations')?[row]:sql.includes('execution_grants')?[grant]:[node]})};
 const authority=createScriptAuthority({pool}),operation=vi.fn(async()=>true);
 await expect(authority('hk-vps','cancel',{...row,reservation_id:row.id},operation)).resolves.toBe(true);
 expect(operation).toHaveBeenCalledWith(node.endpoints.worker,{node,grant,reservation:row});
});
