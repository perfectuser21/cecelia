import { assertImageRetentionAuthority, IMAGE_RETENTION_POLICY } from './image-retention-authority.js';
export function assertJanitorAuthority(request, context = {}) {
  // 旧执行器名称也必须拒绝，不能退回普通operations/data路由。
  const policy = request.metadata?.policy;
  const reserved = policy === IMAGE_RETENTION_POLICY || policy === 'preview-owned-npm-cache-expiry-v1'
    || request.requested_task_type === 'janitor' || request.task?.task_type === 'janitor'
    || ['preview-janitor', 'image-janitor'].includes(request.task?.executor_kind)
    || ['preview-janitor', 'image-janitor'].includes(request.executor_kind);
  return reserved ? assertImageRetentionAuthority(request, context) : false;
}
