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
it('普通执行器只投影旧2组合，registry metadata不能添加M1 Codex',async()=>{
 const {legacyExecutorEntries}=await import('./legacy-executor.js');
 const rows=legacyRecords({env});rows[0].endpoints.legacy_executor={claude:{executor:'claude',url:'http://claude:3457'}};
 rows[1].metadata.executors=[{executor:'codex',url:'http://evil:3458'}];
 rows[2].endpoints.legacy_executor={codex:{executor:'codex',url:'http://codex:3458'}};await publish(rows);
 expect(legacyExecutorEntries().map(e=>`${e.machineId}:${e.executor}`)).toEqual(['us-mac-m4:claude','xian-mac-m4:codex']);
});
it('两类凭据broker拒绝已撤销账号，不能仅凭机器仍有其他grant发凭据',async()=>{
 const {createCredentialBroker}=await import('../orchestrator/credential-broker.js');
 const {createGitHubCredentialBroker}=await import('../orchestrator/github-credential-broker.js');
 const rows=legacyRecords({env});rows[0].grants.find(g=>g.provider==='codex'&&g.account_id==='team1').state='revoked';await publish(rows);
 let reads=0;const load=async()=>{reads++;return 'invalid';};
 const request={attemptId:'11111111-1111-4111-8111-111111111111',machineId:'us-mac-m4',provider:'codex',accountId:'team1',repo:'perfectuser21/cecelia',deadlineAt:new Date(Date.now()+60000).toISOString()};
 await expect(createCredentialBroker({controllerMachineId:'us-mac-m4',loadCredential:load}).issue(request)).rejects.toThrow('credential_grant_not_allowed');
 await expect(createGitHubCredentialBroker({controllerMachineId:'us-mac-m4',loadToken:load}).issue(request)).rejects.toThrow('credential_grant_not_allowed');
 expect(reads).toBe(0);
});
