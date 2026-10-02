import { it, expect } from 'vitest';
import { createImageRetentionController } from '../image-retention-controller.js';
import { randomUUID } from 'node:crypto';
import { IMAGE_RETENTION_POLICY, IMAGE_RETENTION_MACHINE } from '../image-retention-authority.js';
it('异机、超额或非计划完整ID不能先写任务预约',async()=>{
 const controller=createImageRetentionController({pool:{connect:()=>{throw Error('unexpected database access');}}});
 const image_id='sha256:'+'a'.repeat(64),plan={run_id:randomUUID(),policy:IMAGE_RETENTION_POLICY,identity:{machine_registry_id:IMAGE_RETENTION_MACHINE,daemon_id:'daemon',docker_root_dir:'/data',volume_dev:1},images:[{id:image_id}]};
 for(const bad of [{...plan,identity:{...plan.identity,machine_registry_id:randomUUID()}},{...plan,images:[{id:image_id},{id:image_id},{id:image_id}]},{...plan,images:[]}]){
  await expect(controller.claim(bad,image_id)).rejects.toThrow('INVALID_IMAGE_PLAN');
 }
 await expect(controller.claim(plan,'short')).rejects.toThrow('INVALID_IMAGE_PLAN');
});
