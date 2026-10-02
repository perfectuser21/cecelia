import {it,expect,vi} from 'vitest';
import {createLinuxRuntimeAuthorization} from './runtime-service.js';
import {US_SCHEDULER_ID} from './deployment.js';
it('未知机器和US调度身份在读取凭据或写库前拒绝执行验收',async()=>{
 const readDeployment=vi.fn(),query=vi.fn();
 const service=createLinuxRuntimeAuthorization({pool:{query},readDeployment});
 await expect(service.prepare('unknown',{expected_version_id:null})).rejects.toThrow('linux_pool_request_invalid');
 await expect(service.prepare(US_SCHEDULER_ID,{expected_version_id:null})).rejects.toThrow('linux_pool_machine_forbidden');
 expect(readDeployment).not.toHaveBeenCalled();expect(query).not.toHaveBeenCalled();
});
it('外部请求不能附带执行配置或替换受信machine_registry_id',async()=>{
 const machine='71d632df-252a-4991-ad6b-3647fbbea9f7',query=vi.fn();
 const readDeployment=vi.fn(async()=>({expected:{machine_registry_id:US_SCHEDULER_ID}}));
 const service=createLinuxRuntimeAuthorization({pool:{query},readDeployment});
 await expect(service.prepare(machine,{expected_version_id:null,profile:{cpus:64}})).rejects.toThrow('linux_pool_request_invalid');
 expect(readDeployment).not.toHaveBeenCalled();
 await expect(service.prepare(machine,{expected_version_id:null})).rejects.toThrow('linux_pool_runtime_deployment_invalid');
 expect(query).not.toHaveBeenCalled();
});
