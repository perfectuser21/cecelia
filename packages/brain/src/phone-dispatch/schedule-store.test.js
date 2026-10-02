import {it,expect,vi} from 'vitest';
import {processPhoneScheduledSlot,registerPhoneSchedule} from './schedule-store.js';
it('schedule-store借入真实Client身份不重连或释放外层，只回滚本次事务',async()=>{
 class Client{constructor(){this.query=vi.fn(async()=>({rows:[]}));this.connect=vi.fn(()=>{throw Error('borrowed_client_reconnected');});this.release=vi.fn();}}
 const client=new Client();await expect(processPhoneScheduledSlot(client,{templateId:'fixture'})).rejects.toThrow('phone_schedule_template_invalid');
 expect(client.connect).not.toHaveBeenCalled();expect(client.release).not.toHaveBeenCalled();expect(client.query.mock.calls.map(c=>c[0]).filter(s=>['BEGIN','COMMIT','ROLLBACK'].includes(s))).toEqual(['BEGIN','ROLLBACK']);
});
it('schedule-store普通caller flags不借连接或mint内部注册权限',async()=>{const pool={connect:vi.fn()};await expect(registerPhoneSchedule(pool,{templateId:'fixture',phone_authority:true},{registryAuthority:true})).rejects.toThrow('phone_schedule_registry_authority_required');expect(pool.connect).not.toHaveBeenCalled();});
