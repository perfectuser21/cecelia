import { it,expect } from 'vitest';
import { createLinuxPoolAuthorization } from './service.js';
import { createDeploymentReader } from './deployment.js';
it('默认未登记部署和US固定身份在连接DB前拒绝，不从机器metadata猜endpoint',async()=>{
 let connected=0;const pool={connect(){connected++;throw Error('unexpected database');}};
 const service=createLinuxPoolAuthorization({pool,readDeployment:createDeploymentReader({env:{}})});
 await expect(service.challenge('1a379d80-ad36-47d3-88ba-e545ab299a54',{expected_version_id:null})).rejects.toThrow('linux_pool_machine_forbidden');
 await expect(service.challenge('71d632df-252a-4991-ad6b-3647fbbea9f7',{expected_version_id:null})).rejects.toThrow('linux_pool_deployment_unavailable');
 await expect(service.activate('71d632df-252a-4991-ad6b-3647fbbea9f7',{enabled:true})).rejects.toThrow('linux_pool_request_invalid');
 expect(connected).toBe(0);
});
