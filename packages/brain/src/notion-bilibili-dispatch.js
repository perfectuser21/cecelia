import { ENGLISH_TASKS_DB } from './notion-leadgen-dispatch.js';
import { UUID } from './workflow-foundation/contracts.js';

export const BILIBILI_VERIFY_MARKER = '[bilibili-verify-existing]';

export async function dispatchNotionBilibili(pool, { pageId, sourceDatabaseId, sourceTenantId, binding }, { createTask } = {}) {
  if (sourceDatabaseId !== ENGLISH_TASKS_DB || !UUID.test(pageId ?? '')
    || !binding || binding.page_id !== pageId || binding.source_tenant_id !== sourceTenantId
    || !['workflow_id', 'release_id', 'observation_id', 'tenant_id'].every(key => UUID.test(binding[key] ?? ''))) {
    throw Object.assign(new Error('notion_bilibili_binding_unavailable'), { code: 'notion_bilibili_binding_unavailable' });
  }
  const { BILIBILI_VERIFY_BVID, createBilibiliVerificationTask } = await import('./workflow-foundation/standalone-bilibili.js');
  const { workflow_id, release_id, observation_id, tenant_id } = binding;
  const register = createTask ?? createBilibiliVerificationTask;
  const { task } = await register(pool, {
    workflow_id, release_id, observation_id, bvid: BILIBILI_VERIFY_BVID,
  }, { notionPageId: pageId, notionTenantId: tenant_id });
  return { taskId: task.id, kind: 'workflow_dispatch' };
}
