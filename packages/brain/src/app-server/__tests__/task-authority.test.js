import {it,expect} from 'vitest';
import {routeWork} from '../../work-router.js';
import {APP_SERVER_AUTHORITY} from '../task-authority.js';
import {TICK_DISPATCH_EXCLUDED,EXECUTOR_KIND_FOR_TASK_TYPE} from '../../lib/task-type-registry.js';
const input={source:'scheduler',source_id:'test',title:'OpenClaw实例',requested_task_type:'app_server_run',declared_domain:'operations',mutation_intent:'write',metadata:{policy:'app-server-exclusive-v1'},task:{executor_kind:'app-server-controller'}};
it('普通create task入口不能借JSON伪造controller authority',()=>{
 expect(()=>routeWork(input,[],{})).toThrow('appserver_task_authority_required');
 expect(()=>routeWork(input,[],{appServerAuthority:'app-server-controller'})).toThrow('appserver_task_authority_required');
 expect(routeWork(input,[],{appServerAuthority:APP_SERVER_AUTHORITY})).toMatchObject({work_kind:'operations',artifact_kind:'execution',canonical_task_type:'app_server_run'});
 expect(TICK_DISPATCH_EXCLUDED).toContain('app_server_run');
 expect(EXECUTOR_KIND_FOR_TASK_TYPE.app_server_run).toBe('app-server-controller');
});
it('独立executor合同不按本机进程或TTL回队，缺失信息保持unknown',async()=>{
 const {VALID_EXECUTOR_KINDS,EXECUTOR_CONTRACTS,isExternallyExecuted}=await import('../../executor-contracts.js');
 expect(VALID_EXECUTOR_KINDS).toContain('app-server-controller');
 expect(isExternallyExecuted({task_type:'app_server_run'})).toBe(true);
 expect(EXECUTOR_CONTRACTS['app-server-controller'].staleMinutes).toBeNull();
 expect(EXECUTOR_CONTRACTS['app-server-controller'].onStale).toBe('none');
 expect(await EXECUTOR_CONTRACTS['app-server-controller'].probe({})).toBe('unknown');
});
