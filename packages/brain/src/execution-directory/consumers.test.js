import {it,expect,beforeEach} from 'vitest';
import {directory} from './directory.js';
import {legacyRecords} from './legacy-policy.js';
import {listComputeWorkerIds,workerBridgeUrlFor} from '../machine-registry.js';
import {listVerifiedExecutionTargets} from '../orchestrator/preflight/execution-targets.js';
import {listCanonicalMachineIds} from '../orchestrator/preflight/canonical-machine-id.js';
import {getNodeProfile} from '../orchestrator/fleet-node/node-profile.js';
const env={FLEET_WORKER_US_MAC_M4_URL:'http://first:5231',FLEET_WORKER_XIAN_MAC_M1_URL:'http://m1:5231',FLEET_WORKER_XIAN_MAC_M4_URL:'http://m4:5231'};
const publish=rows=>directory.refresh({pool:{query:async()=>({rows})}});
beforeEach(async()=>publish(legacyRecords({env})));
it('真实消费者在refresh后读取当前名单、endpoint和profile',async()=>{
 expect(listVerifiedExecutionTargets()).toHaveLength(18);
 const rows=legacyRecords({env});rows[0].endpoints.worker='http://second:5231';rows[0].profile.capacity=6;rows[1].grants=[];
 await publish(rows);
 expect(listVerifiedExecutionTargets()).toHaveLength(13);expect(workerBridgeUrlFor('us-mac-m4')).toBe('http://second:5231');
 expect(getNodeProfile('us-mac-m4').capacity).toBe(6);
 expect(listComputeWorkerIds()).not.toContain('xian-mac-m1');expect(listCanonicalMachineIds()).not.toContain('xian-mac-m1');
});
it('空目录不会回退静态18组合或猜测地址',async()=>{
 await publish([]);expect(listVerifiedExecutionTargets()).toEqual([]);expect(listComputeWorkerIds()).toEqual([]);
 expect(workerBridgeUrlFor('us-mac-m4',env)).toBeNull();expect(()=>getNodeProfile('us-mac-m4')).toThrow();
});
