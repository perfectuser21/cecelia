import {it,expect} from 'vitest';
import {validateTargetRequest,probeInvocationRuntime} from './resolve.js';
const id='11111111-1111-4111-8111-111111111111';
it('正式调用必须提供固定版本，候选必须有管理任务与摘要',()=>{
 const base={target:{kind:'activity',id},mode:'released',input:{}};
 expect(()=>validateTargetRequest(base)).toThrow('definition_version_id');
 expect(()=>validateTargetRequest({...base,target:{...base.target,definition_version_id:id}})).not.toThrow();
 expect(()=>validateTargetRequest({...base,mode:'candidate',authoring_task_id:id,compose_sha256:'other'})).toThrow('compose_sha256');
 expect(()=>validateTargetRequest({...base,mode:'candidate',authoring_task_id:id,compose_sha256:'a'.repeat(64)})).not.toThrow();
});
it('所有真实目录执行体探活失败时不返回可用资源',async()=>{
 const result=await probeInvocationRuntime({fetchFn:async()=>{throw Error('offline');}});
 expect(result).toEqual({ready:false,code:'transport_resource_unavailable'});
});
