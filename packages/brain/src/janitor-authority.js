import { assertPreviewCacheAuthority } from './preview-cache-authority.js';
import { assertImageRetentionAuthority, IMAGE_RETENTION_POLICY } from './image-retention-authority.js';
export function assertJanitorAuthority(request, context = {}) {
  if (request.task?.executor_kind === 'image-janitor' || request.executor_kind === 'image-janitor'
      || request.metadata?.policy === IMAGE_RETENTION_POLICY) return assertImageRetentionAuthority(request, context);
  return assertPreviewCacheAuthority(request, context);
}
