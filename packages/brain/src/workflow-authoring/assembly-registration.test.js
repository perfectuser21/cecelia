import {it,expect,vi} from 'vitest';
import {runReleaseLineHook} from '../lib/release-line.js';
import {validateRequest} from './contracts.js';
it('显式装配请求必须有冻结协议，不能回退到旧登记',()=>{
 expect(()=>validateRequest({operation:'create',actor:'装配器',goal:'登记',assembly_mode:true})).toThrow();
 expect(()=>validateRequest({operation:'create',actor:'装配器',goal:'登记',assembly_mode:true,registration_protocol:'definition-freeze-v1'})).not.toThrow();
});
it('严格装配构建失败向外抛错，不能容错提交或发送告警',async()=>{
 const db={query:vi.fn(async()=>({rows:[{ok:true}]}))},alert=vi.fn();
 await expect(runReleaseLineHook(db,'register_build',async()=>{throw Error('build_failed');},{strict:true,env:{},alert,log:{warn:vi.fn()}})).rejects.toThrow('build_failed');
 expect(alert).not.toHaveBeenCalled();
});
it.each(['disabled','not_migrated'])('严格装配不能忽略发布线%s',async why=>{
 const db={query:vi.fn(async()=>({rows:[{ok:false}]}))};
 await expect(runReleaseLineHook(db,'refresh_recipe',vi.fn(),{strict:true,env:why==='disabled'?{RELEASE_LINE_SYNC_HOOK:'off'}:{}})).rejects.toThrow();
});
