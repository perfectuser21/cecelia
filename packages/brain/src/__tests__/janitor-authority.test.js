import { it, expect } from 'vitest';
import { assertJanitorAuthority } from '../janitor-authority.js';
import { PREVIEW_CACHE_AUTHORITY, PREVIEW_CACHE_POLICY } from '../preview-cache-authority.js';
import { IMAGE_RETENTION_AUTHORITY, IMAGE_RETENTION_POLICY, IMAGE_RETENTION_MACHINE } from '../image-retention-authority.js';
it('两个固定Janitor能力互不替代，普通任务无附加能力',()=>{
 const preview={source:'scheduler',declared_domain:'operations',mutation_intent:'write',requested_task_type:'janitor',task:{executor_kind:'preview-janitor'},metadata:{machine:'mmv',policy:PREVIEW_CACHE_POLICY}};
 expect(assertJanitorAuthority(preview,{previewCacheAuthority:PREVIEW_CACHE_AUTHORITY})).toBe(true);
 expect(()=>assertJanitorAuthority(preview,{imageRetentionAuthority:IMAGE_RETENTION_AUTHORITY})).toThrow();
 expect(()=>assertJanitorAuthority({...preview,metadata:{policy:IMAGE_RETENTION_POLICY,machine_registry_id:IMAGE_RETENTION_MACHINE}},{previewCacheAuthority:PREVIEW_CACHE_AUTHORITY})).toThrow();
 expect(assertJanitorAuthority({requested_task_type:'data'})).toBe(false);
});
