// 进程内能力只能经调用栈传递；HTTP JSON/payload/source字符串均不能赋权。
export const PREVIEW_CACHE_AUTHORITY = Symbol('preview-cache-controller');
export const PREVIEW_CACHE_POLICY = 'preview-owned-npm-cache-expiry-v1';
export function assertPreviewCacheAuthority(request, context = {}) {
  const reserved = request.requested_task_type === 'janitor' || request.task?.task_type === 'janitor'
    || request.task?.executor_kind === 'preview-janitor' || request.executor_kind === 'preview-janitor';
  if (!reserved) return false;
  if (context.previewCacheAuthority !== PREVIEW_CACHE_AUTHORITY || request.requested_task_type !== 'janitor'
      || request.declared_domain !== 'operations' || request.mutation_intent !== 'write'
      || request.metadata?.policy !== PREVIEW_CACHE_POLICY || request.metadata?.machine !== 'mmv'
      || request.task?.executor_kind !== 'preview-janitor' || request.source !== 'scheduler') {
    throw new Error('janitor_authority_required');
  }
  return true;
}
