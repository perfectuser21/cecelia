import { runJob, reconcileJob } from './janitor.js';
import { PREVIEW_CACHE_POLICY } from './preview-cache-authority.js';
export async function runPreviewCacheJanitor(pool) {
  try {
    // 即使停用仍可只读回执收口旧running；绝不重发execute。
    const reconciled = await reconcileJob(pool, PREVIEW_CACHE_POLICY);
    if (reconciled.status !== 'idle') return reconciled;
    return await runJob(pool, PREVIEW_CACHE_POLICY);
  } catch (error) {
    if (['JANITOR_DISABLED', 'JANITOR_BUSY', 'JANITOR_UNCONFIRMED'].includes(error.code)) return { status: error.code };
    throw error;
  }
}
