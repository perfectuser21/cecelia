import { describe, it, expect } from 'vitest';
import { routeWork } from '../work-router.js';
import { createRoutedTask } from '../work-routing-store.js';
import { PREVIEW_CACHE_AUTHORITY } from '../preview-cache-authority.js';
import { IMAGE_RETENTION_AUTHORITY, IMAGE_RETENTION_POLICY, IMAGE_RETENTION_MACHINE } from '../image-retention-authority.js';
import { EXECUTOR_CONTRACTS } from '../executor-contracts.js';
const request={source:'scheduler',source_id:'fixture',title:'回收US自有旧镜像',declared_domain:'operations',requested_task_type:'janitor',mutation_intent:'write',
 task:{executor_kind:'image-janitor'},metadata:{policy:IMAGE_RETENTION_POLICY,machine_registry_id:IMAGE_RETENTION_MACHINE}};
describe('US镜像清理独立进程内权限',()=>{
 it('公开JSON、preview能力及错误机器不能铸造删除任务',async()=>{
  for(const context of [{},{imageRetentionAuthority:'image-retention'},{previewCacheAuthority:PREVIEW_CACHE_AUTHORITY}]){
   expect(()=>routeWork(request,[],context)).toThrow('janitor_authority_required');
   await expect(createRoutedTask({},request,[],context)).rejects.toThrow('janitor_authority_required');
  }
  expect(()=>routeWork({...request,metadata:{...request.metadata,machine_registry_id:'mmv'}},[],{imageRetentionAuthority:IMAGE_RETENTION_AUTHORITY})).toThrow('janitor_authority_required');
 });
 it('内部固定合同可路由且executor永不按时间释放',async()=>{
  expect(routeWork(request,[],{imageRetentionAuthority:IMAGE_RETENTION_AUTHORITY})).toMatchObject({work_kind:'operations',artifact_kind:'execution'});
  expect(EXECUTOR_CONTRACTS['image-janitor'].staleMinutes).toBeNull();
  expect(await EXECUTOR_CONTRACTS['image-janitor'].probe({})).toBe('unknown');
 });
});
